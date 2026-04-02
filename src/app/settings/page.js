'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import { useCurrency } from '@/context/CurrencyContext';
import { useAccount } from '@/context/AccountContext';
import { Clock, CheckCircle2, AlertCircle, Database } from 'lucide-react';

export default function SettingsPage() {
  const { rate, setRate } = useCurrency();
  const { accounts, refetchAccounts } = useAccount();
  const [rateInput, setRateInput] = useState(String(rate));
  const [rateMsg, setRateMsg] = useState('');
  const [connectStatus, setConnectStatus] = useState(null);
  const [syncDays, setSyncDays] = useState(30);
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      setConnectStatus({ type: 'success', msg: `✅ Connected ${params.get('accounts') || ''} ad account(s)!` });
      window.history.replaceState({}, '', '/settings');
      refetchAccounts();
    } else if (params.get('error')) {
      setConnectStatus({ type: 'error', msg: `❌ Connection failed: ${params.get('error')}` });
      window.history.replaceState({}, '', '/settings');
    }
    const saved = localStorage.getItem('syncDays');
    if (saved) setSyncDays(parseInt(saved));
  }, [refetchAccounts]);

  const handleConnect = () => { window.location.href = '/api/meta/connect'; };

  const toggleAccount = async (acc) => {
    await fetch('/api/meta/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: acc.id, is_active: !acc.is_active }),
    });
    refetchAccounts();
  };

  const updateRate = async () => {
    const num = parseFloat(rateInput);
    if (!num || num <= 0) return;
    setRate(num);
    try {
      await fetch('/api/settings/exchange-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: num }),
      });
      setRateMsg('✅ Rate updated!');
    } catch { setRateMsg('❌ Failed'); }
    setTimeout(() => setRateMsg(''), 3000);
  };

  const saveSyncDays = () => {
    localStorage.setItem('syncDays', String(syncDays));
    setSyncMsg('✅ Saved! Next sync will fetch this range.');
    setTimeout(() => setSyncMsg(''), 3000);
  };

  return (
    <AppShell title="Settings">
      {connectStatus && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${connectStatus.type === 'success' ? 'bg-success/10 text-success border border-success/20' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
          {connectStatus.msg}
        </div>
      )}

      {/* Meta Accounts */}
      <div className="mb-8">
        <h2 className="text-base font-semibold text-foreground mb-4">Meta Ad Accounts</h2>
        <button onClick={handleConnect}
          className="mb-4 flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
          Connect Meta Account
        </button>

        <div className="space-y-3">
          {accounts.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              No accounts connected yet
            </div>
          ) : accounts.map(acc => (
            <div key={acc.id} className="bg-card rounded-xl border border-border shadow-card p-4 flex items-center justify-between card-hover">
              <div>
                <h3 className="font-medium text-foreground flex items-center gap-2">
                  {acc.is_active ? <CheckCircle2 size={14} className="text-success" /> : <AlertCircle size={14} className="text-muted-foreground" />}
                  {acc.name}
                </h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {acc.meta_account_id} · {acc.currency} · {acc.timezone}
                  {acc.last_synced_at && <> · <Clock size={10} className="inline" /> {new Date(acc.last_synced_at).toLocaleString()}</>}
                </p>
              </div>
              <button onClick={() => toggleAccount(acc)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${acc.is_active ? 'bg-success' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow-card transition-transform duration-200 ${acc.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Sync Range */}
      <div className="mb-8">
        <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
          <Database size={16} /> Sync Range
        </h2>
        <div className="bg-card rounded-xl border border-border shadow-card p-5">
          <p className="text-sm text-muted-foreground mb-3">How far back should each sync fetch data? Longer = more data but slower.</p>
          <div className="flex items-center gap-2 mb-3">
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setSyncDays(d)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${syncDays === d ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'}`}
              >{d} days</button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveSyncDays} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">Save</button>
            {syncMsg && <span className="text-xs text-success">{syncMsg}</span>}
          </div>
        </div>
      </div>

      {/* Currency */}
      <div className="mb-8">
        <h2 className="text-base font-semibold text-foreground mb-4">Currency Conversion Rate</h2>
        <div className="bg-card rounded-xl border border-border shadow-card p-5">
          <p className="text-sm text-muted-foreground mb-3">Set the USD → INR conversion rate.</p>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">1 USD =</span>
            <input type="number" step="0.01" value={rateInput} onChange={e => setRateInput(e.target.value)}
              className="w-28 px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <span className="text-sm font-medium text-foreground">INR</span>
            <button onClick={updateRate} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">Update</button>
          </div>
          {rateMsg && <p className="text-xs text-success mt-2">{rateMsg}</p>}
        </div>
      </div>

      {/* Sync Info */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Data Sync</h2>
        <div className="bg-card rounded-xl border border-border shadow-card p-5">
          <p className="text-sm text-muted-foreground mb-3">
            Data syncs manually via &quot;Sync Now&quot;. For auto-sync, set up an external cron service.
          </p>
          <div className="bg-muted rounded-lg p-4 font-mono text-xs text-secondary-foreground leading-relaxed">
            <div>POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/sync</div>
            <div className="text-muted-foreground mt-1">Header: x-cron-secret: [your CRON_SECRET_KEY]</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
