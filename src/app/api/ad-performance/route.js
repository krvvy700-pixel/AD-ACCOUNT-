import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchInsights } from '@/lib/meta-api';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// GET /api/ad-performance?level=campaign|adset|ad&from=&to=&account=
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const level = searchParams.get('level') || 'campaign';
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');
  const accountId = searchParams.get('account');

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'from and to dates required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    let accountQuery = supabase
      .from('meta_accounts')
      .select('id, meta_account_id, access_token, name, currency')
      .eq('is_active', true);
    if (accountId) accountQuery = accountQuery.eq('id', accountId);
    const { data: accounts } = await accountQuery;

    if (!accounts?.length) {
      return NextResponse.json({ data: [], error: 'No active accounts' });
    }

    if (level === 'campaign') {
      return await handleCampaigns(supabase, accounts, dateFrom, dateTo, accountId);
    } else if (level === 'adset') {
      return await handleAdSets(accounts, dateFrom, dateTo);
    } else if (level === 'ad') {
      return await handleAds(accounts, dateFrom, dateTo);
    }

    return NextResponse.json({ error: 'Invalid level' }, { status: 400 });
  } catch (err) {
    console.error('Ad performance API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// === CAMPAIGNS (from DB — fast & free, 2 queries only) ===
async function handleCampaigns(supabase, accounts, dateFrom, dateTo, accountId) {
  let campaignQuery = supabase
    .from('campaigns')
    .select('id, external_id, name, status, objective, meta_account_id');
  if (accountId) campaignQuery = campaignQuery.eq('meta_account_id', accountId);
  else campaignQuery = campaignQuery.in('meta_account_id', accounts.map(a => a.id));
  const { data: campaigns } = await campaignQuery;

  if (!campaigns?.length) return NextResponse.json({ data: [] });

  const campaignIds = campaigns.map(c => c.id);

  const { data: metrics } = await supabase
    .from('metrics')
    .select('campaign_id, spend, clicks, impressions, conversions, conversion_value')
    .eq('entity_type', 'campaign')
    .in('campaign_id', campaignIds)
    .gte('date', dateFrom)
    .lte('date', dateTo);

  const metricsMap = {};
  for (const m of (metrics || [])) {
    if (!metricsMap[m.campaign_id]) metricsMap[m.campaign_id] = { spend: 0, conversions: 0, impressions: 0, clicks: 0 };
    const a = metricsMap[m.campaign_id];
    a.spend += parseFloat(m.spend || 0);
    a.conversions += parseFloat(m.conversions || 0);
    a.impressions += parseInt(m.impressions || 0);
    a.clicks += parseInt(m.clicks || 0);
  }

  const data = campaigns.map(c => {
    const m = metricsMap[c.id] || { spend: 0, conversions: 0, impressions: 0, clicks: 0 };
    return {
      id: c.id,
      externalId: c.external_id,
      name: c.name,
      status: c.status,
      entityType: 'campaign',
      thumbnailUrl: null,
      results: m.conversions,
      cpr: m.conversions > 0 ? +(m.spend / m.conversions).toFixed(2) : 0,
      amountSpent: +m.spend.toFixed(2),
      cpm: m.impressions > 0 ? +((m.spend / m.impressions) * 1000).toFixed(2) : 0,
    };
  }).sort((a, b) => b.amountSpent - a.amountSpent);

  return NextResponse.json({ data });
}

// === AD SETS — 2 parallel API calls per account (insights + statuses) ===
async function handleAdSets(accounts, dateFrom, dateTo) {
  const allData = [];

  // Process all accounts in parallel
  await Promise.all(accounts.map(async (account) => {
    try {
      // Two calls in PARALLEL: insights + ad set statuses at account level
      const [insights, adSetStatuses] = await Promise.all([
        fetchInsights(account.meta_account_id, account.access_token, dateFrom, dateTo, 'adset'),
        fetchAccountAdSets(account.meta_account_id, account.access_token),
      ]);

      // Build status lookup
      const statusMap = {};
      for (const as of adSetStatuses) {
        statusMap[as.id] = as.status;
      }

      // Aggregate insights by ad set
      const adSetMap = {};
      for (const row of insights) {
        if (!adSetMap[row.adSetId]) {
          adSetMap[row.adSetId] = {
            id: row.adSetId, externalId: row.adSetId, name: row.adSetName,
            entityType: 'adset', thumbnailUrl: null,
            spend: 0, conversions: 0, impressions: 0,
          };
        }
        const a = adSetMap[row.adSetId];
        a.spend += row.spend;
        a.conversions += row.conversions;
        a.impressions += row.impressions;
      }

      for (const as of Object.values(adSetMap)) {
        as.status = statusMap[as.externalId] || 'UNKNOWN';
        as.results = as.conversions;
        as.cpr = as.conversions > 0 ? +(as.spend / as.conversions).toFixed(2) : 0;
        as.amountSpent = +as.spend.toFixed(2);
        as.cpm = as.impressions > 0 ? +((as.spend / as.impressions) * 1000).toFixed(2) : 0;
        delete as.spend; delete as.conversions; delete as.impressions;
        allData.push(as);
      }
    } catch (err) {
      console.error(`Ad set fetch error for ${account.name}:`, err.message);
    }
  }));

  allData.sort((a, b) => b.amountSpent - a.amountSpent);
  return NextResponse.json({ data: allData });
}

// === ADS — 2 parallel API calls per account (insights + ad details) ===
async function handleAds(accounts, dateFrom, dateTo) {
  const allData = [];

  // Process all accounts in parallel
  await Promise.all(accounts.map(async (account) => {
    try {
      // Two calls in PARALLEL: insights + ad details (status + thumbnail) at account level
      const [insights, adDetailsList] = await Promise.all([
        fetchInsights(account.meta_account_id, account.access_token, dateFrom, dateTo, 'ad'),
        fetchAccountAds(account.meta_account_id, account.access_token),
      ]);

      // Build details lookup
      const detailsMap = {};
      for (const ad of adDetailsList) {
        detailsMap[ad.id] = ad;
      }

      // Aggregate insights by ad
      const adMap = {};
      for (const row of insights) {
        if (!adMap[row.adId]) {
          adMap[row.adId] = {
            id: row.adId, externalId: row.adId, name: row.adName,
            entityType: 'ad',
            spend: 0, conversions: 0, impressions: 0,
          };
        }
        const a = adMap[row.adId];
        a.spend += row.spend;
        a.conversions += row.conversions;
        a.impressions += row.impressions;
      }

      for (const ad of Object.values(adMap)) {
        const detail = detailsMap[ad.externalId] || {};
        ad.status = detail.status || 'UNKNOWN';
        ad.thumbnailUrl = detail.thumbnailUrl || null;
        ad.creativeType = detail.creativeType || null;
        ad.results = ad.conversions;
        ad.cpr = ad.conversions > 0 ? +(ad.spend / ad.conversions).toFixed(2) : 0;
        ad.amountSpent = +ad.spend.toFixed(2);
        ad.cpm = ad.impressions > 0 ? +((ad.spend / ad.impressions) * 1000).toFixed(2) : 0;
        delete ad.spend; delete ad.conversions; delete ad.impressions;
        allData.push(ad);
      }
    } catch (err) {
      console.error(`Ad fetch error for ${account.name}:`, err.message);
    }
  }));

  allData.sort((a, b) => b.amountSpent - a.amountSpent);
  return NextResponse.json({ data: allData });
}

// ===================================================================
// OPTIMIZED BULK FETCHERS — 1 API call per entity type per account
// ===================================================================

/**
 * Fetch ALL ad sets for an account in ONE call (with status)
 * Instead of: campaigns → adsets per campaign (N+1 calls)
 */
async function fetchAccountAdSets(accountId, accessToken) {
  const res = await fetch(
    `${META_GRAPH_URL}/act_${accountId}/adsets?fields=id,name,status&limit=500&access_token=${accessToken}`
  );
  if (!res.ok) return [];
  const { data } = await res.json();
  return (data || []).map(a => ({ id: a.id, name: a.name, status: a.status }));
}

/**
 * Fetch ALL ads for an account in ONE call (with status + thumbnail)
 * Instead of: campaigns → adsets → ads per adset (N×M calls)
 */
async function fetchAccountAds(accountId, accessToken) {
  const res = await fetch(
    `${META_GRAPH_URL}/act_${accountId}/ads?fields=id,name,status,creative{thumbnail_url,object_type}&limit=500&access_token=${accessToken}`
  );
  if (!res.ok) return [];
  const { data } = await res.json();
  return (data || []).map(ad => ({
    id: ad.id,
    name: ad.name,
    status: ad.status,
    thumbnailUrl: ad.creative?.thumbnail_url || null,
    creativeType: ad.creative?.object_type || null,
  }));
}
