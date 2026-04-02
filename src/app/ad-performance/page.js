'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from '@/components/AppShell';
import { useCurrency } from '@/context/CurrencyContext';
import { useAccount } from '@/context/AccountContext';
import { useAuth } from '@/context/AuthContext';
import {
  Pause, Play, Loader2, Zap, X, Image as ImageIcon,
  Film, Power, PowerOff, Search, ChevronUp, ChevronDown,
} from 'lucide-react';
import { format, addDays, isSameDay } from 'date-fns';
import { useRouter } from 'next/navigation';

export default function AdPerformancePage() {
  const { formatMoney } = useCurrency();
  const { selectedAccountId, accountQueryParam } = useAccount();
  const { canPauseEnable, canCreateRules } = useAuth();
  const router = useRouter();

  // Fetch toggle — default OFF
  const [fetchEnabled, setFetchEnabled] = useState(false);

  // Tab: campaign | adset | ad
  const [activeTab, setActiveTab] = useState('campaign');

  // Date range
  const [dateRange, setDateRange] = useState({ from: addDays(new Date(), -7), to: new Date() });

  // Data
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Sorting
  const [sortKey, setSortKey] = useState('amountSpent');
  const [sortDir, setSortDir] = useState('desc');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Action state
  const [actionLoading, setActionLoading] = useState({});

  // Media modal
  const [mediaModal, setMediaModal] = useState(null); // { adId, loading, type, url }

  const dateFrom = format(dateRange.from, 'yyyy-MM-dd');
  const dateTo = format(dateRange.to, 'yyyy-MM-dd');

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!fetchEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const acctParam = selectedAccountId !== 'all' ? `&account=${selectedAccountId}` : '';
      const res = await fetch(
        `/api/ad-performance?level=${activeTab}&from=${dateFrom}&to=${dateTo}${acctParam}`
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const json = await res.json();
      setData(json.data || []);
    } catch (err) {
      console.error('Ad performance fetch error:', err);
      setError(err.message);
      setData([]);
    }
    setLoading(false);
  }, [fetchEnabled, activeTab, dateFrom, dateTo, selectedAccountId]);

  useEffect(() => {
    if (fetchEnabled) fetchData();
    else setData([]);
  }, [fetchData, fetchEnabled]);

  // Handle sort
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  // Sort & filter data
  const filteredData = data
    .filter(item => {
      if (!searchQuery) return true;
      return item.name?.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      let aVal = a[sortKey], bVal = b[sortKey];
      if (typeof aVal === 'string') return sortDir === 'desc' ? bVal?.localeCompare(aVal) : aVal?.localeCompare(bVal);
      return sortDir === 'desc' ? (bVal || 0) - (aVal || 0) : (aVal || 0) - (bVal || 0);
    });

  // Pause/Enable action
  const handleAction = async (item, action) => {
    setActionLoading(l => ({ ...l, [item.id]: action }));
    try {
      const res = await fetch('/api/ad-performance/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: item.id,
          entityType: item.entityType,
          action,
        }),
      });
      if (res.ok) {
        // Optimistic update
        setData(prev => prev.map(d =>
          d.id === item.id ? { ...d, status: action === 'pause' ? 'PAUSED' : 'ACTIVE' } : d
        ));
      }
    } catch {}
    setActionLoading(l => ({ ...l, [item.id]: null }));
  };

  // Open media modal (fetch video on click)
  const openMediaModal = async (item) => {
    if (item.entityType !== 'ad') return;
    setMediaModal({ adId: item.externalId, loading: true, type: 'image', url: item.thumbnailUrl });
    try {
      const res = await fetch(`/api/ad-performance/media?adId=${item.externalId}`);
      if (res.ok) {
        const media = await res.json();
        setMediaModal(prev => ({
          ...prev,
          loading: false,
          type: media.type || 'image',
          url: media.url || item.thumbnailUrl,
        }));
      } else {
        setMediaModal(prev => ({ ...prev, loading: false }));
      }
    } catch {
      setMediaModal(prev => ({ ...prev, loading: false }));
    }
  };

  const presets = [
    { label: 'Today', get: () => ({ from: new Date(), to: new Date() }) },
    { label: 'Yesterday', get: () => ({ from: addDays(new Date(), -1), to: addDays(new Date(), -1) }) },
    { label: '7D', get: () => ({ from: addDays(new Date(), -7), to: new Date() }) },
    { label: '14D', get: () => ({ from: addDays(new Date(), -14), to: new Date() }) },
    { label: '30D', get: () => ({ from: addDays(new Date(), -30), to: new Date() }) },
  ];

  const tabs = [
    { key: 'campaign', label: 'Campaigns' },
    { key: 'adset', label: 'Ad Sets' },
    { key: 'ad', label: 'Ads' },
  ];

  return (
    <AppShell title="Ad Performance">
      {/* ─── Fetch Toggle ─── */}
      <div className={`flex items-center justify-between mb-6 px-5 py-4 rounded-xl border transition-all duration-300 ${
        fetchEnabled
          ? 'bg-success/5 border-success/30'
          : 'bg-card border-border shadow-card'
      }`}>
        <div className="flex items-center gap-3">
          {fetchEnabled
            ? <Power size={20} className="text-success" />
            : <PowerOff size={20} className="text-muted-foreground" />
          }
          <div>
            <p className="text-sm font-semibold text-foreground">
              {fetchEnabled ? 'Data Fetching Active' : 'Data Fetching Paused'}
            </p>
            <p className="text-xs text-muted-foreground">
              {fetchEnabled
                ? 'Live data is being loaded from your accounts'
                : 'Turn on to start fetching ad performance data — no API calls until you enable this'
              }
            </p>
          </div>
        </div>
        <button
          onClick={() => setFetchEnabled(v => !v)}
          className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${
            fetchEnabled ? 'bg-success' : 'bg-muted'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${
            fetchEnabled ? 'translate-x-7' : 'translate-x-0'
          }`} />
        </button>
      </div>

      {/* ─── Controls Row ─── */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {/* Date presets */}
        <div className="flex items-center bg-muted rounded-lg p-0.5">
          {presets.map(p => {
            const r = p.get();
            const active = isSameDay(dateRange.from, r.from) && isSameDay(dateRange.to, r.to);
            return (
              <button key={p.label} onClick={() => setDateRange(p.get())}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  active ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{p.label}</button>
            );
          })}
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-1.5">
          <input type="date" value={dateFrom}
            onChange={e => setDateRange(r => ({ ...r, from: new Date(e.target.value) }))}
            className="px-2 py-1.5 text-xs border border-border rounded-md bg-surface text-foreground"
          />
          <span className="text-[10px] text-muted-foreground">to</span>
          <input type="date" value={dateTo}
            onChange={e => setDateRange(r => ({ ...r, to: new Date(e.target.value) }))}
            className="px-2 py-1.5 text-xs border border-border rounded-md bg-surface text-foreground"
          />
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-border mx-1" />

        {/* Tabs */}
        <div className="flex items-center bg-muted rounded-lg p-0.5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === t.key
                  ? 'bg-surface text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* ─── Content ─── */}
      {!fetchEnabled ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-16 text-center">
          <PowerOff size={40} className="mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Fetching is Off</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Enable the toggle above to start loading ad performance data. No API calls are made while this is off — even auto-refresh won't trigger.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeTab === 'campaign' ? 'campaigns' : activeTab === 'adset' ? 'ad sets' : 'ads'}...`}
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin text-primary" />
                {activeTab === 'campaign' ? 'Loading from DB...' : 'Fetching from Meta API...'}
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  {[
                    ['name', 'Name'],
                    ...(activeTab === 'ad' ? [['preview', 'Preview']] : []),
                    ['status', 'Status'],
                    ['results', 'Results'],
                    ['cpr', 'Cost / Result'],
                    ['cpm', 'CPM'],
                    ['amountSpent', 'Amount Spent'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => key !== 'preview' && handleSort(key)}
                      className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider select-none transition-colors ${
                        key === 'preview' ? 'text-muted-foreground' :
                        sortKey === key ? 'text-primary cursor-pointer' : 'text-muted-foreground cursor-pointer hover:text-foreground'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {key !== 'preview' && <SortIcon col={key} />}
                      </span>
                    </th>
                  ))}
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={activeTab === 'ad' ? 8 : 7} className="text-center py-16">
                      <Loader2 size={24} className="animate-spin text-primary mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {activeTab === 'campaign' ? 'Loading campaigns...' :
                         activeTab === 'adset' ? 'Fetching ad sets from Meta API...' :
                         'Fetching ads from Meta API...'}
                      </p>
                      {activeTab !== 'campaign' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          This may take a few seconds for live data
                        </p>
                      )}
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={activeTab === 'ad' ? 8 : 7} className="text-center py-12 text-sm text-muted-foreground">
                      {error ? `Error: ${error}` : 'No data found for this date range'}
                    </td>
                  </tr>
                ) : filteredData.map((item) => (
                  <tr key={item.id} className="border-b border-border-soft hover:bg-muted/30 transition-colors">
                    {/* Name */}
                    <td className="px-4 py-3 font-medium text-foreground max-w-[250px]">
                      <div className="truncate" title={item.name}>{item.name}</div>
                    </td>

                    {/* Preview — only for Ads tab */}
                    {activeTab === 'ad' && (
                      <td className="px-4 py-3">
                        {item.thumbnailUrl ? (
                          <button
                            onClick={() => openMediaModal(item)}
                            className="relative group w-12 h-12 rounded-lg overflow-hidden border border-border hover:border-primary transition-all hover:shadow-md"
                          >
                            <img
                              src={item.thumbnailUrl}
                              alt="Ad preview"
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-all">
                              <Film size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </button>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                            <ImageIcon size={16} className="text-muted-foreground" />
                          </div>
                        )}
                      </td>
                    )}

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.status === 'ACTIVE' ? 'bg-success/10 text-success' :
                        item.status === 'PAUSED' ? 'bg-warning/10 text-warning' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          item.status === 'ACTIVE' ? 'bg-success' :
                          item.status === 'PAUSED' ? 'bg-warning' :
                          'bg-muted-foreground'
                        }`} />
                        {item.status}
                      </span>
                    </td>

                    {/* Results */}
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {formatNum(item.results)}
                    </td>

                    {/* Cost per Result */}
                    <td className="px-4 py-3">
                      {item.cpr > 0 ? formatMoney(item.cpr) : '—'}
                    </td>

                    {/* CPM */}
                    <td className="px-4 py-3">
                      {item.cpm > 0 ? formatMoney(item.cpm) : '—'}
                    </td>

                    {/* Amount Spent */}
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {formatMoney(item.amountSpent)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {canPauseEnable && (
                      <div className="flex items-center gap-1">
                        {item.status === 'ACTIVE' ? (
                          <button
                            onClick={() => handleAction(item, 'pause')}
                            disabled={!!actionLoading[item.id]}
                            className="p-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
                            title="Pause"
                          >
                            {actionLoading[item.id] === 'pause'
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Pause size={12} />
                            }
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction(item, 'enable')}
                            disabled={!!actionLoading[item.id]}
                            className="p-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-50"
                            title="Enable"
                          >
                            {actionLoading[item.id] === 'enable'
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Play size={12} />
                            }
                          </button>
                        )}
                        {canCreateRules && item.entityType === 'campaign' && (
                          <button
                            onClick={() => router.push(`/automation?campaign=${item.id}&name=${encodeURIComponent(item.name)}`)}
                            className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            title="Add Rule"
                          >
                            <Zap size={12} />
                          </button>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer stats */}
          {filteredData.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-elevated/50">
              <span className="text-xs text-muted-foreground">
                {filteredData.length} {activeTab === 'campaign' ? 'campaigns' : activeTab === 'adset' ? 'ad sets' : 'ads'}
              </span>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Total Spent: <b className="text-foreground">{formatMoney(filteredData.reduce((s, d) => s + d.amountSpent, 0))}</b></span>
                <span>Total Results: <b className="text-foreground">{formatNum(filteredData.reduce((s, d) => s + (d.results || 0), 0))}</b></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Media Modal ─── */}
      {mediaModal && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm" onClick={() => setMediaModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl border border-border shadow-elevated max-w-lg w-full overflow-hidden animate-fade-in">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {mediaModal.type === 'video' ? <Film size={14} /> : <ImageIcon size={14} />}
                  {mediaModal.type === 'video' ? 'Video Preview' : 'Image Preview'}
                </h3>
                <button onClick={() => setMediaModal(null)} className="p-1 rounded hover:bg-muted">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4">
                {mediaModal.loading ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-primary mb-3" />
                    <p className="text-xs text-muted-foreground">Loading media...</p>
                  </div>
                ) : mediaModal.type === 'video' && mediaModal.url ? (
                  <video
                    src={mediaModal.url}
                    controls
                    autoPlay
                    className="w-full rounded-lg"
                    style={{ maxHeight: '400px' }}
                  />
                ) : mediaModal.url ? (
                  <img
                    src={mediaModal.url}
                    alt="Ad creative"
                    className="w-full rounded-lg object-contain"
                    style={{ maxHeight: '400px' }}
                  />
                ) : (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No preview available for this ad
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function formatNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
