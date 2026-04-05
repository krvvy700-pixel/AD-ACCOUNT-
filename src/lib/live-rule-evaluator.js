// =============================================================
// LIVE AD MONITOR v2 — ZERO COOLDOWN RULES ENGINE
//
// Runs every 60s via cron. Fetches LIVE data from Meta API.
// Evaluates rules. Pauses ads that breach thresholds.
// Resumes ads THE VERY NEXT CHECK (60s) when metrics recover.
//
// ZERO COOLDOWN POLICY:
//  ✓ NO cooldown — if metrics breach, ad is PAUSED instantly
//  ✓ NO cooldown — if metrics recover on next check, ad is RESUMED instantly
//  ✓ Every 60s check acts independently — no waiting period
//  ✓ Min spend guard — won't fire on low spend
//  ✓ NaN/Infinity guards — CPC=0 when no clicks, not Infinity
//  ✓ Retry with backoff — 3 attempts on Meta API failures
//  ✓ Full pagination — handles >500 ads
//  ✓ Kill switch never resumes — permanent pause
//  ✓ Duplicate-safe — upserts for paused_ads tracking
//  ✓ Ad-set + Ad level support
// =============================================================

import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// Conversion action types — same priority as meta-api.js
const CONVERSION_PRIORITY = [
  'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase',
  'lead', 'offsite_conversion.fb_pixel_lead',
  'complete_registration', 'offsite_conversion.fb_pixel_complete_registration',
  'add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart',
  'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout',
  'onsite_conversion.messaging_conversation_started_7d',
  'landing_page_view', 'link_click',
];

// Default minimum spend before rules can fire ($)
const DEFAULT_MIN_SPEND = 1.00;

/**
 * Main entry: fetch live data + evaluate ALL active ad/ad-set level rules
 */
export async function evaluateLiveRules() {
  const supabase = getSupabaseServer();
  const startTime = Date.now();

  // ── Check global kill switch ──────────────────────────────
  const { data: setting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'automation_enabled')
    .single();

  if (!setting?.value?.enabled) {
    return { skipped: true, reason: 'automation_disabled' };
  }

  // ── Load active rules (ad + ad_set scope only) ────────────
  const { data: rules, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('is_active', true)
    .in('scope', ['ad', 'ad_set']);

  if (error) throw error;
  if (!rules?.length) return { evaluated: 0, message: 'No active ad/ad-set rules' };

  // ── Get all accounts with tokens ──────────────────────────
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('id, meta_account_id, access_token, name')
    .eq('is_active', true);

  if (!accounts?.length) return { evaluated: 0, message: 'No active accounts' };

  // ── Load currently auto-paused entities ───────────────────
  const { data: pausedEntities } = await supabase
    .from('automation_paused_ads')
    .select('*')
    .eq('is_paused', true);

  const pausedMap = {};
  for (const p of (pausedEntities || [])) {
    pausedMap[p.ad_external_id] = p;
  }

  // ── Determine what data we need ───────────────────────────
  const needsAdData = rules.some(r => r.scope === 'ad');
  const needsAdSetData = rules.some(r => r.scope === 'ad_set');

  // ── Fetch LIVE data — parallel per account ────────────────
  const liveAdData = {};      // { externalId: { ...metrics, accessToken } }
  const liveAdSetData = {};   // { externalId: { ...metrics, accessToken } }

  await Promise.all(accounts.map(async (account) => {
    try {
      const fetches = [];

      if (needsAdData) {
        fetches.push(
          Promise.all([
            fetchAllLiveInsights(account.meta_account_id, account.access_token, 'ad'),
            fetchEntityStatuses(account.meta_account_id, account.access_token, 'ads'),
          ]).then(([insights, statuses]) => {
            mergeInsightsAndStatuses(insights, statuses, liveAdData, account);
          })
        );
      }

      if (needsAdSetData) {
        fetches.push(
          Promise.all([
            fetchAllLiveInsights(account.meta_account_id, account.access_token, 'adset'),
            fetchEntityStatuses(account.meta_account_id, account.access_token, 'adsets'),
          ]).then(([insights, statuses]) => {
            mergeInsightsAndStatuses(insights, statuses, liveAdSetData, account);
          })
        );
      }

      await Promise.all(fetches);
    } catch (err) {
      console.error(`[LiveMonitor] Failed to fetch for ${account.name}:`, err.message);
    }
  }));

  // ── Evaluate each rule ────────────────────────────────────
  const results = [];

  for (const rule of rules) {
    try {
      const dataMap = rule.scope === 'ad' ? liveAdData : liveAdSetData;
      const ruleResults = await evaluateRuleAgainstLiveData(supabase, rule, dataMap, pausedMap);
      results.push({ rule: rule.name, ruleId: rule.id, scope: rule.scope, ...ruleResults });
    } catch (err) {
      console.error(`[LiveMonitor] Rule "${rule.name}" error:`, err.message);
      results.push({ rule: rule.name, error: err.message });
    }
  }

  const elapsed = Date.now() - startTime;
  const totalPaused = results.reduce((s, r) => s + (r.paused || 0), 0);
  const totalResumed = results.reduce((s, r) => s + (r.resumed || 0), 0);
  const totalSkipped = results.reduce((s, r) => s + (r.skippedMinSpend || 0), 0);

  console.log(
    `[LiveMonitor] Done in ${elapsed}ms — ` +
    `${Object.keys(liveAdData).length} ads, ${Object.keys(liveAdSetData).length} ad-sets checked | ` +
    `${totalPaused} paused, ${totalResumed} resumed, ${totalSkipped} skipped`
  );

  // Build diagnostic data — top breaching ads
  const diagnostics = {};
  for (const r of results) {
    if (r._breaching) {
      diagnostics[r.rule] = {
        totalBreaching: r._breaching.length,
        breachingAds: r._breaching.slice(0, 20), // Top 20
        failedPauses: r._failedPauses || [],
        skippedNotActive: r._skippedNotActive || 0,
        skippedAlreadyPaused: r._skippedAlreadyPaused || 0,
      };
    }
  }

  return {
    evaluated: Object.keys(liveAdData).length + Object.keys(liveAdSetData).length,
    rules: rules.length,
    paused: totalPaused,
    resumed: totalResumed,
    skipped: totalSkipped,
    elapsed_ms: elapsed,
    diagnostics,
    results: results.map(r => ({
      rule: r.rule, ruleId: r.ruleId, scope: r.scope,
      paused: r.paused, resumed: r.resumed,
      checked: r.checked, skippedMinSpend: r.skippedMinSpend,
      error: r.error,
    })),
  };
}


// =============================================================
// RULE EVALUATION — The core logic (ZERO COOLDOWN)
// =============================================================

/**
 * Evaluate a single rule against all live entity data.
 * ZERO COOLDOWN: pause/resume happens instantly every check.
 * Handles: pause, resume, min spend, kill switch.
 */
async function evaluateRuleAgainstLiveData(supabase, rule, liveData, pausedMap) {
  let paused = 0;
  let resumed = 0;
  let skippedMinSpend = 0;
  let checked = 0;
  let skippedNotActive = 0;
  let skippedAlreadyPaused = 0;

  // Diagnostic tracking
  const breachingAds = [];
  const failedPauses = [];

  const conditions = rule.conditions || [];
  if (!conditions.length) return { paused, resumed, skippedMinSpend, checked };

  const minSpend = parseFloat(rule.min_spend_threshold) || DEFAULT_MIN_SPEND;
  const isKillSwitch = rule.action_type === 'kill_switch';

  for (const [entityId, entity] of Object.entries(liveData)) {
    // ── Target filtering ────────────────────────────────────
    if (rule.target_external_ids?.length && !rule.target_external_ids.includes(entityId)) {
      continue;
    }

    checked++;
    const isPausedByUs = !!pausedMap[entityId];

    // ── MIN SPEND GUARD ─────────────────────────────────────
    if (entity.spend < minSpend && !isPausedByUs) {
      skippedMinSpend++;
      continue;
    }

    // ── Evaluate ALL conditions (AND logic) ─────────────────
    const allConditionsMet = conditions.every(cond => {
      const value = getMetricValue(entity, cond.metric);
      return evaluateCondition(value, cond.operator, parseFloat(cond.value));
    });

    // ── CASE 1: Conditions met + entity is running → PAUSE IMMEDIATELY ──
    if (allConditionsMet && !isPausedByUs) {
      // Track ALL breaching ads for diagnostics
      breachingAds.push({
        id: entityId,
        name: entity.entityName,
        cpr: entity.cpr,
        spend: entity.spend,
        results: entity.results,
        status: entity.status,
      });

      if (entity.status !== 'ACTIVE') {
        skippedNotActive++;
        continue;
      }

      // ── EXECUTE PAUSE ───────────────────────────────────
      try {
        await retryWithBackoff(() => pauseEntity(entityId, entity.accessToken));

        // RELIABLE TRACKING: delete any old rows, then insert fresh
        // (avoids partial unique index issues with upsert)
        await supabase.from('automation_paused_ads')
          .delete()
          .eq('ad_external_id', entityId);

        await supabase.from('automation_paused_ads').insert({
          ad_external_id: entityId,
          ad_name: entity.entityName,
          rule_id: rule.id,
          rule_name: rule.name,
          reason: isKillSwitch ? 'kill_switch' : 'threshold',
          metric_snapshot: buildSnapshot(entity),
          paused_at: new Date().toISOString(),
          resumed_at: null,
          is_paused: true,
        });

        await logLiveAction(supabase, rule, entityId, entity, 'paused');
        paused++;

        console.log(
          `[LiveMonitor] ⏸️  PAUSED ${rule.scope} "${entity.entityName}" ` +
          `(CPR: $${entity.cpr?.toFixed(2)}, CPC: $${entity.cpc?.toFixed(2)}, Spend: $${entity.spend?.toFixed(2)})`
        );
      } catch (err) {
        console.error(`[LiveMonitor] Failed to pause ${entityId}:`, err.message);
        failedPauses.push({ id: entityId, name: entity.entityName, error: err.message });
        try {
          await logLiveAction(supabase, rule, entityId, entity, 'failed', err.message);
        } catch {}
      }

    // ── CASE 2: Conditions NO LONGER met + WE paused it → RESUME IMMEDIATELY ──
    } else if (!allConditionsMet && isPausedByUs) {
      if (isKillSwitch) continue;

      const pauseRecord = pausedMap[entityId];
      if (pauseRecord.rule_id !== rule.id) continue;

      try {
        await retryWithBackoff(() => enableEntity(entityId, entity.accessToken));

        await supabase.from('automation_paused_ads')
          .update({
            is_paused: false,
            resumed_at: new Date().toISOString(),
          })
          .eq('ad_external_id', entityId)
          .eq('is_paused', true);

        await logLiveAction(supabase, rule, entityId, entity, 'resumed');
        resumed++;

        console.log(
          `[LiveMonitor] ▶️  RESUMED ${rule.scope} "${entity.entityName}" ` +
          `(CPR: $${entity.cpr?.toFixed(2)}, CPC: $${entity.cpc?.toFixed(2)}, Spend: $${entity.spend?.toFixed(2)})`
        );
      } catch (err) {
        console.error(`[LiveMonitor] Failed to resume ${entityId}:`, err.message);
        try {
          await logLiveAction(supabase, rule, entityId, entity, 'failed', err.message);
        } catch {}
      }
    }
  }

  return {
    paused, resumed, skippedMinSpend, checked,
    skippedNotActive, skippedAlreadyPaused,
    _breaching: breachingAds,
    _failedPauses: failedPauses,
  };
}


// =============================================================
// COOLDOWN — REMOVED (Zero Cooldown Policy)
// =============================================================
// Cooldown logic has been completely removed.
// Every 60s check acts independently:
//   - Bad metrics? → PAUSE immediately
//   - Good metrics? → RESUME immediately
// No waiting, no delays, no cooldown period.


// =============================================================
// METRICS — Extract values from live data with NaN guards
// =============================================================

/**
 * Get a metric value from live entity data.
 * All computed metrics return 0 (not NaN/Infinity) when denominator is 0.
 */
function getMetricValue(entity, metric) {
  switch (metric) {
    case 'spend':
      return entity.spend || 0;
    case 'cpr': case 'cost_per_result':
      return entity.cpr || 0;
    case 'results': case 'conversions':
      return entity.results || 0;
    case 'impressions':
      return entity.impressions || 0;
    case 'clicks':
      return entity.clicks || 0;
    case 'cpc':
      return entity.cpc || 0;
    case 'ctr':
      return entity.ctr || 0;
    case 'cpm':
      return entity.cpm || 0;
    default:
      return 0;
  }
}

/**
 * Evaluate a single condition: actual [operator] expected
 */
function evaluateCondition(actual, operator, expected) {
  // Guard against NaN
  if (isNaN(actual) || isNaN(expected)) return false;

  switch (operator) {
    case '>':  return actual > expected;
    case '<':  return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '=':  case '==': return actual === expected;
    case '!=': return actual !== expected;
    default:   return false;
  }
}


// =============================================================
// META API — Pause/Enable with retry
// =============================================================

/**
 * Pause any entity (ad, ad set, campaign) via Meta API
 */
async function pauseEntity(entityId, accessToken) {
  const res = await fetch(`${META_GRAPH_URL}/${entityId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PAUSED', access_token: accessToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Pause failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Enable any entity (ad, ad set, campaign) via Meta API
 */
async function enableEntity(entityId, accessToken) {
  const res = await fetch(`${META_GRAPH_URL}/${entityId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ACTIVE', access_token: accessToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Enable failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Retry a function up to 3 times with exponential backoff (1s, 2s, 4s).
 * Critical for Meta API reliability — rate limits, network blips, etc.
 */
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.warn(`[LiveMonitor] Retry ${attempt}/${maxRetries} in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}


// =============================================================
// LOGGING & NOTIFICATIONS
// =============================================================

async function logLiveAction(supabase, rule, entityId, entity, action, errorMessage = null) {
  const actionType = action === 'paused' ? 'pause_ad'
    : action === 'resumed' ? 'enable_ad'
    : rule.action_type;

  const status = action === 'failed' ? 'failed' : 'executed';

  await supabase.from('automation_logs').insert({
    rule_id: rule.id,
    rule_name: rule.name,
    entity_type: rule.scope,
    entity_id: null,  // Live rules use external IDs, not DB UUIDs
    entity_external_id: entityId,
    entity_name: entity.entityName,
    action_type: actionType,
    action_params: {},
    condition_snapshot: buildSnapshot(entity),
    status,
    error_message: errorMessage,
  });

  if (action !== 'failed') {
    const title = action === 'paused'
      ? `⏸️ Auto-Paused: ${entity.entityName}`
      : `▶️ Auto-Resumed: ${entity.entityName}`;
    const severity = action === 'paused' ? 'warning' : 'success';

    await supabase.from('notifications').insert({
      type: 'automation_fired',
      title,
      message: buildNotificationMessage(rule, entity),
      severity,
      metadata: { rule_id: rule.id, entity_id: entityId, action },
    });
  }
}

function buildSnapshot(entity) {
  return {
    spend: entity.spend,
    results: entity.results,
    cpr: entity.cpr,
    cpc: entity.cpc,
    ctr: entity.ctr,
    cpm: entity.cpm,
    impressions: entity.impressions,
    clicks: entity.clicks,
    evaluated_at: new Date().toISOString(),
  };
}

function buildNotificationMessage(rule, entity) {
  const parts = [];
  parts.push(`Rule "${rule.name}"`);
  if (entity.cpr > 0) parts.push(`CPR: $${entity.cpr.toFixed(2)}`);
  if (entity.cpc > 0) parts.push(`CPC: $${entity.cpc.toFixed(2)}`);
  parts.push(`Spend: $${entity.spend.toFixed(2)}`);
  if (entity.results > 0) parts.push(`Results: ${entity.results}`);
  return parts.join(' — ');
}


// =============================================================
// LIVE DATA FETCHERS — Full pagination, all metrics computed
// =============================================================

/**
 * Merge insights + statuses into a single data map.
 * Computes CPC, CTR, CPM, CPR with NaN/Infinity guards.
 */
function mergeInsightsAndStatuses(insights, statuses, dataMap, account) {
  for (const item of insights) {
    dataMap[item.entityId] = {
      ...item,
      status: statuses[item.entityId]?.status || 'UNKNOWN',
      accountId: account.meta_account_id,
      accessToken: account.access_token,
    };
  }

  // Also add entities with 0 spend (exist but no insights today)
  for (const [entityId, info] of Object.entries(statuses)) {
    if (!dataMap[entityId]) {
      dataMap[entityId] = {
        entityId,
        entityName: info.name || entityId, // Use actual name from status fetch
        spend: 0, results: 0, cpr: 0, impressions: 0, clicks: 0,
        cpc: 0, ctr: 0, cpm: 0,
        status: info.status || 'UNKNOWN',
        accountId: account.meta_account_id,
        accessToken: account.access_token,
      };
    }
  }
}

/**
 * Fetch ALL today's insights with FULL PAGINATION.
 * level = 'ad' or 'adset'
 * Returns array of { entityId, entityName, spend, results, cpr, cpc, ctr, cpm, impressions, clicks }
 */
async function fetchAllLiveInsights(accountId, accessToken, level = 'ad') {
  const today = new Date().toISOString().split('T')[0];
  const idField = level === 'ad' ? 'ad_id' : 'adset_id';
  const nameField = level === 'ad' ? 'ad_name' : 'adset_name';

  const fields = `${idField},${nameField},spend,impressions,clicks,actions`;
  const timeRange = JSON.stringify({ since: today, until: today });

  let url = `${META_GRAPH_URL}/act_${accountId}/insights?` +
    `fields=${fields}` +
    `&level=${level}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&limit=500` +
    `&access_token=${accessToken}`;

  const allRows = [];

  // ── Full pagination — get EVERY entity, not just first 500 ──
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Insights failed: ${res.status}`);
    }
    const json = await res.json();
    if (json.data?.length) allRows.push(...json.data);
    url = json.paging?.next || null;
  }

  return allRows.map(row => {
    const spend = parseFloat(row.spend || '0');
    const impressions = parseInt(row.impressions || '0');
    const clicks = parseInt(row.clicks || '0');
    const results = extractConversions(row.actions);

    // Computed metrics — ALL guarded against NaN/Infinity
    const cpc = clicks > 0 ? +(spend / clicks).toFixed(4) : 0;
    const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(4) : 0;
    const cpm = impressions > 0 ? +((spend / impressions) * 1000).toFixed(4) : 0;
    const cpr = results > 0 ? +(spend / results).toFixed(2) : (spend > 0 ? 999999 : 0);
    // ↑ CPR: If spending but 0 results, set to 999999 (effectively infinity, triggers any "cpr > X" rule)
    //   If 0 spend, set to 0 (won't trigger any rule)

    return {
      entityId: row[idField],
      entityName: row[nameField],
      spend, impressions, clicks, results,
      cpc, ctr, cpm, cpr,
    };
  });
}

/**
 * Fetch all entity statuses — FULL PAGINATION.
 * type = 'ads' or 'adsets'
 * Returns { entityId: 'ACTIVE' | 'PAUSED' | ... }
 */
async function fetchEntityStatuses(accountId, accessToken, type = 'ads') {
  // Only fetch ACTIVE + PAUSED entities — skip ARCHIVED/DELETED for efficiency
  const statusFilter = encodeURIComponent(
    JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }])
  );
  let url = `${META_GRAPH_URL}/act_${accountId}/${type}?fields=id,name,status&filtering=${statusFilter}&limit=500&access_token=${accessToken}`;
  const map = {};

  while (url) {
    const res = await fetch(url);
    if (!res.ok) return map; // Don't crash on status fetch failure
    const json = await res.json();
    for (const entity of (json.data || [])) {
      map[entity.id] = { status: entity.status, name: entity.name };
    }
    url = json.paging?.next || null;
  }

  return map;
}

/**
 * Extract conversions from Meta actions array using priority order
 */
function extractConversions(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  for (const type of CONVERSION_PRIORITY) {
    const action = actions.find(a => a.action_type === type);
    if (action) return parseFloat(action.value || '0');
  }
  return 0;
}
