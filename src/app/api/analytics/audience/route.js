import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// GET /api/analytics/audience?account=UUID&from=&to=
// Returns demographic breakdowns from Meta Insights API
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account');
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  const supabase = getSupabaseServer();

  try {
    // Get account(s)
    let accounts;
    if (accountId && accountId !== 'all') {
      const { data } = await supabase.from('meta_accounts').select('*').eq('id', accountId).eq('is_active', true);
      accounts = data;
    } else {
      const { data } = await supabase.from('meta_accounts').select('*').eq('is_active', true);
      accounts = data;
    }

    if (!accounts?.length) return NextResponse.json({ error: 'No accounts found' }, { status: 404 });

    const allAgeGender = {};
    const allCountry = {};
    const allDevice = {};

    for (const account of accounts) {
      // Age + Gender breakdown
      try {
        const ageGenderData = await fetchBreakdown(account.meta_account_id, account.access_token, dateFrom, dateTo, 'age,gender');
        for (const row of ageGenderData) {
          const ageKey = row.age || 'Unknown';
          const genderKey = row.gender === 'male' ? 'Male' : row.gender === 'female' ? 'Female' : 'Unknown';
          // Age breakdown
          if (!allAgeGender[ageKey]) allAgeGender[ageKey] = { age: ageKey, spend: 0, clicks: 0, impressions: 0, conversions: 0 };
          allAgeGender[ageKey].spend += parseFloat(row.spend || 0);
          allAgeGender[ageKey].clicks += parseInt(row.clicks || 0);
          allAgeGender[ageKey].impressions += parseInt(row.impressions || 0);
        }
      } catch (e) { console.warn('Age/gender breakdown failed:', e.message); }

      // Country breakdown
      try {
        const countryData = await fetchBreakdown(account.meta_account_id, account.access_token, dateFrom, dateTo, 'country');
        for (const row of countryData) {
          const key = row.country || 'Unknown';
          if (!allCountry[key]) allCountry[key] = { country: key, spend: 0, clicks: 0, impressions: 0, reach: 0 };
          allCountry[key].spend += parseFloat(row.spend || 0);
          allCountry[key].clicks += parseInt(row.clicks || 0);
          allCountry[key].impressions += parseInt(row.impressions || 0);
          allCountry[key].reach += parseInt(row.reach || 0);
        }
      } catch (e) { console.warn('Country breakdown failed:', e.message); }

      // Device breakdown
      try {
        const deviceData = await fetchBreakdown(account.meta_account_id, account.access_token, dateFrom, dateTo, 'device_platform');
        for (const row of deviceData) {
          const key = row.device_platform || 'Unknown';
          if (!allDevice[key]) allDevice[key] = { device: key, spend: 0, clicks: 0, impressions: 0 };
          allDevice[key].spend += parseFloat(row.spend || 0);
          allDevice[key].clicks += parseInt(row.clicks || 0);
          allDevice[key].impressions += parseInt(row.impressions || 0);
        }
      } catch (e) { console.warn('Device breakdown failed:', e.message); }
    }

    return NextResponse.json({
      ageGender: Object.values(allAgeGender).sort((a, b) => b.spend - a.spend),
      country: Object.values(allCountry).sort((a, b) => b.spend - a.spend).slice(0, 15),
      device: Object.values(allDevice).sort((a, b) => b.spend - a.spend),
    });
  } catch (err) {
    console.error('Audience breakdown error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function fetchBreakdown(accountId, accessToken, dateFrom, dateTo, breakdownType) {
  const fields = 'impressions,clicks,spend,reach,actions';
  const url = `${META_GRAPH_URL}/act_${accountId}/insights?` +
    `fields=${fields}` +
    `&breakdowns=${breakdownType}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}` +
    `&limit=500` +
    `&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Breakdown API failed: ${res.status}`);
  }
  const { data } = await res.json();
  return data || [];
}
