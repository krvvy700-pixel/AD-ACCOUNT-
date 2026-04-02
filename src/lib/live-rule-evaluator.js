// =============================================================
// LIVE AD MONITOR — Fetches real-time data, evaluates rules, 
// auto-pauses AND auto-resumes ads based on thresholds.
//
// This runs every 60s via cron. It does NOT read from DB metrics.
// Instead, it fetches LIVE insights directly from Meta API for
// only the ads that have active rules — minimal API calls.
// =============================================================

import { getSupabaseServer } from '@/lib/supabase-server';
import { pauseAdSet, enableAdSet, pauseAd, enableAd } from '@/lib/meta-api';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// Conversion action types — same priority as meta-api.js
const CONVERSION_PRIORITY = [
  'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase',
  'lead', 'offsite_conversion.fb_pixel_lead',
  'complete_registration', 'offsite_conversion.fb_pixel_complete_registration',
  'add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart',
  'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout',
];

/**
 * Main entry: fetch live data + evaluate all active ad-level rules
 */
export async function evaluateLiveRules() {
  const supabase = getSupabaseServer();
  const startTime = Date.now();

  // Check global kill switch
  const { data: setting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'automation_enabled')
    .single();

  if (!setting?.value?.enabled) {
    return { skipped: true, reason: 'automation_disabled' };
  }

  // Load active rules that target ads
  const { data: rules, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('is_active', true)
    .in('scope', ['ad', 'ad_set']); // Only ad-level and ad-set-level rules

  if (error) throw error;
  if (!rules?.length) return { evaluated: 0, message: 'No active ad rules' };

  // Get all accounts with tokens
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('id, meta_account_id, access_token, name')
    .eq('is_active', true);

  if (!accounts?.length) return { evaluated: 0, message: 'No active accounts' };

  // Get currently auto-paused ads (so we know what to check for resume)
  const { data: pausedAds } = await supabase
    .from('automation_paused_ads')
    .select('*')
    .eq('is_paused', true);

  const pausedMap = {};
  for (const p of (pausedAds || [])) {
    pausedMap[p.ad_external_id] = p;
  }

  // Fetch LIVE insights for ALL ads across all accounts (1 call per account)
  const liveData = {}; // { adExternalId: { spend, results, cpr, status } }

  await Promise.all(accounts.map(async (account) => {
    try {
      const [insights, adStatuses] = await Promise.all([
        fetchLiveAdInsights(account.meta_account_id, account.access_token),
        fetchAdStatuses(account.meta_account_id, account.access_token),
      ]);

      // Merge insights + statuses
      for (const ad of insights) {
        liveData[ad.adId] = {
          ...ad,
          status: adStatuses[ad.adId] || 'UNKNOWN',
          accountId: account.meta_account_id,
          accessToken: account.access_token,
        };
      }

      // Also add ads that have no insights (0 spend) but exist
      for (const [adId, status] of Object.entries(adStatuses)) {
        if (!liveData[adId]) {
          liveData[adId] = {
            adId,
            adName: adId, // name unknown for 0-spend ads
            spend: 0, results: 0, cpr: 0, impressions: 0,
            status,
            accountId: account.meta_account_id,
            accessToken: account.access_token,
          };
        }
      }
    } catch (err) {
      console.error(`[LiveMonitor] Failed to fetch for ${account.name}:`, err.message);
    }
  }));

  // Evaluate each rule against live data
  const results = [];

  for (const rule of rules) {
    try {
      const ruleResults = await evaluateRuleAgainstLiveData(supabase, rule, liveData, pausedMap);
      results.push({ rule: rule.name, ...ruleResults });
    } catch (err) {
      console.error(`[LiveMonitor] Rule "${rule.name}" error:`, err.message);
      results.push({ rule: rule.name, error: err.message });
    }
  }

  const elapsed = Date.now() - startTime;
  const totalPaused = results.reduce((s, r) => s + (r.paused || 0), 0);
  const totalResumed = results.reduce((s, r) => s + (r.resumed || 0), 0);

  console.log(`[LiveMonitor] Done in ${elapsed}ms — ${totalPaused} paused, ${totalResumed} resumed`);

  return {
    evaluated: Object.keys(liveData).length,
    rules: rules.length,
    paused: totalPaused,
    resumed: totalResumed,
    elapsed_ms: elapsed,
    results,
  };
}

/**
 * Evaluate a single rule against all live ad data
 */
async function evaluateRuleAgainstLiveData(supabase, rule, liveData, pausedMap) {
  let paused = 0;
  let resumed = 0;

  // Determine which conditions matter
  const conditions = rule.conditions || [];

  for (const [adId, ad] of Object.entries(liveData)) {
    // If rule has specific targets, skip non-matching ads
    if (rule.target_ids?.length) {
      // target_ids might be DB UUIDs — we need to match by external_id
      // For now, rules should store external IDs in target_external_ids
      if (rule.target_external_ids?.length && !rule.target_external_ids.includes(adId)) {
        continue;
      }
    }

    // Check if ALL conditions are met
    const allMet = conditions.every(cond => {
      const value = getMetricValue(ad, cond.metric);
      return evaluateCondition(value, cond.operator, parseFloat(cond.value));
    });

    const isPausedByUs = !!pausedMap[adId];

    if (allMet && !isPausedByUs && ad.status === 'ACTIVE') {
      // CONDITIONS MET + ad is active → PAUSE IT
      try {
        await pauseAd(adId, ad.accessToken);

        // Record in tracking table
        await supabase.from('automation_paused_ads').insert({
          ad_external_id: adId,
          ad_name: ad.adName,
          rule_id: rule.id,
          rule_name: rule.name,
          reason: rule.action_type || 'threshold',
          metric_snapshot: {
            spend: ad.spend,
            results: ad.results,
            cpr: ad.cpr,
            impressions: ad.impressions,
          },
        });

        // Log + notify
        await logLiveAction(supabase, rule, adId, ad, 'paused');
        paused++;
        console.log(`[LiveMonitor] PAUSED ad "${ad.adName}" (CPR: ${ad.cpr}, Spend: $${ad.spend})`);
      } catch (err) {
        console.error(`[LiveMonitor] Failed to pause ${adId}:`, err.message);
      }

    } else if (!allMet && isPausedByUs) {
      // CONDITIONS NO LONGER MET + we paused it → RESUME IT (auto-resume!)
      // But ONLY for threshold rules, not kill_switch
      if (rule.action_type === 'kill_switch') continue; // Never auto-resume kill switch

      try {
        await enableAd(adId, ad.accessToken);

        // Update tracking
        await supabase.from('automation_paused_ads')
          .update({ is_paused: false, resumed_at: new Date().toISOString() })
          .eq('ad_external_id', adId)
          .eq('is_paused', true);

        await logLiveAction(supabase, rule, adId, ad, 'resumed');
        resumed++;
        console.log(`[LiveMonitor] RESUMED ad "${ad.adName}" (CPR: ${ad.cpr}, Spend: $${ad.spend})`);
      } catch (err) {
        console.error(`[LiveMonitor] Failed to resume ${adId}:`, err.message);
      }
    }
  }

  return { paused, resumed };
}

/**
 * Get a metric value from live ad data
 */
function getMetricValue(ad, metric) {
  switch (metric) {
    case 'spend': return ad.spend;
    case 'cpr': case 'cost_per_result': return ad.cpr;
    case 'results': case 'conversions': return ad.results;
    case 'impressions': return ad.impressions;
    case 'cpc': return ad.impressions > 0 ? ad.spend / ad.clicks : 0;
    case 'ctr': return ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
    case 'cpm': return ad.impressions > 0 ? (ad.spend / ad.impressions) * 1000 : 0;
    default: return 0;
  }
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(actual, operator, expected) {
  switch (operator) {
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '=': case '==': return actual === expected;
    case '!=': return actual !== expected;
    default: return false;
  }
}

/**
 * Log a live monitoring action
 */
async function logLiveAction(supabase, rule, adId, ad, action) {
  await supabase.from('automation_logs').insert({
    rule_id: rule.id,
    rule_name: rule.name,
    entity_type: 'ad',
    entity_external_id: adId,
    entity_name: ad.adName,
    action_type: action === 'paused' ? 'pause_ad' : 'enable_ad',
    action_params: {},
    condition_snapshot: {
      spend: ad.spend,
      results: ad.results,
      cpr: ad.cpr,
      impressions: ad.impressions,
      evaluated_at: new Date().toISOString(),
    },
    status: 'executed',
  });

  await supabase.from('notifications').insert({
    type: 'automation_fired',
    title: action === 'paused'
      ? `⏸️ Auto-Paused: ${ad.adName}`
      : `▶️ Auto-Resumed: ${ad.adName}`,
    message: `Rule "${rule.name}" — CPR: $${ad.cpr?.toFixed(2)}, Spend: $${ad.spend?.toFixed(2)}, Results: ${ad.results}`,
    severity: action === 'paused' ? 'warning' : 'success',
    metadata: { rule_id: rule.id, ad_id: adId },
  });
}

// =============================================================
// LIVE DATA FETCHERS — 1 API call each per account
// =============================================================

/**
 * Fetch today's ad-level insights (spend, results, CPR) — 1 API call
 */
async function fetchLiveAdInsights(accountId, accessToken) {
  const today = new Date().toISOString().split('T')[0];

  const fields = 'ad_id,ad_name,spend,impressions,clicks,actions';
  const timeRange = JSON.stringify({ since: today, until: today });

  const res = await fetch(
    `${META_GRAPH_URL}/act_${accountId}/insights?` +
    `fields=${fields}` +
    `&level=ad` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&limit=500` +
    `&access_token=${accessToken}`
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Insights failed: ${res.status}`);
  }

  const { data } = await res.json();
  if (!data?.length) return [];

  return data.map(row => {
    const spend = parseFloat(row.spend || '0');
    const results = extractConversions(row.actions);
    return {
      adId: row.ad_id,
      adName: row.ad_name,
      spend,
      results,
      cpr: results > 0 ? +(spend / results).toFixed(2) : (spend > 0 ? Infinity : 0),
      impressions: parseInt(row.impressions || '0'),
      clicks: parseInt(row.clicks || '0'),
    };
  });
}

/**
 * Fetch all ad statuses — 1 API call
 */
async function fetchAdStatuses(accountId, accessToken) {
  const res = await fetch(
    `${META_GRAPH_URL}/act_${accountId}/ads?fields=id,status&limit=500&access_token=${accessToken}`
  );
  if (!res.ok) return {};
  const { data } = await res.json();
  const map = {};
  for (const ad of (data || [])) {
    map[ad.id] = ad.status;
  }
  return map;
}

/**
 * Extract conversions from Meta actions array (same logic as meta-api.js)
 */
function extractConversions(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  for (const type of CONVERSION_PRIORITY) {
    const action = actions.find(a => a.action_type === type);
    if (action) return parseFloat(action.value || '0');
  }
  return 0;
}
