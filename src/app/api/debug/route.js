import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET /api/debug — Shows raw database state (remove in production)
export async function GET(request) {
  const supabase = getSupabaseServer();

  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('id, meta_account_id, name, is_active, last_synced_at')
    .limit(20);

  const { data: campaigns, count: campaignCount } = await supabase
    .from('campaigns')
    .select('id, external_id, name, status, meta_account_id', { count: 'exact' })
    .limit(5);

  const { data: metrics, count: metricCount } = await supabase
    .from('metrics')
    .select('id, campaign_id, date, spend, clicks, impressions, conversions, entity_type', { count: 'exact' })
    .order('date', { ascending: false })
    .limit(10);

  const { data: syncStatus } = await supabase
    .from('sync_status')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(5);

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    accounts,
    campaigns: { count: campaignCount, sample: campaigns },
    metrics: { count: metricCount, sample: metrics },
    syncStatus,
    notifications,
  }, { status: 200 });
}
