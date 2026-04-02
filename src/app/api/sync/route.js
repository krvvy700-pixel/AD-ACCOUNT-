import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchCampaigns, fetchAdSets, fetchInsights } from '@/lib/meta-api';
import { subDays, format } from 'date-fns';

// POST /api/sync — Triggers a full data sync for all active accounts
// Protected by CRON_SECRET_KEY header
export const maxDuration = 60; // Allow up to 60s on Vercel (requires Pro for >10s)

export async function POST(request) {
  // Verify secret key
  const authHeader = request.headers.get('x-cron-secret');
  const manualTrigger = request.headers.get('x-manual-trigger');

  if (!manualTrigger && authHeader !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseServer();

  try {
    // Get all active accounts
    const { data: accounts, error: accErr } = await supabase
      .from('meta_accounts')
      .select('*')
      .eq('is_active', true);

    if (accErr) throw accErr;
    if (!accounts?.length) {
      return NextResponse.json({ message: 'No active accounts to sync' });
    }

    const results = [];

    for (const account of accounts) {
      const syncStart = Date.now();

      // Create sync status record
      const { data: syncRecord } = await supabase
        .from('sync_status')
        .insert({
          meta_account_id: account.id,
          sync_type: 'full',
          status: 'running',
        })
        .select()
        .single();

      try {
        let recordCount = 0;

        // 1. Sync campaigns
        const campaigns = await fetchCampaigns(account.meta_account_id, account.access_token);
        for (const c of campaigns) {
          await supabase.from('campaigns').upsert({
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
          }, { onConflict: 'external_id' });
          recordCount++;

          // 2. Sync ad sets for each campaign
          try {
            const adSets = await fetchAdSets(c.externalId, account.access_token);
            for (const as of adSets) {
              // Get internal campaign ID
              const { data: dbCampaign } = await supabase
                .from('campaigns')
                .select('id')
                .eq('external_id', c.externalId)
                .single();

              if (dbCampaign) {
                await supabase.from('ad_sets').upsert({
                  campaign_id: dbCampaign.id,
                  external_id: as.externalId,
                  name: as.name,
                  status: as.status,
                  daily_budget: as.dailyBudget,
                  lifetime_budget: as.lifetimeBudget,
                  targeting_summary: as.targetingSummary,
                  optimization_goal: as.optimizationGoal,
                  bid_strategy: as.bidStrategy,
                  raw_data: as.rawData,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'external_id' });
                recordCount++;
              }
            }
          } catch (e) {
            console.warn(`Failed to sync ad sets for campaign ${c.externalId}:`, e.message);
          }
        }

        // 3. Sync metrics (last 30 days)
        const dateTo = format(new Date(), 'yyyy-MM-dd');
        const dateFrom = format(subDays(new Date(), 30), 'yyyy-MM-dd');

        try {
          const insights = await fetchInsights(account.meta_account_id, account.access_token, dateFrom, dateTo, 'campaign');

          for (const row of insights) {
            // Find internal campaign ID
            const { data: dbCampaign } = await supabase
              .from('campaigns')
              .select('id')
              .eq('external_id', row.campaignId)
              .single();

            if (dbCampaign) {
              await supabase.from('metrics').upsert({
                entity_type: 'campaign',
                campaign_id: dbCampaign.id,
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
              }, {
                onConflict: 'entity_type,date,campaign_id',
                ignoreDuplicates: false,
              });
              recordCount++;
            }
          }
        } catch (e) {
          console.warn(`Failed to sync insights for account ${account.meta_account_id}:`, e.message);
        }

        // Update sync status
        const duration = Date.now() - syncStart;
        await supabase.from('sync_status').update({
          status: 'success',
          records_processed: recordCount,
          completed_at: new Date().toISOString(),
          duration_ms: duration,
        }).eq('id', syncRecord.id);

        // Update account last_synced_at
        await supabase.from('meta_accounts').update({
          last_synced_at: new Date().toISOString(),
        }).eq('id', account.id);

        results.push({ account: account.name, status: 'success', records: recordCount, duration });

      } catch (err) {
        await supabase.from('sync_status').update({
          status: 'failed',
          error_message: err.message,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - syncStart,
        }).eq('id', syncRecord.id);

        // Create failure notification
        await supabase.from('notifications').insert({
          type: 'sync_failed',
          title: `Sync failed for ${account.name}`,
          message: err.message,
          severity: 'critical',
          metadata: { accountId: account.id },
        });

        results.push({ account: account.name, status: 'failed', error: err.message });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
