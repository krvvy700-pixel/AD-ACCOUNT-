'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useCurrency } from '@/context/CurrencyContext';
import {
  Zap, Plus, Play, Pause, Edit2, Trash2, Clock, Shield, RotateCcw, X,
  AlertTriangle, Activity, Search, ChevronDown, Image, CheckSquare,
  Loader2, Eye,
} from 'lucide-react';

export default function AutomationPage() {
  return (
    <Suspense fallback={<AppShell title="Automation"><div className="text-center py-12 text-muted-foreground">Loading...</div></AppShell>}>
      <AutomationContent />
    </Suspense>
  );
}

function AutomationContent() {
  const { formatMoney } = useCurrency();
  const searchParams = useSearchParams();
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [prefilledCampaign, setPrefilledCampaign] = useState(null);
  const [lastEvaluation, setLastEvaluation] = useState(null);

  // Paused ads state
  const [pausedAds, setPausedAds] = useState([]);
  const [pausedLoading, setPausedLoading] = useState(false);
  const [resumingId, setResumingId] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, logsRes, pausedRes] = await Promise.all([
        fetch('/api/automation/rules'),
        fetch('/api/automation/logs?limit=30'),
        fetch('/api/automation/paused'),
      ]);
      const rulesData = await rulesRes.json();
      const logsData = await logsRes.json();
      const pausedData = await pausedRes.json();
      if (rulesData.rules) setRules(rulesData.rules);
      if (logsData.logs) setLogs(logsData.logs);
      if (pausedData.paused) setPausedAds(pausedData.paused);

      if (logsData.logs?.length > 0) {
        setLastEvaluation(logsData.logs[0].created_at);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto-open modal if campaign param is present
  useEffect(() => {
    const campaignId = searchParams.get('campaign');
    const campaignName = searchParams.get('name');
    if (campaignId && campaignName) {
      setPrefilledCampaign({ id: campaignId, name: campaignName });
      setEditingRule(null);
      setModalOpen(true);
      window.history.replaceState({}, '', '/automation');
    }
  }, [searchParams]);

  const toggleRule = async (rule) => {
    await fetch('/api/automation/rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
    });
    fetchData();
  };

  const deleteRule = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`/api/automation/rules?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleUndo = async (logId) => {
    await fetch('/api/automation/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId }),
    });
    fetchData();
  };

  // Manual resume a paused ad
  const handleManualResume = async (adExternalId) => {
    if (!confirm('Resume this ad? It will be set to ACTIVE on Meta.')) return;
    setResumingId(adExternalId);
    try {
      const res = await fetch('/api/automation/paused', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adExternalId }),
      });
      if (res.ok) {
        setPausedAds(prev => prev.filter(p => p.ad_external_id !== adExternalId));
      } else {
        const err = await res.json();
        alert(err.error || 'Resume failed');
      }
    } catch {
      alert('Resume failed');
    }
    setResumingId(null);
  };

  const fmtAction = (type, params) => ({
    pause_campaign: '⏸ Pause Campaign',
    enable_campaign: '▶ Enable Campaign',
    auto_pause_resume: '🔄 Auto Pause & Resume',
    kill_switch: '💀 Kill (no resume)',
    pause_ad: '⏸ Pause Ad',
    enable_ad: '▶ Enable Ad',
    increase_budget: `📈 +${params?.percentage || 0}% Budget`,
    decrease_budget: `📉 -${params?.percentage || 0}% Budget`,
    set_budget: `💰 Set Budget ${formatMoney(params?.amount || 0)}`,
    send_alert: '🔔 Alert Only',
  })[type] || type;

  const fmtConditions = (conditions) => {
    if (!conditions || !Array.isArray(conditions)) return 'No conditions';
    return conditions.map(c =>
      `${c.metric} ${c.operator} ${c.value} (${c.period?.replace(/_/g, ' ')})`
    ).join(' AND ');
  };

  const liveRulesCount = rules.filter(r => r.scope === 'ad' || r.scope === 'ad_set').length;
  const activeRulesCount = rules.filter(r => r.is_active).length;

  return (
    <AppShell title="Automation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Zap size={18} className="text-warning" /> Automation Rules
          </h2>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
            <span>{activeRulesCount} active</span>
            {liveRulesCount > 0 && (
              <span className="flex items-center gap-1 text-primary">
                <Activity size={10} className="animate-pulse" />
                {liveRulesCount} live (every 60s)
              </span>
            )}
            {pausedAds.length > 0 && (
              <span className="flex items-center gap-1 text-warning">
                <Pause size={10} />
                {pausedAds.length} ads auto-paused
              </span>
            )}
            {lastEvaluation && (
              <span>Last check: {timeAgo(lastEvaluation)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutomationEnabled(!automationEnabled)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${automationEnabled ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-success/10 text-success border-success/20'}`}
          >
            <Shield size={14} /> {automationEnabled ? 'Kill All' : 'Enable All'}
          </button>
          <button onClick={() => { setEditingRule(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> New Rule
          </button>
        </div>
      </div>

      {/* Auto-Paused Ads Section */}
      {pausedAds.length > 0 && (
        <div className="bg-card rounded-xl border border-warning/30 shadow-card mb-6 overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-warning/5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Pause size={14} className="text-warning" /> Auto-Paused Ads
              <span className="text-xs font-normal text-muted-foreground">({pausedAds.length})</span>
            </h3>
            <span className="text-[10px] text-muted-foreground">Auto-resume checks every 60s</span>
          </div>
          <div className="divide-y divide-border">
            {pausedAds.map(p => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{p.ad_name || p.ad_external_id}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">
                      {p.reason === 'kill_switch' ? '💀 Kill Switch' : '⏸ Threshold'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                    <span>Rule: {p.rule_name}</span>
                    <span>Paused: {timeAgo(p.paused_at)}</span>
                    {p.metric_snapshot?.cpr > 0 && <span>CPR: ${parseFloat(p.metric_snapshot.cpr).toFixed(2)}</span>}
                    {p.metric_snapshot?.cpc > 0 && <span>CPC: ${parseFloat(p.metric_snapshot.cpc).toFixed(2)}</span>}
                    {p.metric_snapshot?.spend > 0 && <span>Spend: ${parseFloat(p.metric_snapshot.spend).toFixed(2)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => handleManualResume(p.ad_external_id)}
                  disabled={resumingId === p.ad_external_id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-success/30 bg-success/10 text-success hover:bg-success/20 disabled:opacity-50 transition-colors ml-3"
                >
                  {resumingId === p.ad_external_id ? (
                    <><Loader2 size={12} className="animate-spin" /> Resuming...</>
                  ) : (
                    <><Play size={12} /> Resume</>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules */}
      {loading ? (
        Array(3).fill(0).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-5 mb-3 space-y-3">
            <div className="h-5 w-48 bg-muted rounded animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
            <div className="h-4 w-64 bg-muted rounded animate-pulse" />
          </div>
        ))
      ) : rules.length === 0 ? (
        <div className="text-center py-16">
          <Zap size={40} className="mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold text-foreground mb-2">No automation rules yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create rules to automatically manage your ads across all accounts</p>
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg"><Plus size={14} className="inline mr-1" />Create First Rule</button>
        </div>
      ) : rules.map(rule => {
        const isLive = rule.scope === 'ad' || rule.scope === 'ad_set';
        const isKill = rule.action_type === 'kill_switch';
        const targetCount = rule.target_external_ids?.length || 0;

        return (
          <div key={rule.id} className={`bg-card rounded-xl border shadow-card p-5 mb-3 card-hover ${isLive ? 'border-primary/30' : 'border-border'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${rule.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${rule.is_active ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
                  {rule.is_active ? 'Active' : 'Paused'}
                </span>
                <span className="font-semibold text-foreground">{rule.name}</span>
                {isLive && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                    <Activity size={10} /> LIVE
                  </span>
                )}
                {isKill && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-destructive/10 text-destructive">
                    <AlertTriangle size={10} /> KILL
                  </span>
                )}
                {targetCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-info/10 text-info border border-info/20">
                    {targetCount} ads targeted
                  </span>
                )}
                {rule.dry_run && <span className="text-xs text-warning font-medium">🧪 DRY RUN</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleRule(rule)} className="p-2 rounded hover:bg-muted transition-colors" title={rule.is_active ? 'Pause' : 'Enable'}>
                  {rule.is_active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button onClick={() => { setEditingRule(rule); setModalOpen(true); }} className="p-2 rounded hover:bg-muted transition-colors"><Edit2 size={14} /></button>
                <button onClick={() => deleteRule(rule.id)} className="p-2 rounded hover:bg-muted transition-colors text-destructive"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="bg-muted rounded-lg px-3 py-2 text-xs font-mono text-secondary-foreground mb-2">
              IF {fmtConditions(rule.conditions)} → {fmtAction(rule.action_type, rule.action_params)}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span><Clock size={10} className="inline mr-1" />Cooldown: None (instant)</span>
              {isLive && <span>Min spend: ${parseFloat(rule.min_spend_threshold || 1).toFixed(2)}</span>}
              <span>Last: {rule.last_triggered_at ? timeAgo(rule.last_triggered_at) : 'Never'}</span>
              <span>Triggers: {rule.trigger_count || 0}/{rule.max_triggers_per_day}</span>
              {isLive && !isKill && <span className="text-success">🔄 Auto pause & resume every 60s</span>}
              {isLive && isKill && <span className="text-destructive">💀 Pause only — no auto-resume</span>}
            </div>
          </div>
        );
      })}

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            Activity Log
            <span className="text-xs font-normal text-muted-foreground">(auto-refreshes every 30s)</span>
          </h3>
          <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-elevated">
                    {['Time', 'Rule', 'Entity', 'Action', 'Status', 'Metrics', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border-soft hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">{timeAgo(log.created_at)}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{log.rule_name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{log.entity_name || log.entity_external_id}</td>
                      <td className="px-4 py-3">{fmtAction(log.action_type, log.action_params)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.status === 'executed' ? 'bg-success/10 text-success'
                            : log.status === 'failed' ? 'bg-destructive/10 text-destructive'
                            : log.status === 'dry_run' ? 'bg-info/10 text-info'
                            : 'bg-muted text-muted-foreground'
                        }`}>{log.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {log.condition_snapshot && (
                          <span>
                            {log.condition_snapshot.cpr > 0 && `CPR:$${parseFloat(log.condition_snapshot.cpr).toFixed(2)} `}
                            {log.condition_snapshot.cpc > 0 && `CPC:$${parseFloat(log.condition_snapshot.cpc).toFixed(2)} `}
                            {log.condition_snapshot.spend > 0 && `Spend:$${parseFloat(log.condition_snapshot.spend).toFixed(2)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.status === 'executed' && !log.is_reversed && (
                          <button onClick={() => handleUndo(log.id)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                            <RotateCcw size={10} /> Undo
                          </button>
                        )}
                        {log.is_reversed && <span className="text-xs text-muted-foreground">↩ Reversed</span>}
                        {log.status === 'failed' && log.error_message && (
                          <span className="text-xs text-destructive" title={log.error_message}>⚠ Error</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && <RuleModal rule={editingRule} prefilledCampaign={prefilledCampaign} onClose={() => { setModalOpen(false); setEditingRule(null); setPrefilledCampaign(null); }} onSave={fetchData} formatMoney={formatMoney} />}
    </AppShell>
  );
}


// =============================================================
// RULE CREATION / EDIT MODAL — with multi-ad picker
// =============================================================

function RuleModal({ rule, prefilledCampaign, onClose, onSave, formatMoney }) {
  const defaultName = prefilledCampaign ? `Rule for ${prefilledCampaign.name}` : '';
  const [name, setName] = useState(rule?.name || defaultName);
  const [scope, setScope] = useState(rule?.scope || 'ad');
  const [actionType, setActionType] = useState(rule?.action_type || 'auto_pause_resume');
  const [conditions, setConditions] = useState(rule?.conditions || [{ metric: 'cpr', operator: '>', value: '', period: 'today' }]);
  // ZERO COOLDOWN: No cooldown setting needed — always instant
  const [maxTriggers, setMaxTriggers] = useState(rule?.max_triggers_per_day || 50);
  const [dryRun, setDryRun] = useState(rule?.dry_run || false);
  const [minSpend, setMinSpend] = useState(rule?.min_spend_threshold ?? 1);
  const [budgetPct, setBudgetPct] = useState(rule?.action_params?.percentage || 20);

  const isLiveScope = scope === 'ad' || scope === 'ad_set';
  const [budgetAmount, setBudgetAmount] = useState(rule?.action_params?.amount || '');
  const [saving, setSaving] = useState(false);

  // Multi-ad picker state
  const [allAds, setAllAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [selectedExternalIds, setSelectedExternalIds] = useState(new Set(rule?.target_external_ids || []));
  const [adPickerOpen, setAdPickerOpen] = useState(false);
  const [adSearch, setAdSearch] = useState('');

  // Fetch ads for picker on mount
  useEffect(() => {
    if (isLiveScope) {
      setAdsLoading(true);
      fetch('/api/automation/ads')
        .then(r => r.json())
        .then(data => setAllAds(data.ads || []))
        .catch(() => {})
        .finally(() => setAdsLoading(false));
    }
  }, [isLiveScope]);

  // Auto-switch action type when scope changes
  useEffect(() => {
    if (isLiveScope && !['auto_pause_resume', 'kill_switch'].includes(actionType)) {
      setActionType('auto_pause_resume');
    }
    if (!isLiveScope && ['auto_pause_resume', 'kill_switch'].includes(actionType)) {
      setActionType('pause_campaign');
    }
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCond = (i, field, val) => {
    const u = [...conditions];
    u[i] = { ...u[i], [field]: field === 'value' ? parseFloat(val) || '' : val };
    setConditions(u);
  };

  const toggleAdSelection = (externalId) => {
    setSelectedExternalIds(prev => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const selectAllAds = () => {
    const filtered = getFilteredAds();
    setSelectedExternalIds(prev => {
      const next = new Set(prev);
      for (const ad of filtered) next.add(ad.externalId);
      return next;
    });
  };

  const deselectAllAds = () => setSelectedExternalIds(new Set());

  const getFilteredAds = () => {
    if (!adSearch.trim()) return allAds;
    const q = adSearch.toLowerCase();
    return allAds.filter(ad =>
      ad.name.toLowerCase().includes(q) ||
      ad.campaignName?.toLowerCase().includes(q) ||
      ad.accountName?.toLowerCase().includes(q)
    );
  };

  // Group ads by account
  const groupedAds = () => {
    const filtered = getFilteredAds();
    const groups = {};
    for (const ad of filtered) {
      const key = ad.accountName || 'Unknown Account';
      if (!groups[key]) groups[key] = [];
      groups[key].push(ad);
    }
    return groups;
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const actionParams = {};
    if (['increase_budget', 'decrease_budget'].includes(actionType)) actionParams.percentage = budgetPct;
    else if (actionType === 'set_budget') actionParams.amount = parseFloat(budgetAmount);

    const body = {
      name,
      scope,
      conditions,
      action_type: actionType,
      action_params: Object.keys(actionParams).length ? actionParams : null,
      cooldown_minutes: 0,
      max_triggers_per_day: maxTriggers,
      min_spend_threshold: parseFloat(minSpend) || 1,
      dry_run: dryRun,
      target_external_ids: selectedExternalIds.size > 0 ? [...selectedExternalIds] : null,
    };
    if (rule?.id) body.id = rule.id;

    await fetch('/api/automation/rules', { method: rule?.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setSaving(false);
    onSave();
    onClose();
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/20" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface rounded-xl shadow-elevated border border-border w-full max-w-lg animate-fade-in max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
            <h2 className="font-semibold text-foreground">{rule ? 'Edit Rule' : 'New Rule'}</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Rule Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kill High CPC Ads" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Scope</label>
              <select value={scope} onChange={e => setScope(e.target.value)} className={inputCls}>
                <option value="ad">⚡ Ad (Live — checks every 60s)</option>
                <option value="ad_set">⚡ Ad Set (Live — checks every 60s)</option>
                <option value="campaign">Campaign (DB metrics)</option>
              </select>
            </div>

            {/* Multi-Ad Picker */}
            {isLiveScope && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">
                  Target Ads
                  <span className="text-[10px] font-normal ml-1 text-muted-foreground">
                    ({selectedExternalIds.size > 0 ? `${selectedExternalIds.size} selected` : 'All ads — select specific ones below'})
                  </span>
                </label>

                <button
                  onClick={() => setAdPickerOpen(!adPickerOpen)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-sm border rounded-lg transition-colors ${
                    selectedExternalIds.size > 0
                      ? 'border-primary/40 bg-primary/5 text-foreground'
                      : 'border-border bg-surface text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CheckSquare size={14} />
                    {selectedExternalIds.size > 0
                      ? `${selectedExternalIds.size} ads selected across accounts`
                      : 'All ads (click to select specific ads)'
                    }
                  </span>
                  <ChevronDown size={14} className={`transition-transform ${adPickerOpen ? 'rotate-180' : ''}`} />
                </button>

                {adPickerOpen && (
                  <div className="mt-2 border border-border rounded-lg bg-surface shadow-elevated max-h-[300px] flex flex-col overflow-hidden animate-fade-in">
                    {/* Search + actions */}
                    <div className="p-2 border-b border-border flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={adSearch} onChange={e => setAdSearch(e.target.value)}
                          placeholder="Search ads, campaigns, accounts..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                          autoFocus
                        />
                      </div>
                      <button onClick={selectAllAds} className="text-[10px] text-primary font-medium hover:underline whitespace-nowrap">Select All</button>
                      <button onClick={deselectAllAds} className="text-[10px] text-muted-foreground hover:underline whitespace-nowrap">Clear</button>
                    </div>

                    {/* Ad list */}
                    <div className="overflow-y-auto flex-1">
                      {adsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 size={16} className="animate-spin text-primary mr-2" />
                          <span className="text-xs text-muted-foreground">Loading ads from Meta...</span>
                        </div>
                      ) : Object.entries(groupedAds()).length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-6">
                          {adSearch ? 'No ads match your search' : 'No ads found'}
                        </div>
                      ) : (
                        Object.entries(groupedAds()).map(([accountName, ads]) => (
                          <div key={accountName}>
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 sticky top-0">
                              {accountName}
                              <span className="ml-1 font-normal text-muted-foreground/70">({ads.length} ads)</span>
                            </div>
                            {ads.map(ad => (
                              <label
                                key={ad.externalId}
                                className={`flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer transition-colors ${
                                  selectedExternalIds.has(ad.externalId) ? 'bg-primary/5' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedExternalIds.has(ad.externalId)}
                                  onChange={() => toggleAdSelection(ad.externalId)}
                                  className="w-3.5 h-3.5 rounded border-border accent-primary"
                                />
                                {ad.thumbnailUrl ? (
                                  <img src={ad.thumbnailUrl} alt="" className="w-7 h-7 rounded object-cover border border-border flex-shrink-0" />
                                ) : (
                                  <div className="w-7 h-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                    <Image size={10} className="text-muted-foreground" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="truncate text-xs font-medium">{ad.name}</div>
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <span>{ad.campaignName}</span>
                                    <span className={`px-1 rounded text-[9px] ${
                                      ad.status === 'ACTIVE' ? 'bg-success/10 text-success'
                                      : ad.status === 'PAUSED' ? 'bg-warning/10 text-warning'
                                      : 'bg-muted text-muted-foreground'
                                    }`}>{ad.status}</span>
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Conditions (ALL must match)</label>
              {conditions.map((c, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center flex-wrap">
                  <select value={c.metric} onChange={e => updateCond(i, 'metric', e.target.value)} className={`${inputCls} !w-auto`}>
                    {[
                      { value: 'cpr', label: 'CPR (cost/result)' },
                      { value: 'cpc', label: 'CPC (cost/click)' },
                      { value: 'spend', label: 'Spend ($)' },
                      { value: 'ctr', label: 'CTR (%)' },
                      { value: 'cpm', label: 'CPM' },
                      { value: 'conversions', label: 'Results' },
                      { value: 'impressions', label: 'Impressions' },
                      { value: 'clicks', label: 'Clicks' },
                    ].map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <select value={c.operator} onChange={e => updateCond(i, 'operator', e.target.value)} className={`${inputCls} !w-16`}>
                    {['>', '<', '>=', '<=', '=', '!='].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="number" step="any" value={c.value} onChange={e => updateCond(i, 'value', e.target.value)} placeholder="Value" className={`${inputCls} !w-24`} />
                  <select value={c.period} onChange={e => updateCond(i, 'period', e.target.value)} className={`${inputCls} !w-auto`}>
                    {[
                      { value: 'today', label: '⚡ Today (live)' },
                      { value: 'yesterday', label: 'Yesterday' },
                      { value: 'last_3_days', label: 'Last 3 days' },
                      { value: 'last_7_days', label: 'Last 7 days' },
                      { value: 'last_14_days', label: 'Last 14 days' },
                      { value: 'last_30_days', label: 'Last 30 days' },
                    ].map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  {conditions.length > 1 && <button onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="text-destructive p-1"><X size={14} /></button>}
                </div>
              ))}
              <button onClick={() => setConditions([...conditions, { metric: 'spend', operator: '>', value: '', period: 'today' }])} className="text-xs text-primary hover:underline">+ Add Condition</button>
            </div>

            {isLiveScope && (
              <div className="rounded-lg px-4 py-3 bg-primary/5 border border-primary/20 text-xs text-foreground">
                <p className="font-semibold text-primary mb-1">⚡ Live Monitor Rule — ZERO COOLDOWN</p>
                <p className="text-muted-foreground">Checked every 60 seconds using LIVE Meta API data. <strong>NO cooldown</strong> — if metrics breach, ad is paused INSTANTLY. If metrics recover on the very next check, ad is resumed INSTANTLY. No waiting period.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Action</label>
              <select value={actionType} onChange={e => setActionType(e.target.value)} className={inputCls}>
                {isLiveScope && <option value="auto_pause_resume">🔄 Auto Pause & Resume (threshold)</option>}
                {isLiveScope && <option value="kill_switch">💀 Kill Switch (no auto-resume)</option>}
                {!isLiveScope && <option value="pause_campaign">Pause campaign</option>}
                {!isLiveScope && <option value="enable_campaign">Enable campaign</option>}
                <option value="increase_budget">Increase budget</option>
                <option value="decrease_budget">Decrease budget</option>
                <option value="set_budget">Set budget</option>
                <option value="send_alert">Send alert only</option>
              </select>
              {actionType === 'auto_pause_resume' && (
                <p className="text-[10px] text-success mt-1">✅ ZERO COOLDOWN: Pauses INSTANTLY when metrics breach → resumes INSTANTLY on next check when metrics recover. Every 60s check acts independently.</p>
              )}
              {actionType === 'kill_switch' && (
                <p className="text-[10px] text-destructive mt-1">⚠️ Permanently pauses — will NEVER auto-resume. Manual re-enable required from the paused ads section.</p>
              )}
            </div>

            {['increase_budget', 'decrease_budget'].includes(actionType) && (
              <div><label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">% Change</label><input type="number" value={budgetPct} onChange={e => setBudgetPct(parseInt(e.target.value))} className={inputCls} /></div>
            )}
            {actionType === 'set_budget' && (
              <div><label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Amount ($)</label><input type="number" value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} className={inputCls} /></div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Cooldown</label>
                <div className="flex items-center gap-2 px-3 py-2.5 text-sm border border-success/30 rounded-lg bg-success/5 text-success font-medium">
                  <Zap size={14} /> None — Instant pause & resume
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Every 60s check acts independently. No waiting between actions.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Max Triggers/Day</label>
                <input type="number" min={1} max={999} value={maxTriggers} onChange={e => setMaxTriggers(parseInt(e.target.value))} className={inputCls} />
              </div>
            </div>

            {isLiveScope && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">
                  Min Spend Before Rules Fire ($)
                  <span className="text-[10px] font-normal ml-1 text-muted-foreground">(prevents false triggers on low data)</span>
                </label>
                <input type="number" step="0.5" min={0} value={minSpend} onChange={e => setMinSpend(parseFloat(e.target.value))} className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">Ad must spend at least this much before CPC/CPR rules can trigger. Set to 0 to disable.</p>
              </div>
            )}

            {isLiveScope && (
              <div className="rounded-lg px-4 py-3 bg-success/5 border border-success/20 text-xs text-foreground">
                <p className="font-semibold text-success mb-1">⚡ How it works — ZERO COOLDOWN</p>
                <p className="text-muted-foreground">
                  Every 60 seconds: checks live metrics → if CPR/CPC exceeds threshold, ad gets <strong>paused instantly</strong> →
                  on the very next check (60s), if metrics recover, ad gets <strong>resumed instantly</strong>. No waiting period, no cooldown.
                  You can also manually resume from the "Auto-Paused Ads" section above.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between py-2">
              <div><span className="text-sm font-medium text-foreground">Dry Run</span><p className="text-xs text-muted-foreground">Log actions without executing</p></div>
              <button onClick={() => setDryRun(!dryRun)} className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${dryRun ? 'bg-primary' : 'bg-muted'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow-card transition-transform duration-200 ${dryRun ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">{saving ? 'Saving...' : rule ? 'Save Changes' : 'Create Rule'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function fmtCooldown(mins) {
  if (!mins || mins === 0) return 'None';
  if (mins < 60) return `${mins}m`;
  if (mins === 60) return '1h';
  if (mins < 1440) return `${mins / 60}h`;
  return `${mins / 1440}d`;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
