import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET /api/analytics/overview — Advanced KPI + Chart data
//
// Query params:
//   days=7              — Quick preset (1, 3, 7, 14, 30, 90)
//   from=2026-03-01     — Custom start date (overrides days)
//   to=2026-03-31       — Custom end date (overrides days)
//   account=uuid        — Filter by specific Meta account
//   compare=previous    — Comparison mode: 'previous' (auto prev period), 'yoy' (year-over-year)
//   breakdown=day       — Chart breakdown: 'day', 'week', 'month'
//   status=ACTIVE       — Filter campaigns by status (comma-separated)
//   objective=CONVERSIONS — Filter by objective (comma-separated)
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

  const accountId = searchParams.get('account');
  const compareMode = searchParams.get('compare') || 'previous'; // 'previous' | 'yoy' | 'none'
  const breakdown = searchParams.get('breakdown') || 'day'; // 'day' | 'week' | 'month'
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || [];
  const objectiveFilter = searchParams.get('objective')?.split(',').filter(Boolean) || [];

  const supabase = getSupabaseServer();

  try {
    // --- Get campaign IDs matching filters ---
    const campaignIds = await getFilteredCampaignIds(supabase, { accountId, statusFilter, objectiveFilter });

    // --- Fetch current period metrics ---
    const currentMetrics = await fetchMetrics(supabase, {
      dateFrom, dateTo, campaignIds, entityType: 'campaign'
    });

    // --- Fetch comparison period metrics ---
    const { compFrom, compTo } = getComparisonDates(dateFrom, dateTo, compareMode);
    const previousMetrics = compFrom ? await fetchMetrics(supabase, {
      dateFrom: compFrom, dateTo: compTo, campaignIds, entityType: 'campaign'
    }) : [];

    // --- Aggregate KPIs ---
    const current = aggregateMetrics(currentMetrics);
    const previous = aggregateMetrics(previousMetrics);

    // --- Build chart data with breakdown ---
    const chartData = buildChartData(currentMetrics, breakdown);

    // --- Top / Bottom performers ---
    const campaignPerformance = await getCampaignPerformance(supabase, { dateFrom, dateTo, campaignIds });

    // --- Spend distribution by objective ---
    const objectiveBreakdown = await getObjectiveBreakdown(supabase, { dateFrom, dateTo, campaignIds });

    // --- Hourly/daily trend detection ---
    const trends = detectTrends(chartData);

    return NextResponse.json({
      kpis: buildKPIs(current, previous),
      chart: chartData,
      performance: {
        topCampaigns: campaignPerformance.slice(0, 5),
        bottomCampaigns: campaignPerformance.slice(-5).reverse(),
      },
      objectiveBreakdown,
      trends,
      period: {
        from: dateFrom,
        to: dateTo,
        comparisonFrom: compFrom,
        comparisonTo: compTo,
        compareMode,
        breakdown,
      },
      filters: {
        account: accountId,
        status: statusFilter,
        objective: objectiveFilter,
      },
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ================================================
// HELPER FUNCTIONS
// ================================================

async function getFilteredCampaignIds(supabase, { accountId, statusFilter, objectiveFilter }) {
  let query = supabase.from('campaigns').select('id');

  if (accountId) query = query.eq('meta_account_id', accountId);
  if (statusFilter.length) query = query.in('status', statusFilter);
  if (objectiveFilter.length) query = query.in('objective', objectiveFilter);

  const { data } = await query;
  return data?.map(c => c.id) || [];
}

async function fetchMetrics(supabase, { dateFrom, dateTo, campaignIds, entityType }) {
  let query = supabase
    .from('metrics')
    .select('spend, impressions, clicks, conversions, conversion_value, reach, frequency, date, campaign_id')
    .eq('entity_type', entityType)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: true });

  if (campaignIds?.length) {
    query = query.in('campaign_id', campaignIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function aggregateMetrics(rows) {
  return rows.reduce((acc, r) => ({
    spend: acc.spend + parseFloat(r.spend || 0),
    impressions: acc.impressions + parseInt(r.impressions || 0),
    clicks: acc.clicks + parseInt(r.clicks || 0),
    conversions: acc.conversions + parseFloat(r.conversions || 0),
    conversionValue: acc.conversionValue + parseFloat(r.conversion_value || 0),
    reach: acc.reach + parseInt(r.reach || 0),
  }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0 });
}

function buildKPIs(current, previous) {
  const cpc = current.clicks > 0 ? current.spend / current.clicks : 0;
  const prevCpc = previous.clicks > 0 ? previous.spend / previous.clicks : 0;
  const ctr = current.impressions > 0 ? (current.clicks / current.impressions) * 100 : 0;
  const prevCtr = previous.impressions > 0 ? (previous.clicks / previous.impressions) * 100 : 0;
  const roas = current.spend > 0 ? current.conversionValue / current.spend : 0;
  const prevRoas = previous.spend > 0 ? previous.conversionValue / previous.spend : 0;
  const cpm = current.impressions > 0 ? (current.spend / current.impressions) * 1000 : 0;
  const prevCpm = previous.impressions > 0 ? (previous.spend / previous.impressions) * 1000 : 0;
  const cpa = current.conversions > 0 ? current.spend / current.conversions : 0;
  const prevCpa = previous.conversions > 0 ? previous.spend / previous.conversions : 0;
  const convRate = current.clicks > 0 ? (current.conversions / current.clicks) * 100 : 0;
  const prevConvRate = previous.clicks > 0 ? (previous.conversions / previous.clicks) * 100 : 0;

  return {
    spend: { value: current.spend, change: pctChange(current.spend, previous.spend) },
    impressions: { value: current.impressions, change: pctChange(current.impressions, previous.impressions) },
    clicks: { value: current.clicks, change: pctChange(current.clicks, previous.clicks) },
    reach: { value: current.reach, change: pctChange(current.reach, previous.reach) },
    conversions: { value: current.conversions, change: pctChange(current.conversions, previous.conversions) },
    conversionValue: { value: current.conversionValue, change: pctChange(current.conversionValue, previous.conversionValue) },
    cpc: { value: cpc, change: pctChange(cpc, prevCpc) },
    ctr: { value: ctr, change: pctChange(ctr, prevCtr) },
    roas: { value: roas, change: pctChange(roas, prevRoas) },
    cpm: { value: cpm, change: pctChange(cpm, prevCpm) },
    cpa: { value: cpa, change: pctChange(cpa, prevCpa) },
    conversionRate: { value: convRate, change: pctChange(convRate, prevConvRate) },
  };
}

function buildChartData(rows, breakdown) {
  const map = {};

  for (const r of rows) {
    const key = getBreakdownKey(r.date, breakdown);
    if (!map[key]) {
      map[key] = { date: key, spend: 0, conversions: 0, clicks: 0, impressions: 0, reach: 0, conversionValue: 0 };
    }
    map[key].spend += parseFloat(r.spend || 0);
    map[key].conversions += parseFloat(r.conversions || 0);
    map[key].clicks += parseInt(r.clicks || 0);
    map[key].impressions += parseInt(r.impressions || 0);
    map[key].reach += parseInt(r.reach || 0);
    map[key].conversionValue += parseFloat(r.conversion_value || 0);
  }

  // Add computed metrics to each point
  return Object.values(map).map(point => ({
    ...point,
    cpc: point.clicks > 0 ? +(point.spend / point.clicks).toFixed(2) : 0,
    ctr: point.impressions > 0 ? +((point.clicks / point.impressions) * 100).toFixed(2) : 0,
    roas: point.spend > 0 ? +(point.conversionValue / point.spend).toFixed(2) : 0,
    cpm: point.impressions > 0 ? +((point.spend / point.impressions) * 1000).toFixed(2) : 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function getBreakdownKey(dateStr, breakdown) {
  const d = new Date(dateStr);
  switch (breakdown) {
    case 'week': {
      // ISO week start (Monday)
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff));
      return weekStart.toISOString().split('T')[0];
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    default:
      return dateStr;
  }
}

async function getCampaignPerformance(supabase, { dateFrom, dateTo, campaignIds }) {
  // Fetch all campaign metrics individually
  const results = [];

  for (const cId of campaignIds) {
    const { data: metrics } = await supabase
      .from('metrics')
      .select('spend, clicks, conversions, conversion_value, impressions')
      .eq('entity_type', 'campaign')
      .eq('campaign_id', cId)
      .gte('date', dateFrom)
      .lte('date', dateTo);

    const agg = aggregateMetrics(metrics || []);
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('name, status, objective')
      .eq('id', cId)
      .single();

    if (campaign) {
      results.push({
        id: cId,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        spend: agg.spend,
        conversions: agg.conversions,
        roas: agg.spend > 0 ? agg.conversionValue / agg.spend : 0,
        cpc: agg.clicks > 0 ? agg.spend / agg.clicks : 0,
        ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      });
    }
  }

  // Sort by ROAS descending (best performers first)
  return results.sort((a, b) => b.roas - a.roas);
}

async function getObjectiveBreakdown(supabase, { dateFrom, dateTo, campaignIds }) {
  if (!campaignIds.length) return [];

  // Get campaign objectives
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, objective')
    .in('id', campaignIds);

  const objectiveMap = {};
  for (const c of (campaigns || [])) {
    if (!objectiveMap[c.objective || 'UNKNOWN']) {
      objectiveMap[c.objective || 'UNKNOWN'] = { objective: c.objective || 'UNKNOWN', campaignIds: [], spend: 0, conversions: 0, clicks: 0, impressions: 0 };
    }
    objectiveMap[c.objective || 'UNKNOWN'].campaignIds.push(c.id);
  }

  // Fetch metrics per objective group
  for (const obj of Object.values(objectiveMap)) {
    const { data: metrics } = await supabase
      .from('metrics')
      .select('spend, clicks, conversions, impressions')
      .eq('entity_type', 'campaign')
      .in('campaign_id', obj.campaignIds)
      .gte('date', dateFrom)
      .lte('date', dateTo);

    const agg = aggregateMetrics(metrics || []);
    obj.spend = agg.spend;
    obj.conversions = agg.conversions;
    obj.clicks = agg.clicks;
    obj.impressions = agg.impressions;
    obj.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
    delete obj.campaignIds;
  }

  return Object.values(objectiveMap).sort((a, b) => b.spend - a.spend);
}

function detectTrends(chartData) {
  if (chartData.length < 3) return { spend: 'insufficient_data', conversions: 'insufficient_data' };

  const trends = {};
  for (const metric of ['spend', 'conversions', 'cpc', 'roas']) {
    const values = chartData.map(d => d[metric]).filter(v => v != null);
    if (values.length < 3) { trends[metric] = 'insufficient_data'; continue; }

    // Simple linear regression slope
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (values[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const pctSlope = yMean !== 0 ? (slope / yMean) * 100 : 0;

    if (pctSlope > 5) trends[metric] = 'increasing';
    else if (pctSlope < -5) trends[metric] = 'decreasing';
    else trends[metric] = 'stable';
  }

  return trends;
}

function getComparisonDates(dateFrom, dateTo, compareMode) {
  if (compareMode === 'none') return { compFrom: null, compTo: null };

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const daysDiff = Math.ceil((to - from) / 86400000);

  if (compareMode === 'yoy') {
    // Year-over-year
    const compTo = new Date(from);
    compTo.setFullYear(compTo.getFullYear() - 1);
    compTo.setDate(compTo.getDate() + daysDiff);
    const compFrom = new Date(from);
    compFrom.setFullYear(compFrom.getFullYear() - 1);
    return {
      compFrom: compFrom.toISOString().split('T')[0],
      compTo: compTo.toISOString().split('T')[0],
    };
  }

  // Default: previous period (same duration, immediately before)
  const compTo2 = new Date(from);
  compTo2.setDate(compTo2.getDate() - 1);
  const compFrom2 = new Date(compTo2);
  compFrom2.setDate(compFrom2.getDate() - daysDiff);

  return {
    compFrom: compFrom2.toISOString().split('T')[0],
    compTo: compTo2.toISOString().split('T')[0],
  };
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return +((current - previous) / previous * 100).toFixed(1);
}
