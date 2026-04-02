import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

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
    const enriched = campaigns.map(c => {
      const curr = currMap[c.id] || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 };
      const prev = prevMap[c.id] || { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };

      return {
        id: c.id, externalId: c.external_id, name: c.name, status: c.status, objective: c.objective,
        dailyBudget: c.daily_budget, lifetimeBudget: c.lifetime_budget,
        accountName: c.meta_accounts?.name || 'Unknown',
        spend: curr.spend, impressions: curr.impressions, clicks: curr.clicks,
        conversions: curr.conversions, conversionValue: curr.conversionValue, reach: curr.reach,
        cpc: curr.clicks > 0 ? +(curr.spend / curr.clicks).toFixed(4) : 0,
        ctr: curr.impressions > 0 ? +((curr.clicks / curr.impressions) * 100).toFixed(4) : 0,
        roas: curr.spend > 0 ? +(curr.conversionValue / curr.spend).toFixed(4) : 0,
        cpa: curr.conversions > 0 ? +(curr.spend / curr.conversions).toFixed(2) : 0,
        changes: {
          spend: pctChange(curr.spend, prev.spend),
          clicks: pctChange(curr.clicks, prev.clicks),
          conversions: pctChange(curr.conversions, prev.conversions),
          roas: pctChange(curr.spend > 0 ? curr.conversionValue / curr.spend : 0, prev.spend > 0 ? prev.conversionValue / prev.spend : 0),
        },
        performanceTier: getPerformanceTier(curr),
      };
    });

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
