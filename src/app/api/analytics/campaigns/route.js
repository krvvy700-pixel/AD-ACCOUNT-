import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchPeriodReach } from '@/lib/meta-api';

// GET /api/analytics/campaigns — Optimized campaign table
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  let dateFrom, dateTo;
  if (searchParams.get('from') && searchParams.get('to')) {
    dateFrom = searchParams.get('from');
    dateTo = searchParams.get('to');
  } else {
    const days = parseInt(searchParams.get('days') || '7');
    dateTo = new Date().toISOString().split('T')[0];
    dateFrom = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  }

  const accountId = searchParams.get('account');
  const searchQuery = searchParams.get('search')?.trim().toLowerCase() || '';
  const performanceTier = searchParams.get('performance');
  const sortBy = searchParams.get('sort') || 'spend';
  const sortOrder = searchParams.get('order') || 'desc';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));

  const supabase = getSupabaseServer();

  try {
    // QUERY 1: All campaigns
    let q = supabase.from('campaigns')
      .select('id, external_id, name, status, objective, daily_budget, lifetime_budget, meta_account_id, meta_accounts(name, currency)');
    if (accountId) q = q.eq('meta_account_id', accountId);
    if (searchQuery) q = q.ilike('name', `%${searchQuery}%`);
    const { data: campaigns } = await q;
    if (!campaigns?.length) return NextResponse.json({ campaigns: [], pagination: { page, limit, totalCount: 0, totalPages: 0, hasNext: false, hasPrev: false }, summary: {} });

    const campaignIds = campaigns.map(c => c.id);
    const campaignLookup = {};
    for (const c of campaigns) campaignLookup[c.id] = c;

    // QUERY 2: All metrics for current period (ONE query)
    const { data: allMetrics } = await supabase
      .from('metrics')
      .select('campaign_id, spend, impressions, clicks, conversions, conversion_value, reach')
      .eq('entity_type', 'campaign')
      .in('campaign_id', campaignIds)
      .gte('date', dateFrom)
      .lte('date', dateTo);

    // QUERY 3: Previous period metrics (ONE query)
    const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000);
    const prevTo = new Date(new Date(dateFrom).getTime() - 86400000).toISOString().split('T')[0];
    const prevFrom = new Date(new Date(dateFrom).getTime() - (daysDiff + 1) * 86400000).toISOString().split('T')[0];

    const { data: prevMetrics } = await supabase
      .from('metrics')
      .select('campaign_id, spend, impressions, clicks, conversions, conversion_value')
      .eq('entity_type', 'campaign')
      .in('campaign_id', campaignIds)
      .gte('date', prevFrom)
      .lte('date', prevTo);

    // Aggregate in memory
    const currMap = {}, prevMap = {};
    for (const m of (allMetrics || [])) {
      if (!currMap[m.campaign_id]) currMap[m.campaign_id] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
      const a = currMap[m.campaign_id];
      a.spend += parseFloat(m.spend || 0); a.impressions += parseInt(m.impressions || 0);
      a.clicks += parseInt(m.clicks || 0); a.conversions += parseFloat(m.conversions || 0);
      a.conversionValue += parseFloat(m.conversion_value || 0); a.reach += parseInt(m.reach || 0);
    }
    for (const m of (prevMetrics || [])) {
      if (!prevMap[m.campaign_id]) prevMap[m.campaign_id] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      const a = prevMap[m.campaign_id];
      a.spend += parseFloat(m.spend || 0); a.impressions += parseInt(m.impressions || 0);
      a.clicks += parseInt(m.clicks || 0); a.conversions += parseFloat(m.conversions || 0);
      a.conversionValue += parseFloat(m.conversion_value || 0);
    }

    // Build enriched rows
    // PAUSED CAMPAIGN FIX: Validate data consistency before computing derived metrics.
    // Stale/corrupt sync data can cause impossible values (e.g. 39 clicks with $0.08 spend).
    const enriched = campaigns.map(c => {
      let curr = currMap[c.id] || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
      const prev = prevMap[c.id] || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };

      // --- DATA SANITY CHECKS ---
      // 1. Paused + zero spend = zero all activity (stale sync data)
      if (c.status === 'PAUSED' && curr.spend < 0.01) {
        curr = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
      }

      // 2. CPC sanity: if clicks exist but CPC is impossibly low (<$0.005), reset clicks
      if (curr.clicks > 0 && curr.spend > 0) {
        const computedCpc = curr.spend / curr.clicks;
        if (computedCpc < 0.005 && curr.clicks > 5) {
          console.warn(`[Campaigns] Data anomaly for "${c.name}": ${curr.clicks} clicks with $${curr.spend.toFixed(2)} spend. Resetting.`);
          curr.clicks = 0;
          curr.impressions = 0;
        }
      }

      const spend = curr.spend;
      const clicks = curr.clicks;
      const impressions = curr.impressions;
      const conversions = curr.conversions;
      const conversionValue = curr.conversionValue;

      return {
        id: c.id, externalId: c.external_id, name: c.name, status: c.status, objective: c.objective,
        dailyBudget: c.daily_budget, lifetimeBudget: c.lifetime_budget,
        accountName: c.meta_accounts?.name || 'Unknown',
        spend, impressions, clicks,
        conversions, conversionValue,
        reach: curr.reach,
        reachEstimated: true,
        cpc: clicks > 0 && spend > 0 ? +(spend / clicks).toFixed(4) : 0,
        ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(4) : 0,
        roas: spend > 0 ? +(conversionValue / spend).toFixed(4) : 0,
        cpa: conversions > 0 && spend > 0 ? +(spend / conversions).toFixed(2) : 0,
        changes: {
          spend: pctChange(spend, prev.spend),
          clicks: pctChange(clicks, prev.clicks),
          conversions: pctChange(conversions, prev.conversions),
          roas: pctChange(spend > 0 ? conversionValue / spend : 0, prev.spend > 0 ? prev.conversionValue / prev.spend : 0),
        },
        performanceTier: getPerformanceTier({ spend, clicks, conversions, conversionValue, impressions }),
      };
    });

    // Try to fetch deduplicated per-campaign reach from Meta API
    // Only if we have a reasonable number of campaigns (avoid rate limits)
    try {
      const accountMetaIds = [...new Set(campaigns.map(c => c.meta_account_id))];
      const { data: accounts } = await supabase
        .from('meta_accounts')
        .select('id, meta_account_id, access_token')
        .in('id', accountMetaIds)
        .eq('is_active', true);

      if (accounts?.length) {
        // Build external_id -> enriched row lookup
        const externalIdMap = {};
        for (const c of campaigns) externalIdMap[c.external_id] = c.id;

        const allCampaignReach = {};
        await Promise.all(accounts.map(async (acc) => {
          const reachMap = await fetchPeriodReach(
            acc.meta_account_id, acc.access_token, dateFrom, dateTo, 'campaign'
          ).catch(() => ({}));
          // Map Meta campaign ID -> deduplicated reach
          for (const [metaCampId, reach] of Object.entries(reachMap)) {
            const dbId = externalIdMap[metaCampId];
            if (dbId) allCampaignReach[dbId] = reach;
          }
        }));

        // Apply deduplicated reach to enriched rows
        for (const row of enriched) {
          if (allCampaignReach[row.id] != null) {
            row.reach = allCampaignReach[row.id];
            row.reachEstimated = false;
          }
        }
      }
    } catch (reachErr) {
      console.warn('[Campaigns] Failed to fetch deduplicated campaign reach:', reachErr.message);
    }

    // Filter
    let filtered = enriched;
    if (performanceTier) filtered = filtered.filter(c => c.performanceTier === performanceTier);

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[sortBy], bVal = b[sortBy];
      if (typeof aVal === 'string') return sortOrder === 'desc' ? bVal?.localeCompare(aVal) : aVal?.localeCompare(bVal);
      return sortOrder === 'desc' ? (bVal || 0) - (aVal || 0) : (aVal || 0) - (bVal || 0);
    });

    // Paginate
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / limit);
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    // Summary
    const summary = {
      totalCampaigns: totalCount,
      activeCampaigns: filtered.filter(c => c.status === 'ACTIVE').length,
      totalSpend: filtered.reduce((s, c) => s + c.spend, 0),
      avgRoas: filtered.length > 0 ? +(filtered.reduce((s, c) => s + c.roas, 0) / filtered.length).toFixed(2) : 0,
      totalConversions: filtered.reduce((s, c) => s + c.conversions, 0),
      profitableCampaigns: filtered.filter(c => c.roas >= 1).length,
      losingCampaigns: filtered.filter(c => c.spend > 0 && c.roas < 1).length,
    };

    return NextResponse.json({
      campaigns: paginated,
      pagination: { page, limit, totalCount, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      summary,
    });
  } catch (err) {
    console.error('Campaigns API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getPerformanceTier(m) {
  const roas = m.spend > 0 ? m.conversionValue / m.spend : 0;
  if (m.spend === 0) return 'no_spend';
  if (roas >= 3) return 'top';
  if (roas >= 1) return 'average';
  if (m.conversions === 0 && m.spend > 0) return 'losing';
  return 'bottom';
}

function pctChange(c, p) { return p === 0 ? (c > 0 ? 100 : 0) : +((c - p) / p * 100).toFixed(1); }
