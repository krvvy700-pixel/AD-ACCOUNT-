import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET /api/analytics/campaigns — Advanced campaign table with full filtering
//
// Query params:
//   --- Date Range ---
//   days=7                  — Quick preset
//   from=2026-03-01         — Custom start date (overrides days)
//   to=2026-03-31           — Custom end date
//
//   --- Filtering ---
//   account=uuid            — Filter by Meta account
//   status=ACTIVE,PAUSED    — Filter by campaign status (comma-separated)
//   objective=CONVERSIONS   — Filter by objective (comma-separated)
//   search=summer           — Search campaign name (case-insensitive partial match)
//   minSpend=50             — Min spend filter
//   maxSpend=1000           — Max spend filter
//   minRoas=1.0             — Min ROAS filter
//   maxRoas=10.0            — Max ROAS filter
//   minConversions=5        — Min conversions filter
//   minClicks=100           — Min clicks filter
//   performance=top|bottom|losing — Performance tier filter
//
//   --- Sorting ---
//   sort=spend              — Sort field (any metric or 'name', 'status')
//   order=desc              — 'asc' or 'desc'
//   sort2=roas              — Secondary sort field
//   order2=desc             — Secondary sort order
//
//   --- Pagination ---
//   page=1                  — Page number (1-indexed)
//   limit=25                — Items per page (max 100)
//
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // --- Parse date range ---
  let dateFrom, dateTo;
  if (searchParams.get('from') && searchParams.get('to')) {
    dateFrom = searchParams.get('from');
    dateTo = searchParams.get('to');
  } else {
    const days = parseInt(searchParams.get('days') || '7');
    dateTo = new Date().toISOString().split('T')[0];
    dateFrom = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  }

  // --- Filters ---
  const accountId = searchParams.get('account');
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || [];
  const objectiveFilter = searchParams.get('objective')?.split(',').filter(Boolean) || [];
  const searchQuery = searchParams.get('search')?.trim().toLowerCase() || '';
  const minSpend = parseFloat(searchParams.get('minSpend') || '0');
  const maxSpend = parseFloat(searchParams.get('maxSpend') || 'Infinity');
  const minRoas = parseFloat(searchParams.get('minRoas') || '0');
  const maxRoas = parseFloat(searchParams.get('maxRoas') || 'Infinity');
  const minConversions = parseFloat(searchParams.get('minConversions') || '0');
  const minClicks = parseInt(searchParams.get('minClicks') || '0');
  const performanceTier = searchParams.get('performance'); // 'top' | 'bottom' | 'losing'

  // --- Sorting ---
  const sortBy = searchParams.get('sort') || 'spend';
  const sortOrder = searchParams.get('order') || 'desc';
  const sort2 = searchParams.get('sort2');
  const order2 = searchParams.get('order2') || 'desc';

  // --- Pagination ---
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));

  const supabase = getSupabaseServer();

  try {
    // --- Fetch campaigns with filters ---
    let campaignQuery = supabase
      .from('campaigns')
      .select('id, external_id, name, status, objective, daily_budget, lifetime_budget, buying_type, start_date, end_date, meta_account_id, meta_accounts(name, currency)');

    if (accountId) campaignQuery = campaignQuery.eq('meta_account_id', accountId);
    if (statusFilter.length) campaignQuery = campaignQuery.in('status', statusFilter);
    if (objectiveFilter.length) campaignQuery = campaignQuery.in('objective', objectiveFilter);
    if (searchQuery) campaignQuery = campaignQuery.ilike('name', `%${searchQuery}%`);

    const { data: campaigns, error: campErr } = await campaignQuery;
    if (campErr) throw campErr;

    // --- Fetch and aggregate metrics for each campaign ---
    const enriched = [];
    for (const c of (campaigns || [])) {
      const { data: currentMetrics } = await supabase
        .from('metrics')
        .select('spend, impressions, clicks, conversions, conversion_value, reach, frequency')
        .eq('entity_type', 'campaign')
        .eq('campaign_id', c.id)
        .gte('date', dateFrom)
        .lte('date', dateTo);

      // Previous period for comparison
      const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000);
      const prevTo = new Date(new Date(dateFrom).getTime() - 86400000).toISOString().split('T')[0];
      const prevFrom = new Date(new Date(dateFrom).getTime() - (daysDiff + 1) * 86400000).toISOString().split('T')[0];

      const { data: prevMetrics } = await supabase
        .from('metrics')
        .select('spend, impressions, clicks, conversions, conversion_value')
        .eq('entity_type', 'campaign')
        .eq('campaign_id', c.id)
        .gte('date', prevFrom)
        .lte('date', prevTo);

      const curr = agg(currentMetrics || []);
      const prev = agg(prevMetrics || []);

      const row = {
        id: c.id,
        externalId: c.external_id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        dailyBudget: c.daily_budget,
        lifetimeBudget: c.lifetime_budget,
        buyingType: c.buying_type,
        startDate: c.start_date,
        endDate: c.end_date,
        accountName: c.meta_accounts?.name || 'Unknown',
        accountCurrency: c.meta_accounts?.currency || 'USD',

        // Current period metrics
        spend: curr.spend,
        impressions: curr.impressions,
        clicks: curr.clicks,
        conversions: curr.conversions,
        conversionValue: curr.conversionValue,
        reach: curr.reach,

        // Computed metrics
        cpc: curr.clicks > 0 ? +(curr.spend / curr.clicks).toFixed(4) : 0,
        ctr: curr.impressions > 0 ? +((curr.clicks / curr.impressions) * 100).toFixed(4) : 0,
        cpm: curr.impressions > 0 ? +((curr.spend / curr.impressions) * 1000).toFixed(4) : 0,
        roas: curr.spend > 0 ? +(curr.conversionValue / curr.spend).toFixed(4) : 0,
        cpa: curr.conversions > 0 ? +(curr.spend / curr.conversions).toFixed(2) : 0,
        conversionRate: curr.clicks > 0 ? +((curr.conversions / curr.clicks) * 100).toFixed(2) : 0,

        // Period-over-period changes
        changes: {
          spend: pctChange(curr.spend, prev.spend),
          clicks: pctChange(curr.clicks, prev.clicks),
          conversions: pctChange(curr.conversions, prev.conversions),
          roas: pctChange(
            curr.spend > 0 ? curr.conversionValue / curr.spend : 0,
            prev.spend > 0 ? prev.conversionValue / prev.spend : 0
          ),
          cpc: pctChange(
            curr.clicks > 0 ? curr.spend / curr.clicks : 0,
            prev.clicks > 0 ? prev.spend / prev.clicks : 0
          ),
        },

        // Performance tier
        performanceTier: getPerformanceTier(curr),
      };

      enriched.push(row);
    }

    // --- Apply metric filters ---
    let filtered = enriched.filter(c => {
      if (c.spend < minSpend) return false;
      if (isFinite(maxSpend) && c.spend > maxSpend) return false;
      if (c.roas < minRoas) return false;
      if (isFinite(maxRoas) && c.roas > maxRoas) return false;
      if (c.conversions < minConversions) return false;
      if (c.clicks < minClicks) return false;
      if (performanceTier && c.performanceTier !== performanceTier) return false;
      return true;
    });

    // --- Multi-level sort ---
    filtered.sort((a, b) => {
      const primary = compareValues(a, b, sortBy, sortOrder);
      if (primary !== 0 || !sort2) return primary;
      return compareValues(a, b, sort2, order2);
    });

    // --- Pagination ---
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIdx = (page - 1) * limit;
    const paginated = filtered.slice(startIdx, startIdx + limit);

    // --- Summary stats for the filtered set ---
    const summary = {
      totalCampaigns: totalCount,
      activeCampaigns: filtered.filter(c => c.status === 'ACTIVE').length,
      pausedCampaigns: filtered.filter(c => c.status === 'PAUSED').length,
      totalSpend: filtered.reduce((s, c) => s + c.spend, 0),
      avgRoas: filtered.length > 0
        ? +(filtered.reduce((s, c) => s + c.roas, 0) / filtered.length).toFixed(2) : 0,
      avgCpc: filtered.length > 0
        ? +(filtered.reduce((s, c) => s + c.cpc, 0) / filtered.length).toFixed(2) : 0,
      totalConversions: filtered.reduce((s, c) => s + c.conversions, 0),
      profitableCampaigns: filtered.filter(c => c.roas >= 1).length,
      losingCampaigns: filtered.filter(c => c.spend > 0 && c.roas < 1).length,
    };

    // --- Available filter options (for UI dropdowns) ---
    const filterOptions = {
      statuses: [...new Set(enriched.map(c => c.status))].sort(),
      objectives: [...new Set(enriched.map(c => c.objective).filter(Boolean))].sort(),
      accounts: [...new Set(enriched.map(c => c.accountName))].sort(),
      spendRange: {
        min: Math.min(...enriched.map(c => c.spend)),
        max: Math.max(...enriched.map(c => c.spend)),
      },
      roasRange: {
        min: Math.min(...enriched.map(c => c.roas)),
        max: Math.max(...enriched.map(c => c.roas)),
      },
    };

    return NextResponse.json({
      campaigns: paginated,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      summary,
      filterOptions,
      sorting: { primary: { field: sortBy, order: sortOrder }, secondary: sort2 ? { field: sort2, order: order2 } : null },
    });
  } catch (err) {
    console.error('Campaigns API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ================================================
// HELPERS
// ================================================

function agg(rows) {
  return rows.reduce((a, m) => ({
    spend: a.spend + parseFloat(m.spend || 0),
    impressions: a.impressions + parseInt(m.impressions || 0),
    clicks: a.clicks + parseInt(m.clicks || 0),
    conversions: a.conversions + parseFloat(m.conversions || 0),
    conversionValue: a.conversionValue + parseFloat(m.conversion_value || 0),
    reach: a.reach + parseInt(m.reach || 0),
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 });
}

function getPerformanceTier(metrics) {
  const roas = metrics.spend > 0 ? metrics.conversionValue / metrics.spend : 0;
  if (metrics.spend === 0) return 'no_spend';
  if (roas >= 3) return 'top';
  if (roas >= 1) return 'average';
  if (roas > 0) return 'bottom';
  if (metrics.conversions === 0 && metrics.spend > 0) return 'losing';
  return 'bottom';
}

function compareValues(a, b, field, order) {
  let aVal = a[field];
  let bVal = b[field];

  // Handle string fields
  if (typeof aVal === 'string') {
    aVal = aVal.toLowerCase();
    bVal = (bVal || '').toLowerCase();
    const cmp = aVal.localeCompare(bVal);
    return order === 'desc' ? -cmp : cmp;
  }

  // Numeric fields
  aVal = aVal || 0;
  bVal = bVal || 0;
  return order === 'desc' ? bVal - aVal : aVal - bVal;
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return +((current - previous) / previous * 100).toFixed(1);
}
