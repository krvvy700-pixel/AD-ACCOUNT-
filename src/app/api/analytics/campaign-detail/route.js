import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchAdSets, fetchInsights, fetchPeriodReach } from '@/lib/meta-api';

// GET /api/analytics/campaign-detail?id=UUID&from=&to=
// Returns ad sets + per-ad-set metrics for drill-down
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('id');
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  if (!campaignId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabaseServer();

  try {
    // Get campaign info
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, external_id, name, status, objective, daily_budget, lifetime_budget, meta_account_id')
      .eq('id', campaignId)
      .single();

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    // Get account token
    const { data: account } = await supabase
      .from('meta_accounts')
      .select('access_token, meta_account_id, name')
      .eq('id', campaign.meta_account_id)
      .single();

    if (!account?.access_token) return NextResponse.json({ error: 'No access token' }, { status: 400 });

    // Fetch ad sets from Meta API (live data)
    let adSets = [];
    try {
      adSets = await fetchAdSets(campaign.external_id, account.access_token);
    } catch (e) {
      console.warn('Failed to fetch ad sets:', e.message);
    }

    // Fetch ad set-level insights
    let adSetInsights = [];
    if (dateFrom && dateTo) {
      try {
        adSetInsights = await fetchInsights(
          account.meta_account_id, account.access_token,
          dateFrom, dateTo, 'adset'
        );
      } catch (e) {
        console.warn('Failed to fetch ad set insights:', e.message);
      }
    }

    // Merge ad sets with their metrics
    const insightMap = {};
    for (const row of adSetInsights) {
      if (!insightMap[row.adSetId]) {
        insightMap[row.adSetId] = { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0, reach: 0 };
      }
      const m = insightMap[row.adSetId];
      m.spend += row.spend;
      m.clicks += row.clicks;
      m.impressions += row.impressions;
      m.conversions += row.conversions;
      m.conversionValue += row.conversionValue;
      m.reach += row.reach;
    }

    const enrichedAdSets = adSets.map(as => {
      const m = insightMap[as.externalId] || { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0, reach: 0 };
      return {
        ...as,
        spend: m.spend,
        clicks: m.clicks,
        impressions: m.impressions,
        conversions: m.conversions,
        reach: m.reach,
        reachEstimated: true, // summed from daily insights — NOT deduplicated
        cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
        ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
        roas: m.spend > 0 ? m.conversionValue / m.spend : 0,
      };
    }).sort((a, b) => b.spend - a.spend);

    // Get campaign-level metrics from DB (for spend, clicks, etc.)
    let campaignMetrics = { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0, reach: 0 };
    if (dateFrom && dateTo) {
      const { data: metrics } = await supabase
        .from('metrics')
        .select('spend, clicks, impressions, conversions, conversion_value, reach')
        .eq('campaign_id', campaignId)
        .eq('entity_type', 'campaign')
        .gte('date', dateFrom)
        .lte('date', dateTo);

      for (const r of (metrics || [])) {
        campaignMetrics.spend += parseFloat(r.spend || 0);
        campaignMetrics.clicks += parseInt(r.clicks || 0);
        campaignMetrics.impressions += parseInt(r.impressions || 0);
        campaignMetrics.conversions += parseFloat(r.conversions || 0);
        campaignMetrics.conversionValue += parseFloat(r.conversion_value || 0);
        // Don't sum daily reach — we'll get deduplicated reach below
        campaignMetrics.reach += parseInt(r.reach || 0);
      }

      // REACH FIX: Fetch deduplicated reach for this specific campaign from Meta API
      try {
        const campaignReachMap = await fetchPeriodReach(
          account.meta_account_id, account.access_token, dateFrom, dateTo, 'campaign'
        );
        if (campaignReachMap[campaign.external_id] != null) {
          campaignMetrics.reach = campaignReachMap[campaign.external_id];
        }
      } catch (reachErr) {
        console.warn('[CampaignDetail] Deduplicated reach fetch failed, using summed daily:', reachErr.message);
        // campaignMetrics.reach already has the summed daily fallback
      }
    }

    return NextResponse.json({
      campaign: {
        ...campaign,
        accountName: account.name,
        metrics: {
          ...campaignMetrics,
          cpc: campaignMetrics.clicks > 0 ? campaignMetrics.spend / campaignMetrics.clicks : 0,
          ctr: campaignMetrics.impressions > 0 ? (campaignMetrics.clicks / campaignMetrics.impressions) * 100 : 0,
          roas: campaignMetrics.spend > 0 ? campaignMetrics.conversionValue / campaignMetrics.spend : 0,
        },
      },
      adSets: enrichedAdSets,
    });
  } catch (err) {
    console.error('Campaign detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
