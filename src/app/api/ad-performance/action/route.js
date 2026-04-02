import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import {
  pauseCampaign, enableCampaign,
  pauseAdSet, enableAdSet,
  pauseAd, enableAd,
} from '@/lib/meta-api';

// POST /api/ad-performance/action — Pause/Enable campaigns, ad sets, or ads
export async function POST(request) {
  const { entityId, entityType, action } = await request.json();
  // entityType = 'campaign' | 'adset' | 'ad'
  // action = 'pause' | 'enable'

  if (!entityId || !entityType || !action) {
    return NextResponse.json({ error: 'entityId, entityType, and action required' }, { status: 400 });
  }

  if (!['pause', 'enable'].includes(action)) {
    return NextResponse.json({ error: 'action must be pause or enable' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    let externalId = entityId;
    let accessToken = null;
    let entityName = entityId;

    if (entityType === 'campaign') {
      // Campaign — look up in DB to get external_id and access token
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('id, external_id, name, meta_account_id')
        .eq('id', entityId)
        .single();

      if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

      externalId = campaign.external_id;
      entityName = campaign.name;

      const { data: account } = await supabase
        .from('meta_accounts')
        .select('access_token')
        .eq('id', campaign.meta_account_id)
        .single();

      if (!account?.access_token) return NextResponse.json({ error: 'No access token' }, { status: 400 });
      accessToken = account.access_token;

      // Execute action
      if (action === 'pause') await pauseCampaign(externalId, accessToken);
      else await enableCampaign(externalId, accessToken);

      // Update DB
      const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
      await supabase.from('campaigns').update({
        status: newStatus, updated_at: new Date().toISOString()
      }).eq('id', entityId);

    } else {
      // Ad Set or Ad — entityId IS the external Meta ID (from Meta API)
      // We need to find which account it belongs to
      const { data: accounts } = await supabase
        .from('meta_accounts')
        .select('id, access_token, name')
        .eq('is_active', true);

      if (!accounts?.length) return NextResponse.json({ error: 'No active accounts' }, { status: 400 });

      // Try each account's token until one works
      let success = false;
      for (const account of accounts) {
        try {
          if (entityType === 'adset') {
            if (action === 'pause') await pauseAdSet(entityId, account.access_token);
            else await enableAdSet(entityId, account.access_token);
          } else {
            if (action === 'pause') await pauseAd(entityId, account.access_token);
            else await enableAd(entityId, account.access_token);
          }
          success = true;
          accessToken = account.access_token;
          break;
        } catch {
          continue;
        }
      }

      if (!success) {
        return NextResponse.json({ error: `Failed to ${action} ${entityType}` }, { status: 500 });
      }
    }

    // Log notification
    const actionLabel = action === 'pause' ? '⏸️ Paused' : '▶️ Enabled';
    const typeLabel = entityType === 'campaign' ? 'Campaign' : entityType === 'adset' ? 'Ad Set' : 'Ad';
    await supabase.from('notifications').insert({
      type: 'automation_fired',
      title: `${actionLabel}: ${entityName}`,
      message: `${typeLabel} ${action === 'pause' ? 'paused' : 'enabled'}`,
      severity: 'info',
    });

    return NextResponse.json({ success: true, action, entityType });
  } catch (err) {
    console.error('Ad performance action error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
