import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { pauseCampaign, enableCampaign, updateBudget } from '@/lib/meta-api';

// POST /api/campaigns/action — Quick actions on campaigns
export async function POST(request) {
  const { campaignId, action, value } = await request.json();
  // campaignId = internal UUID, action = 'pause' | 'enable' | 'set_budget'

  if (!campaignId || !action) {
    return NextResponse.json({ error: 'campaignId and action required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    // Get campaign + account info
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, external_id, name, status, meta_account_id')
      .eq('id', campaignId)
      .single();

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    const { data: account } = await supabase
      .from('meta_accounts')
      .select('access_token')
      .eq('id', campaign.meta_account_id)
      .single();

    if (!account?.access_token) return NextResponse.json({ error: 'No access token' }, { status: 400 });

    let result;
    let newStatus = campaign.status;

    switch (action) {
      case 'pause':
        result = await pauseCampaign(campaign.external_id, account.access_token);
        newStatus = 'PAUSED';
        break;
      case 'enable':
        result = await enableCampaign(campaign.external_id, account.access_token);
        newStatus = 'ACTIVE';
        break;
      case 'set_budget':
        if (!value || value <= 0) return NextResponse.json({ error: 'Invalid budget value' }, { status: 400 });
        result = await updateBudget(campaign.external_id, value, account.access_token);
        await supabase.from('campaigns').update({ daily_budget: value }).eq('id', campaignId);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Update local status
    if (action !== 'set_budget') {
      await supabase.from('campaigns').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', campaignId);
    }

    // Log notification
    await supabase.from('notifications').insert({
      type: 'automation_fired',
      title: `${action === 'pause' ? '⏸️ Paused' : action === 'enable' ? '▶️ Enabled' : '💰 Budget updated'}: ${campaign.name}`,
      message: action === 'set_budget' ? `Budget set to $${value}` : `Campaign ${newStatus}`,
      severity: 'info',
    });

    return NextResponse.json({ success: true, status: newStatus, result });
  } catch (err) {
    console.error('Campaign action error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
