import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// GET /api/automation/paused — List all currently auto-paused ads
export async function GET() {
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('automation_paused_ads')
    .select('*')
    .eq('is_paused', true)
    .order('paused_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paused: data || [] });
}

// POST /api/automation/paused — Manually resume a paused ad
export async function POST(request) {
  const { adExternalId } = await request.json();
  if (!adExternalId) return NextResponse.json({ error: 'adExternalId required' }, { status: 400 });

  const supabase = getSupabaseServer();

  // Get the paused record
  const { data: pausedRecord, error: fetchErr } = await supabase
    .from('automation_paused_ads')
    .select('*')
    .eq('ad_external_id', adExternalId)
    .eq('is_paused', true)
    .single();

  if (fetchErr || !pausedRecord) {
    return NextResponse.json({ error: 'Paused ad not found' }, { status: 404 });
  }

  // Get access token from any active account
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('access_token')
    .eq('is_active', true);

  if (!accounts?.length) return NextResponse.json({ error: 'No active account' }, { status: 400 });

  let resumed = false;
  for (const account of accounts) {
    try {
      const res = await fetch(`${META_GRAPH_URL}/${adExternalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', access_token: account.access_token }),
      });

      if (res.ok) {
        resumed = true;

        // Update tracking
        await supabase.from('automation_paused_ads')
          .update({
            is_paused: false,
            resumed_at: new Date().toISOString(),
          })
          .eq('ad_external_id', adExternalId)
          .eq('is_paused', true);

        // Log as manual resume
        await supabase.from('automation_logs').insert({
          rule_id: pausedRecord.rule_id,
          rule_name: pausedRecord.rule_name || 'Manual Resume',
          entity_type: 'ad',
          entity_external_id: adExternalId,
          entity_name: pausedRecord.ad_name,
          action_type: 'enable_ad',
          action_params: {},
          condition_snapshot: pausedRecord.metric_snapshot || {},
          status: 'executed',
          error_message: null,
        });

        // Notify
        await supabase.from('notifications').insert({
          type: 'automation_fired',
          title: `▶️ Manual Resume: ${pausedRecord.ad_name}`,
          message: `Manually resumed ad that was auto-paused by rule "${pausedRecord.rule_name}"`,
          severity: 'info',
          metadata: { ad_external_id: adExternalId, action: 'manual_resume' },
        });

        break;
      }
    } catch { continue; }
  }

  if (!resumed) return NextResponse.json({ error: 'Failed to resume ad on Meta' }, { status: 500 });

  return NextResponse.json({ success: true, adExternalId });
}
