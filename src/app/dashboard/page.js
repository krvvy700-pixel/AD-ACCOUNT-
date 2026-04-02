'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppShell from '@/components/AppShell';
import { useCurrency } from '@/context/CurrencyContext';
import { useAccount } from '@/context/AccountContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area
} from 'recharts';
import {
  ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown,
  TrendingUp, TrendingDown, Minus, Search, Filter
} from 'lucide-react';
import { format, addDays, subMonths, startOfMonth, endOfMonth, subDays, isSameMonth, isSameDay, isToday } from 'date-fns';

export default function DashboardPage() {
  const { formatMoney, currency } = useCurrency();
  const { selectedAccountId, accountQueryParam } = useAccount();
  const [dateRange, setDateRange] = useState({ from: addDays(new Date(), -14), to: new Date() });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [breakdown, setBreakdown] = useState('day');

  const [kpis, setKpis] = useState(null);
  const [chart, setChart] = useState([]);
  const [trends, setTrends] = useState(null);
  const [performance, setPerformance] = useState({ topCampaigns: [], bottomCampaigns: [] });

  const [campaigns, setCampaigns] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);

  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [perfFilter, setPerfFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Client-side cache for instant switching
  const cacheRef = useRef({});
  const searchTimerRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  const dateFrom = format(dateRange.from, 'yyyy-MM-dd');
  const dateTo = format(dateRange.to, 'yyyy-MM-dd');

  // Fetch overview data with caching
  const fetchOverview = useCallback(async () => {
    const cacheKey = `${dateFrom}_${dateTo}_${breakdown}_${selectedAccountId}`;
    // Serve from cache instantly
    if (cacheRef.current[cacheKey]) {
      const cached = cacheRef.current[cacheKey];
      setKpis(cached.kpis); setChart(cached.chart);
      setTrends(cached.trends); setPerformance(cached.performance);
    }
    setOverviewLoading(true);
    try {
      const res = await fetch(
        `/api/analytics/overview?from=${dateFrom}&to=${dateTo}&breakdown=${breakdown}${accountQueryParam}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.kpis) setKpis(data.kpis);
      if (data.chart) setChart(data.chart);
      if (data.trends) setTrends(data.trends);
      if (data.performance) setPerformance(data.performance);
      // Store in cache
      cacheRef.current[cacheKey] = data;
    } catch {}
    setOverviewLoading(false);
  }, [dateFrom, dateTo, breakdown, accountQueryParam, selectedAccountId]);

  // Fetch campaign table
  const fetchCampaigns = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        from: dateFrom, to: dateTo,
        sort: sortKey, order: sortDir,
        page: String(page), limit: '25',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (perfFilter) params.set('performance', perfFilter);
      if (selectedAccountId !== 'all') params.set('account', selectedAccountId);

      const res = await fetch(`/api/analytics/campaigns?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.campaigns) setCampaigns(data.campaigns);
      if (data.pagination) setPagination(data.pagination);
      if (data.summary) setSummary(data.summary);
      if (data.filterOptions) setFilterOptions(data.filterOptions);
    } catch {}
  }, [dateFrom, dateTo, sortKey, sortDir, page, debouncedSearch, perfFilter, selectedAccountId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOverview(), fetchCampaigns()]).finally(() => setLoading(false));
  }, [fetchOverview, fetchCampaigns]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [debouncedSearch, perfFilter, selectedAccountId]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const kpiCards = kpis ? [
    { label: 'SPEND', value: formatMoney(kpis.spend.value), change: kpis.spend.change, accent: 'bg-primary' },
    { label: 'REACH', value: formatNum(kpis.reach?.value), change: kpis.reach?.change, accent: 'bg-success' },
    { label: 'CLICKS', value: formatNum(kpis.clicks?.value), change: kpis.clicks?.change, accent: 'bg-warning' },
    { label: 'CPC', value: formatMoney(kpis.cpc?.value), change: kpis.cpc?.change, accent: 'bg-info', invertColor: true },
    { label: 'CTR', value: `${(kpis.ctr?.value || 0).toFixed(2)}%`, change: kpis.ctr?.change, accent: 'bg-purple-500' },
    { label: 'ROAS', value: `${(kpis.roas?.value || 0).toFixed(1)}x`, change: kpis.roas?.change, accent: 'bg-success' },
  ] : [];

  const presets = [
    { label: 'Today', get: () => ({ from: new Date(), to: new Date() }) },
    { label: 'Yesterday', get: () => ({ from: addDays(new Date(), -1), to: addDays(new Date(), -1) }) },
    { label: '7D', get: () => ({ from: addDays(new Date(), -7), to: new Date() }) },
    { label: '14D', get: () => ({ from: addDays(new Date(), -14), to: new Date() }) },
    { label: '30D', get: () => ({ from: addDays(new Date(), -30), to: new Date() }) },
  ];

  return (
    <AppShell title="Performance Overview">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          {presets.map(p => {
            const r = p.get();
            const active = isSameDay(dateRange.from, r.from) && isSameDay(dateRange.to, r.to);
            return (
              <button key={p.label} onClick={() => setDateRange(p.get())}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >{p.label}</button>
            );
          })}
          <input type="date" value={dateFrom} onChange={e => setDateRange(r => ({ ...r, from: new Date(e.target.value) }))}
            className="px-2 py-1.5 text-xs border border-border rounded-md bg-surface text-foreground" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={dateTo} onChange={e => setDateRange(r => ({ ...r, to: new Date(e.target.value) }))}
            className="px-2 py-1.5 text-xs border border-border rounded-md bg-surface text-foreground" />
        </div>
        <div className="flex items-center bg-muted rounded-md p-0.5">
          {['day', 'week', 'month'].map(b => (
            <button key={b} onClick={() => setBreakdown(b)}
              className={`px-3 py-1 text-xs font-medium rounded capitalize transition-all ${breakdown === b ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'}`}
            >{b}</button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {loading && !kpis ? (
          Array(6).fill(0).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
              <div className="h-0.5 bg-muted" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                <div className="h-6 w-20 bg-muted rounded animate-pulse" />
                <div className="h-4 w-14 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))
        ) : kpiCards.map((kpi) => {
          const isGood = kpi.invertColor ? (kpi.change || 0) < 0 : (kpi.change || 0) > 0;
          return (
            <div key={kpi.label} className="bg-card rounded-xl border border-border shadow-card card-hover overflow-hidden">
              <div className={`h-0.5 ${kpi.accent}`} />
              <div className="p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</span>
                <div className="mt-1 text-xl font-bold text-foreground">{kpi.value}</div>
                {kpi.change != null && (
                  <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${isGood ? 'text-success' : 'text-destructive'}`}>
                    {isGood ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {Math.abs(kpi.change).toFixed(1)}%
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Trends */}
      {trends && (
        <div className="flex flex-wrap gap-4 mb-6">
          {Object.entries(trends).map(([metric, dir]) => {
            if (dir === 'insufficient_data') return null;
            const isGood = (['conversions', 'roas'].includes(metric) && dir === 'increasing') ||
                          (['cpc', 'spend'].includes(metric) && dir === 'decreasing');
            return (
              <div key={metric} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${isGood ? 'bg-success/10 text-success' : dir === 'stable' ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'}`}>
                {dir === 'increasing' ? <TrendingUp size={12} /> : dir === 'decreasing' ? <TrendingDown size={12} /> : <Minus size={12} />}
                {metric.toUpperCase()}: {dir}
              </div>
            );
          })}
        </div>
      )}

      {/* Chart */}
      <div className="bg-card rounded-xl border border-border shadow-card p-6 mb-8">
        <h3 className="text-sm font-semibold text-foreground mb-4">Spend & Conversions</h3>
        {chart.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="spendG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(217 91% 53%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(217 91% 53%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="convG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(210 40% 96%)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(215 16% 62%)" tickFormatter={d => {
                if (d.length === 7) return d; // month
                const dt = new Date(d);
                return `${dt.getMonth()+1}/${dt.getDate()}`;
              }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="hsl(215 16% 62%)" tickFormatter={v => currency === 'INR' ? `₹${v}` : `$${v}`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(215 16% 62%)" />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid hsl(220 13% 91%)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Area yAxisId="left" type="monotone" dataKey="spend" stroke="hsl(217 91% 53%)" fill="url(#spendG)" strokeWidth={2} name="Spend ($)" />
              <Area yAxisId="right" type="monotone" dataKey="conversions" stroke="hsl(160 84% 39%)" fill="url(#convG)" strokeWidth={2} name="Conversions" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {loading ? 'Loading chart data...' : 'No data yet — connect your Meta account and sync'}
          </div>
        )}
      </div>

      {/* Top/Bottom Performers (side by side) */}
      {(performance.topCampaigns.length > 0 || performance.bottomCampaigns.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-card rounded-xl border border-border shadow-card p-5">
            <h4 className="text-sm font-semibold text-foreground mb-3">🏆 Top Performers</h4>
            {performance.topCampaigns.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border-soft last:border-0">
                <span className="text-sm text-foreground truncate mr-2">{c.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-success font-semibold">{(c.roas || 0).toFixed(1)}x</span>
                  <span className="text-xs text-muted-foreground">{formatMoney(c.spend)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border shadow-card p-5">
            <h4 className="text-sm font-semibold text-foreground mb-3">⚠️ Underperformers</h4>
            {performance.bottomCampaigns.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border-soft last:border-0">
                <span className="text-sm text-foreground truncate mr-2">{c.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-destructive font-semibold">{(c.roas || 0).toFixed(1)}x</span>
                  <span className="text-xs text-muted-foreground">{formatMoney(c.spend)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="flex flex-wrap gap-3 mb-4">
          {[
            { label: 'Total', val: summary.totalCampaigns },
            { label: 'Active', val: summary.activeCampaigns, color: 'text-success' },
            { label: 'Profitable', val: summary.profitableCampaigns, color: 'text-success' },
            { label: 'Losing', val: summary.losingCampaigns, color: 'text-destructive' },
            { label: 'Avg ROAS', val: `${summary.avgRoas}x` },
            { label: 'Total Spend', val: formatMoney(summary.totalSpend) },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-lg px-3 py-2 text-center">
              <div className="text-[10px] uppercase text-muted-foreground">{s.label}</div>
              <div className={`text-sm font-bold ${s.color || 'text-foreground'}`}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Campaign Table */}
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        {/* Table controls */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search campaigns..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex items-center bg-muted rounded-md p-0.5">
            {[{ l: 'All', v: '' }, { l: 'Top', v: 'top' }, { l: 'Avg', v: 'average' }, { l: 'Losing', v: 'losing' }].map(f => (
              <button key={f.l} onClick={() => setPerfFilter(f.v)}
                className={`px-3 py-1 text-xs font-medium rounded transition-all ${perfFilter === f.v ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'}`}
              >{f.l}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-elevated">
                {[
                  ['name', 'Name'], ['status', 'Status'], ['accountName', 'Account'],
                  ['spend', 'Spend'], ['clicks', 'Clicks'], ['conversions', 'Conv.'],
                  ['cpc', 'CPC'], ['ctr', 'CTR'], ['roas', 'ROAS'], ['performanceTier', 'Tier'],
                ].map(([key, label]) => (
                  <th key={key} onClick={() => handleSort(key)}
                    className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors select-none ${sortKey === key ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    <span className="flex items-center gap-1">{label}<SortIcon col={key} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && !loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-sm text-muted-foreground">No campaigns found</td></tr>
              ) : campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border-soft hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'ACTIVE' ? 'bg-success/10 text-success' : c.status === 'PAUSED' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'ACTIVE' ? 'bg-success' : c.status === 'PAUSED' ? 'bg-warning' : 'bg-muted-foreground'}`} />
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{c.accountName}</td>
                  <td className="px-4 py-3">
                    {formatMoney(c.spend)}
                    {c.changes?.spend ? <ChangeInline value={c.changes.spend} /> : null}
                  </td>
                  <td className="px-4 py-3">{formatNum(c.clicks)}</td>
                  <td className="px-4 py-3">{c.conversions}</td>
                  <td className="px-4 py-3">{formatMoney(c.cpc)}</td>
                  <td className="px-4 py-3">{(c.ctr || 0).toFixed(2)}%</td>
                  <td className={`px-4 py-3 font-semibold ${c.roas >= 3 ? 'text-success' : c.roas >= 1 ? 'text-warning' : 'text-destructive'}`}>
                    {(c.roas || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                      c.performanceTier === 'top' ? 'bg-success/10 text-success' :
                      c.performanceTier === 'average' ? 'bg-primary/10 text-primary' :
                      c.performanceTier === 'losing' ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>{c.performanceTier || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.totalCount)} of {pagination.totalCount}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs font-medium border border-border rounded hover:bg-muted disabled:opacity-40 transition-colors"
              >← Prev</button>
              <span className="text-xs text-muted-foreground">Page {pagination.page}/{pagination.totalPages}</span>
              <button disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs font-medium border border-border rounded hover:bg-muted disabled:opacity-40 transition-colors"
              >Next →</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ChangeInline({ value }) {
  if (!value) return null;
  const isPos = value > 0;
  return (
    <span className={`ml-1 text-[10px] font-medium ${isPos ? 'text-success' : 'text-destructive'}`}>
      {isPos ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function formatNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
