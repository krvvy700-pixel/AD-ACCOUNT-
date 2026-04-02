import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchCampaigns, fetchInsights } from '@/lib/meta-api';
import { subDays, format } from 'date-fns';

// POST /api/sync — Triggers a full data sync for all active accounts
export const maxDuration = 60;

export async function POST(request) {
  const authHeader = request.headers.get('x-cron-secret');
  const manualTrigger = request.headers.get('x-manual-trigger');

  if (!manualTrigger && authHeader !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServer();

  try {
    const { data: accounts, error: accErr } = await supabase
      .from('meta_accounts')
      .select('*')
      .eq('is_active', true);

    if (accErr) throw accErr;
    if (!accounts?.length) {
      return NextResponse.json({ message: 'No active accounts to sync' });
    }

    // Sync all accounts in PARALLEL for speed
    const results = await Promise.all(accounts.map(account => syncAccount(supabase, account)));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function syncAccount(supabase, account) {
  const syncStart = Date.now();

  const { data: syncRecord } = await supabase
    .from('sync_status')
    .insert({ meta_account_id: account.id, sync_type: 'full', status: 'running' })
    .select()
    .single();

  try {
    let recordCount = 0;

    // 1. Fetch campaigns + insights in PARALLEL (biggest speedup)
    const dateTo = format(new Date(), 'yyyy-MM-dd');
    const dateFrom = format(subDays(new Date(), 30), 'yyyy-MM-dd');

    const [campaigns, insights] = await Promise.all([
      fetchCampaigns(account.meta_account_id, account.access_token),
      fetchInsights(account.meta_account_id, account.access_token, dateFrom, dateTo, 'campaign').catch(e => {
        console.warn(`Insights failed for ${account.name}:`, e.message);
        return [];
      }),
    ]);

    // 2. BATCH upsert campaigns (one call instead of N)
    if (campaigns.length > 0) {
      const campaignRows = campaigns.map(c => ({
        meta_account_id: account.id,
        external_id: c.externalId,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.dailyBudget,
        lifetime_budget: c.lifetimeBudget,
        buying_type: c.buyingType,
        start_date: c.startDate,
        end_date: c.endDate,
        raw_data: c.rawData,
        updated_at: new Date().toISOString(),
      }));

      // Batch in chunks of 50
      for (let i = 0; i < campaignRows.length; i += 50) {
        const chunk = campaignRows.slice(i, i + 50);
        await supabase.from('campaigns').upsert(chunk, { onConflict: 'external_id' });
      }
      recordCount += campaigns.length;
    }

    // 3. Build campaign ID lookup map (one query)
    const externalIds = campaigns.map(c => c.externalId);
    const { data: dbCampaigns } = await supabase
      .from('campaigns')
      .select('id, external_id')
      .in('external_id', externalIds.length > 0 ? externalIds : ['__none__']);

    const campaignMap = {};
    for (const dc of (dbCampaigns || [])) {
      campaignMap[dc.external_id] = dc.id;
    }

    // 4. INSERT metrics (delete old ones first to avoid unique index issues)
    if (insights.length > 0) {
      const metricRows = insights
        .filter(row => campaignMap[row.campaignId])
        .map(row => ({
          entity_type: 'campaign',
          campaign_id: campaignMap[row.campaignId],
          date: row.date,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          conversions: row.conversions,
          conversion_value: row.conversionValue,
          reach: row.reach,
          frequency: row.frequency,
          link_clicks: row.linkClicks,
          raw_data: row.rawData,
          synced_at: new Date().toISOString(),
        }));

      console.log(`[sync] ${account.name}: ${insights.length} insight rows, ${metricRows.length} matched campaigns`);

      // Delete existing metrics for this account's campaigns in the date range
      const campaignDbIds = Object.values(campaignMap);
      if (campaignDbIds.length > 0) {
        await supabase
          .from('metrics')
          .delete()
          .eq('entity_type', 'campaign')
          .in('campaign_id', campaignDbIds)
          .gte('date', dateFrom)
          .lte('date', dateTo);
      }

      // Insert fresh metrics in chunks of 50
      for (let i = 0; i < metricRows.length; i += 50) {
        const chunk = metricRows.slice(i, i + 50);
        const { error: insertErr } = await supabase.from('metrics').insert(chunk);
        if (insertErr) {
          console.error(`[sync] Metrics insert error for ${account.name}:`, insertErr);
        }
      }
      recordCount += metricRows.length;
    } else {
      console.log(`[sync] ${account.name}: 0 insights returned`);
    }

    // 5. Update status
    const duration = Date.now() - syncStart;
    await Promise.all([
      supabase.from('sync_status').update({
        status: 'success', records_processed: recordCount,
        completed_at: new Date().toISOString(), duration_ms: duration,
      }).eq('id', syncRecord.id),
      supabase.from('meta_accounts').update({
        last_synced_at: new Date().toISOString(),
      }).eq('id', account.id),
    ]);

    return { account: account.name, status: 'success', records: recordCount, duration };

  } catch (err) {
    console.error(`Sync failed for ${account.name}:`, err);
    await supabase.from('sync_status').update({
      status: 'failed', error_message: err.message,
      completed_at: new Date().toISOString(), duration_ms: Date.now() - syncStart,
    }).eq('id', syncRecord.id);

    await supabase.from('notifications').insert({
      type: 'sync_failed',
      title: `Sync failed for ${account.name}`,
      message: err.message,
      severity: 'critical',
      metadata: { accountId: account.id },
    });

    return { account: account.name, status: 'failed', error: err.message };
  }
}
