'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useCurrency } from '@/context/CurrencyContext';
import { Zap, Plus, Play, Pause, Edit2, Trash2, Clock, Shield, RotateCcw, X } from 'lucide-react';

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch('/api/automation/rules'),
        fetch('/api/automation/logs?limit=20'),
      ]);
      const rulesData = await rulesRes.json();
      const logsData = await logsRes.json();
      if (rulesData.rules) setRules(rulesData.rules);
      if (logsData.logs) setLogs(logsData.logs);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-open modal if campaign param is present (from dashboard "Add Rule" button)
  useEffect(() => {
    const campaignId = searchParams.get('campaign');
    const campaignName = searchParams.get('name');
    if (campaignId && campaignName) {
      setPrefilledCampaign({ id: campaignId, name: campaignName });
      setEditingRule(null);
      setModalOpen(true);
      // Clean URL without reloading
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

  const fmtAction = (type, params) => ({
    pause_campaign: '⏸ Pause Campaign',
    enable_campaign: '▶ Enable Campaign',
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

  return (
    <AppShell title="Automation">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Zap size={18} className="text-warning" /> Automation Rules
        </h2>
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
          <p className="text-sm text-muted-foreground mb-4">Create rules to automatically manage your campaigns</p>
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg"><Plus size={14} className="inline mr-1" /> Create First Rule</button>
        </div>
      ) : rules.map(rule => (
        <div key={rule.id} className="bg-card rounded-xl border border-border shadow-card p-5 mb-3 card-hover">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${rule.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${rule.is_active ? 'bg-success' : 'bg-muted-foreground'}`} />
                {rule.is_active ? 'Active' : 'Paused'}
              </span>
              <span className="font-semibold text-foreground">{rule.name}</span>
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
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><Clock size={10} className="inline mr-1" />Cooldown: {rule.cooldown_minutes >= 60 ? `${rule.cooldown_minutes / 60}h` : `${rule.cooldown_minutes}m`}</span>
            <span>Last: {rule.last_triggered_at ? timeAgo(rule.last_triggered_at) : 'Never'}</span>
            <span>Triggers: {rule.trigger_count || 0}/{rule.max_triggers_per_day}</span>
          </div>
        </div>
      ))}

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-3">Activity Log</h3>
          <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-elevated">
                    {['Time', 'Rule', 'Campaign', 'Action', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border-soft hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{timeAgo(log.created_at)}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{log.rule_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{log.entity_name || log.entity_external_id}</td>
                      <td className="px-4 py-3">{fmtAction(log.action_type, log.action_params)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${log.status === 'executed' ? 'bg-success/10 text-success' : log.status === 'dry_run' ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'}`}>{log.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {log.status === 'executed' && !log.is_reversed && (
                          <button onClick={() => handleUndo(log.id)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                            <RotateCcw size={10} /> Undo
                          </button>
                        )}
                        {log.is_reversed && <span className="text-xs text-muted-foreground">↩ Reversed</span>}
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

function RuleModal({ rule, prefilledCampaign, onClose, onSave, formatMoney }) {
  const defaultName = prefilledCampaign ? `Rule for ${prefilledCampaign.name}` : '';
  const [name, setName] = useState(rule?.name || defaultName);
  const [scope, setScope] = useState(rule?.scope || 'campaign');
  const [actionType, setActionType] = useState(rule?.action_type || 'pause_campaign');
  const [conditions, setConditions] = useState(rule?.conditions || [{ metric: 'spend', operator: '>', value: '', period: 'today' }]);
  const [cooldown, setCooldown] = useState(rule?.cooldown_minutes || 360);
  const [maxTriggers, setMaxTriggers] = useState(rule?.max_triggers_per_day || 2);
  const [dryRun, setDryRun] = useState(rule?.dry_run || false);
  const [budgetPct, setBudgetPct] = useState(rule?.action_params?.percentage || 20);
  const [budgetAmount, setBudgetAmount] = useState(rule?.action_params?.amount || '');
  const [saving, setSaving] = useState(false);

  const updateCond = (i, field, val) => {
    const u = [...conditions];
    u[i] = { ...u[i], [field]: field === 'value' ? parseFloat(val) || '' : val };
    setConditions(u);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const actionParams = {};
    if (['increase_budget', 'decrease_budget'].includes(actionType)) actionParams.percentage = budgetPct;
    else if (actionType === 'set_budget') actionParams.amount = parseFloat(budgetAmount);

    const body = { name, scope, conditions, action_type: actionType, action_params: Object.keys(actionParams).length ? actionParams : null, cooldown_minutes: cooldown, max_triggers_per_day: maxTriggers, dry_run: dryRun };
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
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kill Low ROAS" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Scope</label>
              <select value={scope} onChange={e => setScope(e.target.value)} className={inputCls}>
                <option value="campaign">Campaign</option>
                <option value="ad_set">Ad Set</option>
                <option value="ad">Ad</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Conditions (ALL must match)</label>
              {conditions.map((c, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <select value={c.metric} onChange={e => updateCond(i, 'metric', e.target.value)} className={`${inputCls} !w-auto`}>
                    {['spend', 'conversions', 'roas', 'cpc', 'ctr', 'impressions', 'clicks'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={c.operator} onChange={e => updateCond(i, 'operator', e.target.value)} className={`${inputCls} !w-16`}>
                    {['>', '<', '>=', '<=', '=', '!='].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="number" value={c.value} onChange={e => updateCond(i, 'value', e.target.value)} placeholder="Value" className={`${inputCls} !w-24`} />
                  <select value={c.period} onChange={e => updateCond(i, 'period', e.target.value)} className={`${inputCls} !w-auto`}>
                    {['today', 'yesterday', 'last_3_days', 'last_7_days', 'last_14_days', 'last_30_days'].map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                  </select>
                  {conditions.length > 1 && <button onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="text-destructive p-1"><X size={14} /></button>}
                </div>
              ))}
              <button onClick={() => setConditions([...conditions, { metric: 'spend', operator: '>', value: '', period: 'today' }])} className="text-xs text-primary hover:underline">+ Add Condition</button>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Action</label>
              <select value={actionType} onChange={e => setActionType(e.target.value)} className={inputCls}>
                <option value="pause_campaign">Pause campaign</option>
                <option value="enable_campaign">Enable campaign</option>
                <option value="increase_budget">Increase budget</option>
                <option value="decrease_budget">Decrease budget</option>
                <option value="set_budget">Set budget</option>
                <option value="send_alert">Send alert only</option>
              </select>
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
                <select value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))} className={inputCls}>
                  <option value={60}>1 hour</option><option value={360}>6 hours</option><option value={720}>12 hours</option><option value={1440}>24 hours</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Max Triggers/Day</label>
                <input type="number" min={1} max={10} value={maxTriggers} onChange={e => setMaxTriggers(parseInt(e.target.value))} className={inputCls} />
              </div>
            </div>

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
