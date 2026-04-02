// =============================================================
// RULE EVALUATOR ENGINE — Server Only
// Evaluates automation rules against current metrics and executes actions
// =============================================================

import { getSupabaseServer } from '@/lib/supabase-server';
import { pauseCampaign, enableCampaign, updateBudget } from '@/lib/meta-api';
import { subDays, format } from 'date-fns';

/**
 * Main entry: evaluate all active rules
 */
export async function evaluateAllRules() {
  const supabase = getSupabaseServer();

  // Check global kill switch
  const { data: setting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'automation_enabled')
    .single();

  if (!setting?.value?.enabled) {
    console.log('[Evaluator] Automation is globally disabled.');
    return { skipped: true, reason: 'automation_disabled' };
  }

  // Load active rules
  const { data: rules, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('is_active', true);

  if (error) throw error;
  if (!rules?.length) return { evaluated: 0, triggered: 0 };

  const results = [];

  for (const rule of rules) {
    try {
      const result = await evaluateRule(supabase, rule);
      results.push(result);
    } catch (err) {
      console.error(`[Evaluator] Rule "${rule.name}" error:`, err.message);
      results.push({ rule: rule.name, error: err.message });
    }
  }

  return {
    evaluated: rules.length,
    triggered: results.filter(r => r.triggered).length,
    results,
  };
}

/**
 * Evaluate a single rule against all matching entities
 */
async function evaluateRule(supabase, rule) {
  // Get target entities based on scope
  const entities = await getTargetEntities(supabase, rule);
  const triggered = [];

  for (const entity of entities) {
    // Check cooldown
    const canTrigger = await checkCanTrigger(supabase, rule, entity.id);
    if (!canTrigger.allowed) {
      await logAction(supabase, rule, entity, rule.action_type, null, {}, `skipped_${canTrigger.reason}`);
      continue;
    }

    // Get metrics for the entity
    const metrics = await getEntityMetrics(supabase, rule, entity);

    // Evaluate all conditions (AND logic)
    const allConditionsMet = rule.conditions.every(cond =>
      evaluateCondition(cond, metrics)
    );

    if (!allConditionsMet) continue;

    // Conditions met — execute action
    const conditionSnapshot = buildConditionSnapshot(rule.conditions, metrics);

    if (rule.dry_run) {
      await logAction(supabase, rule, entity, rule.action_type, rule.action_params, conditionSnapshot, 'dry_run');
      await createNotification(supabase, rule, entity, '🧪 Dry Run');
      triggered.push({ entity: entity.name, status: 'dry_run' });
      continue;
    }

    if (rule.requires_approval) {
      await logAction(supabase, rule, entity, rule.action_type, rule.action_params, conditionSnapshot, 'pending_approval');
      await createNotification(supabase, rule, entity, '⏳ Pending Approval');
      triggered.push({ entity: entity.name, status: 'pending_approval' });
      continue;
    }

    // Execute the action
    try {
      const previousValue = await capturePreviousValue(supabase, entity, rule.action_type);
      const apiResponse = await executeAction(supabase, rule, entity);

      await logAction(supabase, rule, entity, rule.action_type, rule.action_params, conditionSnapshot, 'executed', null, apiResponse, previousValue);
      await createNotification(supabase, rule, entity, '✅ Executed');

      // Update rule metadata
      await supabase.from('automation_rules').update({
        last_triggered_at: new Date().toISOString(),
        trigger_count: (rule.trigger_count || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', rule.id);

      triggered.push({ entity: entity.name, status: 'executed' });
    } catch (err) {
      await logAction(supabase, rule, entity, rule.action_type, rule.action_params, conditionSnapshot, 'failed', err.message);
      await createNotification(supabase, rule, entity, '❌ Failed', 'critical');
      triggered.push({ entity: entity.name, status: 'failed', error: err.message });
    }
  }

  return { rule: rule.name, entities: entities.length, triggered };
}

/**
 * Get entities that this rule targets
 */
async function getTargetEntities(supabase, rule) {
  const table = rule.scope === 'campaign' ? 'campaigns'
    : rule.scope === 'ad_set' ? 'ad_sets' : 'ads';

  let query = supabase.from(table).select('id, external_id, name, status, daily_budget, meta_account_id');

  // If specific targets are set, filter
  if (rule.target_ids?.length) {
    query = query.in('id', rule.target_ids);
  }

  // If specific accounts are targeted
  if (rule.target_account_ids?.length && rule.scope === 'campaign') {
    query = query.in('meta_account_id', rule.target_account_ids);
  }

  const { data } = await query;
  return data || [];
}

/**
 * Check if a rule can trigger for a specific entity (cooldown + daily limit)
 */
async function checkCanTrigger(supabase, rule, entityId) {
  // Check cooldown
  const { data: lastLog } = await supabase
    .from('automation_logs')
    .select('created_at')
    .eq('rule_id', rule.id)
    .eq('entity_id', entityId)
    .in('status', ['executed', 'dry_run', 'pending_approval'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lastLog) {
    const minutesSince = (Date.now() - new Date(lastLog.created_at).getTime()) / 60000;
    if (minutesSince < rule.cooldown_minutes) {
      return { allowed: false, reason: 'cooldown' };
    }
  }

  // Check daily trigger limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('automation_logs')
    .select('*', { count: 'exact', head: true })
    .eq('rule_id', rule.id)
    .eq('entity_id', entityId)
    .eq('status', 'executed')
    .gte('created_at', todayStart.toISOString());

  if ((count || 0) >= rule.max_triggers_per_day) {
    return { allowed: false, reason: 'max_triggers' };
  }

  return { allowed: true };
}

/**
 * Get aggregated metrics for an entity over the rule's condition periods
 */
async function getEntityMetrics(supabase, rule, entity) {
  const periods = [...new Set(rule.conditions.map(c => c.period))];
  const metrics = {};

  for (const period of periods) {
    const { dateFrom, dateTo } = getPeriodDates(period);

    const entityColumn = rule.scope === 'campaign' ? 'campaign_id'
      : rule.scope === 'ad_set' ? 'ad_set_id' : 'ad_id';

    const { data } = await supabase
      .from('metrics')
      .select('spend, impressions, clicks, conversions, conversion_value, reach')
      .eq('entity_type', rule.scope)
      .eq(entityColumn, entity.id)
      .gte('date', dateFrom)
      .lte('date', dateTo);

    const agg = (data || []).reduce((acc, row) => ({
      spend: acc.spend + parseFloat(row.spend || 0),
      impressions: acc.impressions + parseInt(row.impressions || 0),
      clicks: acc.clicks + parseInt(row.clicks || 0),
      conversions: acc.conversions + parseFloat(row.conversions || 0),
      conversion_value: acc.conversion_value + parseFloat(row.conversion_value || 0),
      reach: acc.reach + parseInt(row.reach || 0),
    }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, reach: 0 });

    // Computed metrics
    agg.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
    agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    agg.roas = agg.spend > 0 ? agg.conversion_value / agg.spend : 0;

    metrics[period] = agg;
  }

  return metrics;
}

/**
 * Evaluate a single condition against metrics
 */
function evaluateCondition(condition, metricsMap) {
  const periodMetrics = metricsMap[condition.period];
  if (!periodMetrics) return false;

  const actual = periodMetrics[condition.metric];
  if (actual == null) return false;

  const expected = parseFloat(condition.value);

  switch (condition.operator) {
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    default: return false;
  }
}

/**
 * Execute the automation action via Meta API
 */
async function executeAction(supabase, rule, entity) {
  // Get the access token for this entity's account
  let accountId;
  if (rule.scope === 'campaign') {
    accountId = entity.meta_account_id;
  } else {
    // For ad_sets/ads, look up the campaign's account
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('meta_account_id')
      .eq('id', entity.campaign_id || entity.id)
      .single();
    accountId = campaign?.meta_account_id;
  }

  const { data: account } = await supabase
    .from('meta_accounts')
    .select('access_token')
    .eq('id', accountId)
    .single();

  if (!account?.access_token) throw new Error('No access token found for account');

  const token = account.access_token;
  const externalId = entity.external_id;

  switch (rule.action_type) {
    case 'pause_campaign':
      return await pauseCampaign(externalId, token);

    case 'enable_campaign':
      return await enableCampaign(externalId, token);

    case 'increase_budget': {
      const currentBudget = parseFloat(entity.daily_budget || 0);
      const pct = rule.action_params?.percentage || 20;
      const maxBudget = rule.action_params?.max_budget || Infinity;
      const newBudget = Math.min(currentBudget * (1 + pct / 100), maxBudget);
      return await updateBudget(externalId, newBudget, token);
    }

    case 'decrease_budget': {
      const currentBudget2 = parseFloat(entity.daily_budget || 0);
      const pct2 = rule.action_params?.percentage || 20;
      const minBudget = rule.action_params?.min_budget || 1;
      const newBudget2 = Math.max(currentBudget2 * (1 - pct2 / 100), minBudget);
      return await updateBudget(externalId, newBudget2, token);
    }

    case 'set_budget': {
      const amount = rule.action_params?.amount;
      if (!amount) throw new Error('No budget amount specified');
      return await updateBudget(externalId, amount, token);
    }

    case 'send_alert':
      // Alert-only — no API call, just notification (already handled by caller)
      return { success: true, type: 'alert_only' };

    default:
      throw new Error(`Unknown action type: ${rule.action_type}`);
  }
}

/**
 * Capture previous value for undo support
 */
async function capturePreviousValue(supabase, entity, actionType) {
  if (['pause_campaign', 'enable_campaign'].includes(actionType)) {
    return { status: entity.status };
  }
  if (['increase_budget', 'decrease_budget', 'set_budget'].includes(actionType)) {
    return { daily_budget: entity.daily_budget, status: entity.status };
  }
  return null;
}

/**
 * Log an automation action
 */
async function logAction(supabase, rule, entity, actionType, actionParams, conditionSnapshot, status, errorMessage = null, apiResponse = null, previousValue = null) {
  await supabase.from('automation_logs').insert({
    rule_id: rule.id,
    rule_name: rule.name,
    entity_type: rule.scope,
    entity_id: entity.id,
    entity_external_id: entity.external_id,
    entity_name: entity.name,
    action_type: actionType,
    action_params: actionParams,
    condition_snapshot: conditionSnapshot || {},
    status,
    error_message: errorMessage,
    api_response: apiResponse,
    previous_value: previousValue,
  });
}

/**
 * Create an in-app notification
 */
async function createNotification(supabase, rule, entity, statusEmoji, severity = 'info') {
  const actionLabels = {
    pause_campaign: 'Paused',
    enable_campaign: 'Enabled',
    increase_budget: 'Budget Increased',
    decrease_budget: 'Budget Decreased',
    set_budget: 'Budget Set',
    send_alert: 'Alert',
  };

  await supabase.from('notifications').insert({
    type: 'automation_fired',
    title: `${statusEmoji} ${rule.name}`,
    message: `${actionLabels[rule.action_type] || rule.action_type} — "${entity.name}"`,
    severity,
    metadata: { rule_id: rule.id, entity_id: entity.id },
  });
}

/**
 * Convert period string to date range
 */
function getPeriodDates(period) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  switch (period) {
    case 'today': return { dateFrom: today, dateTo: today };
    case 'yesterday': return { dateFrom: yesterday, dateTo: yesterday };
    case 'last_3_days': return { dateFrom: format(subDays(new Date(), 3), 'yyyy-MM-dd'), dateTo: today };
    case 'last_7_days': return { dateFrom: format(subDays(new Date(), 7), 'yyyy-MM-dd'), dateTo: today };
    case 'last_14_days': return { dateFrom: format(subDays(new Date(), 14), 'yyyy-MM-dd'), dateTo: today };
    case 'last_30_days': return { dateFrom: format(subDays(new Date(), 30), 'yyyy-MM-dd'), dateTo: today };
    default: return { dateFrom: today, dateTo: today };
  }
}

function buildConditionSnapshot(conditions, metricsMap) {
  const snapshot = {};
  for (const c of conditions) {
    const periodMetrics = metricsMap[c.period];
    if (periodMetrics) {
      snapshot[`${c.metric}_${c.period}`] = periodMetrics[c.metric];
    }
  }
  snapshot.evaluated_at = new Date().toISOString();
  return snapshot;
}
