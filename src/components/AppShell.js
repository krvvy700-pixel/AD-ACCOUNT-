'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrency } from '@/context/CurrencyContext';
import { useAccount } from '@/context/AccountContext';
import { BarChart3, Target, Zap, Settings, Users, Bell, RefreshCw, X, Menu, ChevronDown, Check, Clock, LogOut, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function AppShell({ title, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currency, setCurrency } = useCurrency();
  const { accounts, selectedAccountId, setSelectedAccountId, selectedAccount } = useAccount();
  const [showNotifs, setShowNotifs] = useState(false);
  const { isAdmin, role } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [acctDropdown, setAcctDropdown] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [nextSyncIn, setNextSyncIn] = useState(null);
  const autoSyncRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      if (data.notifications) setNotifications(data.notifications);
      if (data.unreadCount != null) setUnreadCount(data.unreadCount);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifs();
    const iv = setInterval(fetchNotifs, 30000);
    return () => clearInterval(iv);
  }, [fetchNotifs]);

  const doSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const syncDays = localStorage.getItem('syncDays') || '30';
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'x-manual-trigger': 'true', 'x-sync-days': syncDays },
      });
      setLastSyncTime(new Date());
    } catch {}
    setSyncing(false);
    fetchNotifs();
  }, [syncing, fetchNotifs]);

  const handleSync = () => doSync();

  // Auto-sync timer
  useEffect(() => {
    const setupAutoSync = () => {
      // Clear existing
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);

      const minutes = parseInt(localStorage.getItem('autoSyncMinutes') || '0');
      if (!minutes || minutes <= 0) { setNextSyncIn(null); return; }

      const ms = minutes * 60_000;
      let remaining = ms;

      // Countdown ticker
      countdownRef.current = setInterval(() => {
        remaining -= 1000;
        if (remaining <= 0) remaining = ms;
        setNextSyncIn(Math.ceil(remaining / 1000));
      }, 1000);

      // Actual sync
      autoSyncRef.current = setInterval(() => {
        remaining = ms;
        doSync();
      }, ms);

      setNextSyncIn(Math.ceil(ms / 1000));
    };

    setupAutoSync();
    // Listen for settings changes
    const onStorage = (e) => { if (e.key === 'autoSyncMinutes') setupAutoSync(); };
    window.addEventListener('storage', onStorage);

    return () => {
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      window.removeEventListener('storage', onStorage);
    };
  }, [doSync]);

  const markAllRead = async () => {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    });
    setUnreadCount(0);
    setNotifications(p => p.map(n => ({ ...n, is_read: true })));
  };

  const navItems = [
    { href: '/dashboard', label: 'Analytics', icon: BarChart3 },
    { href: '/ad-performance', label: 'Ad Performance', icon: Target },
    { href: '/automation', label: 'Automation', icon: Zap },
    ...(isAdmin ? [{ href: '/user-management', label: 'Users', icon: Users }] : []),
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/login', { method: 'DELETE' });
    } catch {}
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-md bg-surface border border-border shadow-card"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 z-40 h-screen w-[260px] bg-surface border-r border-border flex flex-col transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-6 h-16 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">M</span>
          </div>
          <span className="font-semibold text-foreground text-base">Meta Ads</span>
        </div>

        {/* Account Switcher */}
        <div className="px-3 pt-4 pb-2">
          <div className="relative">
            <button
              onClick={() => setAcctDropdown(!acctDropdown)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium border border-border rounded-lg bg-background hover:bg-muted transition-colors"
            >
              <span className="truncate">
                {selectedAccountId === 'all' ? '📊 All Accounts' : selectedAccount?.name || 'Select Account'}
              </span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform ${acctDropdown ? 'rotate-180' : ''}`} />
            </button>

            {acctDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-elevated z-50 animate-fade-in overflow-hidden">
                <button
                  onClick={() => { setSelectedAccountId('all'); setAcctDropdown(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left ${selectedAccountId === 'all' ? 'text-primary font-semibold' : 'text-foreground'}`}
                >
                  📊 All Accounts
                  {selectedAccountId === 'all' && <Check size={14} className="text-primary" />}
                </button>
                <div className="border-t border-border" />
                {accounts.filter(a => a.is_active).map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => { setSelectedAccountId(acc.id); setAcctDropdown(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left ${selectedAccountId === acc.id ? 'text-primary font-semibold' : 'text-foreground'}`}
                  >
                    <div className="truncate">
                      <div className="truncate">{acc.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{acc.meta_account_id}</div>
                    </div>
                    {selectedAccountId === acc.id && <Check size={14} className="text-primary" />}
                  </button>
                ))}
                {accounts.filter(a => a.is_active).length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground text-center">No accounts connected</div>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="flex flex-col gap-1 px-3 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 ${active ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground hover:bg-muted'}`}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />}
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 pb-4 border-t border-border pt-3">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors w-full"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="lg:ml-[260px] flex flex-col min-h-screen">
        {/* Header */}
        <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-6 lg:px-8">
          <h1 className="text-lg font-semibold text-foreground lg:ml-0 ml-12">{title}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors duration-150 disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            {(nextSyncIn || lastSyncTime) && (
              <div className="flex flex-col items-end">
                {nextSyncIn && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock size={9} /> Next: {formatCountdown(nextSyncIn)}
                  </span>
                )}
                {lastSyncTime && (
                  <span className="text-[10px] text-muted-foreground">
                    Last: {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center bg-muted rounded-md p-0.5">
              {['USD', 'INR'].map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-all duration-150 ${currency === c ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {c}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowNotifs(true)}
              className="relative p-2 rounded-md hover:bg-muted transition-colors duration-150"
            >
              <Bell size={18} />
              {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>

      {/* Notification Panel */}
      {showNotifs && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setShowNotifs(false)} />
          <div className="fixed right-0 top-0 z-50 h-screen w-[380px] bg-surface border-l border-border shadow-elevated animate-slide-in-right flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
                )}
                <button onClick={() => setShowNotifs(false)} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">No notifications yet</div>
              ) : notifications.map(n => (
                <div key={n.id} className={`px-5 py-3 border-b border-border-soft hover:bg-muted/30 transition-colors ${!n.is_read ? 'border-l-2 border-l-primary' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${n.severity === 'critical' ? 'bg-destructive' : n.severity === 'warning' ? 'bg-warning' : 'bg-info'}`} />
                      <span className="text-sm font-medium text-foreground">{n.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">{formatTimeAgo(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-4">{n.message}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCountdown(seconds) {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
