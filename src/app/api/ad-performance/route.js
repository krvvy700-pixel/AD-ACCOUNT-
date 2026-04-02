import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchInsights, fetchAds, fetchAdSets } from '@/lib/meta-api';

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
    // Get all active accounts (or filter by specific account)
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
      return await handleAdSets(supabase, accounts, dateFrom, dateTo);
    } else if (level === 'ad') {
      return await handleAds(supabase, accounts, dateFrom, dateTo);
    }

    return NextResponse.json({ error: 'Invalid level' }, { status: 400 });
  } catch (err) {
    console.error('Ad performance API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// === CAMPAIGNS (from DB — fast & free) ===
async function handleCampaigns(supabase, accounts, dateFrom, dateTo, accountId) {
  let campaignQuery = supabase
    .from('campaigns')
    .select('id, external_id, name, status, objective, meta_account_id');
  if (accountId) campaignQuery = campaignQuery.eq('meta_account_id', accountId);
  else campaignQuery = campaignQuery.in('meta_account_id', accounts.map(a => a.id));
  const { data: campaigns } = await campaignQuery;

  if (!campaigns?.length) return NextResponse.json({ data: [] });

  const campaignIds = campaigns.map(c => c.id);

  // Get metrics from DB
  const { data: metrics } = await supabase
    .from('metrics')
    .select('campaign_id, spend, clicks, impressions, conversions, conversion_value')
    .eq('entity_type', 'campaign')
    .in('campaign_id', campaignIds)
    .gte('date', dateFrom)
    .lte('date', dateTo);

  // Aggregate
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

// === AD SETS (from Meta API — live, accurate) ===
async function handleAdSets(supabase, accounts, dateFrom, dateTo) {
  const allData = [];

  for (const account of accounts) {
    try {
      // Fetch adset-level insights from Meta API
      const insights = await fetchInsights(
        account.meta_account_id, account.access_token,
        dateFrom, dateTo, 'adset'
      );

      // Aggregate insights by ad set
      const adSetMap = {};
      for (const row of insights) {
        if (!adSetMap[row.adSetId]) {
          adSetMap[row.adSetId] = {
            id: row.adSetId,
            externalId: row.adSetId,
            name: row.adSetName,
            entityType: 'adset',
            thumbnailUrl: null,
            spend: 0, conversions: 0, impressions: 0,
          };
        }
        const a = adSetMap[row.adSetId];
        a.spend += row.spend;
        a.conversions += row.conversions;
        a.impressions += row.impressions;
      }

      // Get ad set statuses via separate call
      let adSetStatuses = {};
      try {
        // Get campaigns first to fetch their ad sets
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('external_id')
          .eq('meta_account_id', account.id);

        for (const camp of (campaigns || [])) {
          try {
            const adSets = await fetchAdSets(camp.external_id, account.access_token);
            for (const as of adSets) {
              adSetStatuses[as.externalId] = as.status;
            }
          } catch {}
        }
      } catch {}

      for (const as of Object.values(adSetMap)) {
        as.status = adSetStatuses[as.externalId] || 'UNKNOWN';
        as.results = as.conversions;
        as.cpr = as.conversions > 0 ? +(as.spend / as.conversions).toFixed(2) : 0;
        as.amountSpent = +as.spend.toFixed(2);
        as.cpm = as.impressions > 0 ? +((as.spend / as.impressions) * 1000).toFixed(2) : 0;
        delete as.spend;
        delete as.conversions;
        delete as.impressions;
        allData.push(as);
      }
    } catch (err) {
      console.error(`Ad set fetch error for ${account.name}:`, err.message);
    }
  }

  allData.sort((a, b) => b.amountSpent - a.amountSpent);
  return NextResponse.json({ data: allData });
}

// === ADS (from Meta API — live, accurate, with thumbnails) ===
async function handleAds(supabase, accounts, dateFrom, dateTo) {
  const allData = [];

  for (const account of accounts) {
    try {
      // Fetch ad-level insights from Meta API
      const insights = await fetchInsights(
        account.meta_account_id, account.access_token,
        dateFrom, dateTo, 'ad'
      );

      // Aggregate insights by ad
      const adMap = {};
      for (const row of insights) {
        if (!adMap[row.adId]) {
          adMap[row.adId] = {
            id: row.adId,
            externalId: row.adId,
            name: row.adName,
            entityType: 'ad',
            spend: 0, conversions: 0, impressions: 0,
          };
        }
        const a = adMap[row.adId];
        a.spend += row.spend;
        a.conversions += row.conversions;
        a.impressions += row.impressions;
      }

      // Get ad details (status + thumbnail) via separate call
      let adDetails = {};
      try {
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('external_id')
          .eq('meta_account_id', account.id);

        for (const camp of (campaigns || [])) {
          try {
            const adSets = await fetchAdSets(camp.external_id, account.access_token);
            for (const as of adSets) {
              try {
                const ads = await fetchAds(as.externalId, account.access_token);
                for (const ad of ads) {
                  adDetails[ad.externalId] = {
                    status: ad.status,
                    thumbnailUrl: ad.thumbnailUrl,
                    creativeType: ad.creativeType,
                  };
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}

      for (const ad of Object.values(adMap)) {
        const detail = adDetails[ad.externalId] || {};
        ad.status = detail.status || 'UNKNOWN';
        ad.thumbnailUrl = detail.thumbnailUrl || null;
        ad.creativeType = detail.creativeType || null;
        ad.results = ad.conversions;
        ad.cpr = ad.conversions > 0 ? +(ad.spend / ad.conversions).toFixed(2) : 0;
        ad.amountSpent = +ad.spend.toFixed(2);
        ad.cpm = ad.impressions > 0 ? +((ad.spend / ad.impressions) * 1000).toFixed(2) : 0;
        delete ad.spend;
        delete ad.conversions;
        delete ad.impressions;
        allData.push(ad);
      }
    } catch (err) {
      console.error(`Ad fetch error for ${account.name}:`, err.message);
    }
  }

  allData.sort((a, b) => b.amountSpent - a.amountSpent);
  return NextResponse.json({ data: allData });
}
