'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import AppShell from '@/components/AppShell';
import { useAccount } from '@/context/AccountContext';
import { useAuth } from '@/context/AuthContext';
import {
  MessageCircle, Loader2, Send, Eye, EyeOff, Trash2, RefreshCw,
  X, Power, PowerOff, Search, ChevronDown, Image, Film,
  Ban, AlertTriangle, CheckSquare, Shield,
} from 'lucide-react';

const FbIcon = ({ size = 12 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
const IgIcon = ({ size = 12 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>;

export default function CommentsPage() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccount();
  const { canPauseEnable } = useAuth();

  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [comments, setComments] = useState([]);
  const [ads, setAds] = useState([]); // Ads list from API for filter dropdown
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [selectedAdId, setSelectedAdId] = useState('all'); // Filter by specific ad
  const [adDropdownOpen, setAdDropdownOpen] = useState(false);
  const [adSearchQuery, setAdSearchQuery] = useState('');

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  // Action loading
  const [actionLoading, setActionLoading] = useState({});

  // Spam & Block state
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'spam' | 'blocked'
  const [totalSpam, setTotalSpam] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [blocked, setBlocked] = useState([]);
  const [blockModal, setBlockModal] = useState(null);
  const [blockReason, setBlockReason] = useState('Spam/Fake comment');

  const fetchComments = useCallback(async () => {
    if (!fetchEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const acctParam = selectedAccountId && selectedAccountId !== 'all' ? `&account=${selectedAccountId}` : '';
      const adParam = selectedAdId && selectedAdId !== 'all' ? `&ad=${selectedAdId}` : '';
      const res = await fetch(`/api/comments?limit=200${acctParam}${adParam}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const data = await res.json();
      setComments(data.comments || []);
      setTotal(data.total || 0);
      setTotalSpam(data.totalSpam || 0);
      // Only update ads list on first load or when account changes (not on ad filter change)
      if (data.ads?.length) setAds(data.ads);
    } catch (err) {
      setError(err.message);
      setComments([]);
    }
    setLoading(false);
  }, [fetchEnabled, selectedAccountId, selectedAdId]);

  useEffect(() => {
    if (fetchEnabled) fetchComments();
    else { setComments([]); setTotal(0); setAds([]); }
  }, [fetchComments, fetchEnabled]);

  // Reset ad filter when account changes
  useEffect(() => {
    setSelectedAdId('all');
  }, [selectedAccountId]);

  // Filter ads for the dropdown based on account + search
  const filteredAds = useMemo(() => {
    let filtered = ads;
    if (selectedAccountId && selectedAccountId !== 'all') {
      filtered = filtered.filter(a => a.accountId === selectedAccountId);
    }
    if (platformFilter !== 'all') {
      filtered = filtered.filter(a => a.platform === platformFilter);
    }
    if (adSearchQuery.trim()) {
      const q = adSearchQuery.toLowerCase();
      filtered = filtered.filter(a => a.name.toLowerCase().includes(q));
    }
    return filtered;
  }, [ads, selectedAccountId, platformFilter, adSearchQuery]);

  // Group ads by account for the dropdown
  const groupedAds = useMemo(() => {
    const groups = {};
    for (const ad of filteredAds) {
      if (!groups[ad.accountName]) groups[ad.accountName] = [];
      groups[ad.accountName].push(ad);
    }
    return groups;
  }, [filteredAds]);

  // Filter comments client-side by search
  const filtered = useMemo(() => {
    return comments.filter(c => {
      if (activeTab === 'spam' && !c.isSpam) return false;
      if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
      if (!searchQuery) return true;
      return c.message?.toLowerCase().includes(searchQuery.toLowerCase())
        || c.authorName?.toLowerCase().includes(searchQuery.toLowerCase())
        || c.adName?.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [comments, platformFilter, searchQuery, activeTab]);

  // Fetch blocked accounts
  const fetchBlocked = useCallback(async () => {
    try {
      const res = await fetch('/api/comments/blocked');
      if (res.ok) { const data = await res.json(); setBlocked(data.blocked || []); }
    } catch {}
  }, []);

  useEffect(() => { if (activeTab === 'blocked') fetchBlocked(); }, [activeTab, fetchBlocked]);

  // Block action
  const handleBlock = async (comment) => {
    setActionLoading(l => ({ ...l, [`block_${comment.id}`]: true }));
    try {
      const res = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'block', userId: comment.authorId,
          postId: comment.postId, platform: comment.platform,
          userName: comment.authorName, reason: blockReason,
        }),
      });
      if (res.ok) { setBlockModal(null); fetchBlocked(); }
      else { const err = await res.json(); alert(err.error || 'Block failed'); }
    } catch {}
    setActionLoading(l => ({ ...l, [`block_${comment.id}`]: false }));
  };

  // Unblock
  const handleUnblock = async (b) => {
    setActionLoading(l => ({ ...l, [`unblock_${b.user_id}`]: true }));
    try {
      const res = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unblock', userId: b.user_id, pageId: b.page_id }),
      });
      if (res.ok) setBlocked(prev => prev.filter(x => x.user_id !== b.user_id));
    } catch {}
    setActionLoading(l => ({ ...l, [`unblock_${b.user_id}`]: false }));
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_delete', commentIds: [...selectedIds] }),
      });
      if (res.ok) { setComments(prev => prev.filter(c => !selectedIds.has(c.id))); setSelectedIds(new Set()); }
    } catch {}
    setBulkLoading(false);
  };

  // Delete all spam
  const handleDeleteAllSpam = async () => {
    if (!confirm('Delete ALL detected spam comments? This cannot be undone.')) return;
    setBulkLoading(true);
    const spamIds = comments.filter(c => c.isSpam).map(c => c.id);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_delete', commentIds: spamIds }),
      });
      if (res.ok) { setComments(prev => prev.filter(c => !c.isSpam)); setSelectedIds(new Set()); }
    } catch {}
    setBulkLoading(false);
  };

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  // Selected ad name for display
  const selectedAdName = selectedAdId !== 'all'
    ? (ads.find(a => a.id === selectedAdId)?.name || 'Selected Ad')
    : null;

  // Handle reply
  const handleReply = async (commentId, postId, platform) => {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, action: 'reply', message: replyText, postId, platform }),
      });
      if (res.ok) {
        setReplyingTo(null);
        setReplyText('');
        fetchComments();
      } else {
        const err = await res.json();
        alert(err.error || 'Reply failed');
      }
    } catch {}
    setReplyLoading(false);
  };

  // Handle hide/delete
  const handleAction = async (commentId, action, postId, platform) => {
    setActionLoading(l => ({ ...l, [commentId]: action }));
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, action, postId, platform }),
      });
      if (res.ok) {
        if (action === 'delete') {
          setComments(prev => prev.filter(c => c.id !== commentId));
        } else {
          setComments(prev => prev.map(c =>
            c.id === commentId ? { ...c, isHidden: action === 'hide' } : c
          ));
        }
      } else {
        let err;
        try { err = await res.json(); } catch { err = { error: 'Unknown server error' }; }
        alert(err.error || `${action} failed`);
      }
    } catch (e) {
      alert(`${action} failed due to network error`);
    } finally {
      setActionLoading(l => ({ ...l, [commentId]: null }));
    }
  };

  return (
    <AppShell title="Comments">
      {/* Tabs: All | Spam & Fake | Blocked */}
      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 mb-4 w-fit">
        {[{ key: 'all', label: 'All Comments', icon: MessageCircle, count: total },
          { key: 'spam', label: 'Spam & Fake', icon: AlertTriangle, count: totalSpam },
          { key: 'blocked', label: 'Blocked', icon: Ban, count: blocked.length }].map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSelectedIds(new Set()); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === tab.key ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}>
            <tab.icon size={12} />
            {tab.label}
            {tab.count > 0 && <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              tab.key === 'spam' && activeTab !== 'spam' ? 'bg-destructive text-white' : 'bg-muted-foreground/20 text-muted-foreground'
            }`}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Blocked Accounts Tab */}
      {activeTab === 'blocked' ? (
        <div className="bg-card rounded-xl border border-border shadow-card">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Ban size={14} /> Blocked Accounts</h3>
          </div>
          {blocked.length === 0 ? (
            <div className="text-center py-12"><Ban size={32} className="mx-auto text-muted-foreground/40 mb-3" /><p className="text-sm text-muted-foreground">No blocked accounts</p></div>
          ) : (
            <div className="divide-y divide-border">
              {blocked.map(b => (
                <div key={b.id || b.user_id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30">
                  <div><div className="text-sm font-medium">{b.user_name}</div><div className="text-xs text-muted-foreground">{b.reason} · {timeAgo(b.blocked_at)}</div></div>
                  <button onClick={() => handleUnblock(b)} disabled={actionLoading[`unblock_${b.user_id}`]
                  } className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted disabled:opacity-50">
                    {actionLoading[`unblock_${b.user_id}`] ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Unblock
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (<>
      {/* Fetch Toggle */}
      <div className={`flex items-center justify-between mb-6 px-5 py-4 rounded-xl border transition-all duration-300 ${
        fetchEnabled ? 'bg-success/5 border-success/30' : 'bg-card border-border shadow-card'
      }`}>
        <div className="flex items-center gap-3">
          {fetchEnabled
            ? <Power size={20} className="text-success" />
            : <PowerOff size={20} className="text-muted-foreground" />}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {fetchEnabled ? 'Comments Loaded' : 'Comments Not Loaded'}
            </p>
            <p className="text-xs text-muted-foreground">
              {fetchEnabled
                ? `${total} comments from ${ads.length} ads across your accounts`
                : 'Enable to fetch comments from your ads — uses Meta API'}
            </p>
          </div>
        </div>
        <button onClick={() => setFetchEnabled(v => !v)}
          className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${fetchEnabled ? 'bg-success' : 'bg-muted'}`}>
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${fetchEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Filter Bar */}
      {fetchEnabled && (
        <div className="space-y-3 mb-6">
          {/* Row 1: Search + Platform + Refresh */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search comments, authors, or ad names..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            {/* Platform filter */}
            <div className="flex items-center bg-muted rounded-lg p-0.5">
              {[
                { key: 'all', label: 'All' },
                { key: 'facebook', label: 'Facebook', Icon: FbIcon },
                { key: 'instagram', label: 'Instagram', Icon: IgIcon },
              ].map(p => (
                <button key={p.key} onClick={() => setPlatformFilter(p.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    platformFilter === p.key ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {p.Icon && <p.Icon size={12} />}
                  {p.label}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button onClick={fetchComments} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg bg-surface hover:bg-muted transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>

            {/* Spam tab: Delete All */}
            {activeTab === 'spam' && totalSpam > 0 && (
              <button onClick={handleDeleteAllSpam} disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50">
                {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete All Spam
              </button>
            )}
          </div>

          {/* Row 2: Ad/Post filter dropdown */}
          <div className="flex items-center gap-2">
            {/* Ad filter dropdown */}
            <div className="relative flex-1 max-w-md">
              <button
                onClick={() => setAdDropdownOpen(!adDropdownOpen)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm border rounded-lg transition-colors ${
                  selectedAdId !== 'all'
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-surface text-foreground hover:bg-muted'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {selectedAdId !== 'all' ? (
                    <>
                      <Film size={14} className="text-primary flex-shrink-0" />
                      <span className="truncate">{selectedAdName}</span>
                    </>
                  ) : (
                    <>
                      <MessageCircle size={14} className="text-muted-foreground" />
                      <span className="text-muted-foreground">All Ads & Posts</span>
                    </>
                  )}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selectedAdId !== 'all' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedAdId('all'); }}
                      className="p-0.5 rounded hover:bg-muted"
                    >
                      <X size={12} className="text-muted-foreground" />
                    </button>
                  )}
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${adDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {adDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAdDropdownOpen(false)} />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-elevated z-40 animate-fade-in max-h-[400px] flex flex-col">
                    {/* Search within dropdown */}
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={adSearchQuery}
                          onChange={e => setAdSearchQuery(e.target.value)}
                          placeholder="Search ads..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Options */}
                    <div className="overflow-y-auto flex-1">
                      {/* All option */}
                      <button
                        onClick={() => { setSelectedAdId('all'); setAdDropdownOpen(false); setAdSearchQuery(''); }}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${
                          selectedAdId === 'all' ? 'text-primary font-semibold bg-primary/5' : 'text-foreground'
                        }`}
                      >
                        <MessageCircle size={14} />
                        All Ads & Posts
                        <span className="ml-auto text-xs text-muted-foreground">{ads.length} ads</span>
                      </button>

                      <div className="border-t border-border" />

                      {/* Grouped by account */}
                      {Object.entries(groupedAds).map(([accountName, accountAds]) => (
                        <div key={accountName}>
                          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 sticky top-0">
                            {accountName}
                          </div>
                          {accountAds.map(ad => (
                            <button
                              key={ad.id}
                              onClick={() => { setSelectedAdId(ad.id); setAdDropdownOpen(false); setAdSearchQuery(''); }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${
                                selectedAdId === ad.id ? 'text-primary font-semibold bg-primary/5' : 'text-foreground'
                              }`}
                            >
                              {ad.thumbnailUrl ? (
                                <img src={ad.thumbnailUrl} alt="" className="w-8 h-8 rounded object-cover border border-border flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                  <Image size={12} className="text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-xs font-medium">{ad.name}</div>
                                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <span className={ad.platform === 'instagram' ? 'text-pink-500' : 'text-blue-500'}>
                                    {ad.platform === 'instagram' ? <IgIcon size={8} /> : <FbIcon size={8} />}
                                  </span>
                                  <span className={`px-1 rounded text-[9px] ${
                                    ad.status === 'ACTIVE' ? 'bg-success/10 text-success'
                                    : ad.status === 'PAUSED' ? 'bg-warning/10 text-warning'
                                    : 'bg-muted text-muted-foreground'
                                  }`}>{ad.status}</span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ))}

                      {filteredAds.length === 0 && (
                        <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                          {adSearchQuery ? 'No ads match your search' : 'No ads with comments found'}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Count indicator */}
            {!loading && fetchEnabled && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {filtered.length} of {total} comments
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 rounded-lg border border-primary/20 mb-4 animate-fade-in">
          <span className="text-sm font-semibold text-primary"><CheckSquare size={14} className="inline mr-1" />{selectedIds.size} selected</span>
          <div className="w-px h-5 bg-border" />
          <button onClick={handleBulkDelete} disabled={bulkLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50">
            {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete Selected
          </button>
          <div className="flex-1" />
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}

      {/* Content */}
      {!fetchEnabled ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-16 text-center">
          <MessageCircle size={40} className="mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Comments Manager</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            View and manage comments from your Facebook & Instagram ads. Enable the toggle above to load comments.
          </p>
        </div>
      ) : loading ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-16 text-center">
          <Loader2 size={24} className="animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Fetching comments from Meta API...</p>
          <p className="text-xs text-muted-foreground mt-1">This may take a few seconds</p>
        </div>
      ) : error ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-8 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <button onClick={fetchComments} className="text-xs text-primary hover:underline">Try Again</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-12 text-center">
          <MessageCircle size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {comments.length === 0
              ? (selectedAdId !== 'all' ? 'No comments on this ad' : 'No comments found on your ads')
              : 'No comments match your filters'}
          </p>
          {selectedAdId !== 'all' && (
            <button onClick={() => setSelectedAdId('all')} className="text-xs text-primary hover:underline mt-2">
              Show all ads
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Selected ad header */}
          {selectedAdId !== 'all' && (
            <div className="flex items-center gap-3 py-2 px-4 bg-primary/5 rounded-lg border border-primary/20">
              {(() => {
                const ad = ads.find(a => a.id === selectedAdId);
                return ad ? (
                  <>
                    {ad.thumbnailUrl && (
                      <img src={ad.thumbnailUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-border" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ad.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ad.accountName} · {ad.platform} · {filtered.length} comments
                      </p>
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          )}

          {filtered.map(comment => (
            <div key={comment.id}
              className={`bg-card rounded-xl border shadow-card p-4 transition-all ${
                comment.isHidden ? 'border-warning/30 opacity-60' : comment.isSpam ? 'border-destructive/30' : 'border-border'
              }`}>
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  {/* Checkbox for bulk select */}
                  <input type="checkbox" checked={selectedIds.has(comment.id)}
                    onChange={() => toggleSelect(comment.id)}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer mt-1" />
                  {/* Ad thumbnail */}
                  {comment.thumbnailUrl && (
                    <img src={comment.thumbnailUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{comment.authorName}</span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        comment.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-blue-500/10 text-blue-500'
                      }`}>
                        {comment.platform === 'instagram' ? <IgIcon size={8} /> : <FbIcon size={8} />}
                        {comment.platform}
                      </span>
                      {comment.isHidden && (
                        <span className="text-[10px] text-warning font-medium">🙈 Hidden</span>
                      )}
                      {comment.isSpam && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/10 text-destructive">
                          <AlertTriangle size={8} /> SPAM
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      on <span className="font-medium">{comment.adName}</span>
                      {selectedAdId === 'all' && <span> · {comment.accountName}</span>}
                      {' · '}{timeAgo(comment.createdAt)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                {canPauseEnable && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText(''); }}
                      className="p-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title="Reply">
                      <Send size={12} />
                    </button>
                    <button onClick={() => handleAction(comment.id, comment.isHidden ? 'unhide' : 'hide', comment.postId, comment.platform)}
                      disabled={!!actionLoading[comment.id]}
                      className="p-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
                      title={comment.isHidden ? 'Unhide' : 'Hide'}>
                      {actionLoading[comment.id] === 'hide' || actionLoading[comment.id] === 'unhide'
                        ? <Loader2 size={12} className="animate-spin" />
                        : comment.isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button onClick={() => { if (confirm('Delete this comment?')) handleAction(comment.id, 'delete', comment.postId, comment.platform); }}
                      disabled={!!actionLoading[comment.id]}
                      className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50" title="Delete">
                      {actionLoading[comment.id] === 'delete'
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Trash2 size={12} />}
                    </button>
                    {/* Block Account — only if we have the user ID */}
                    {comment.authorId && (
                    <button onClick={() => { setBlockModal(comment); setBlockReason('Spam/Fake comment'); }}
                      className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors" title="Block Account">
                      <Ban size={12} />
                    </button>
                    )}
                  </div>
                )}
              </div>

              {/* Comment message */}
              <p className="text-sm text-foreground ml-[78px] mb-2">{comment.message}</p>

              {/* Spam Keywords */}
              {comment.matchedKeywords?.length > 0 && (
                <div className="flex flex-wrap gap-1 ml-[78px] mb-2">
                  {comment.matchedKeywords.slice(0, 5).map(kw => (
                    <span key={kw} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning">{kw}</span>
                  ))}
                  {comment.matchedKeywords.length > 5 && <span className="text-[10px] text-muted-foreground">+{comment.matchedKeywords.length - 5} more</span>}
                </div>
              )}

              {/* Attachment */}
              {comment.hasAttachment && comment.attachmentUrl && (
                <div className="ml-[78px] mb-2">
                  <img src={comment.attachmentUrl} alt="Attachment" className="max-w-[200px] rounded-lg border border-border" />
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4 ml-[78px] text-[10px] text-muted-foreground">
                {comment.likeCount > 0 && <span>❤️ {comment.likeCount}</span>}
                {comment.replyCount > 0 && <span>💬 {comment.replyCount} replies</span>}
              </div>

              {/* Reply input */}
              {replyingTo === comment.id && (
                <div className="flex items-center gap-2 ml-[78px] mt-3">
                  <input value={replyText} onChange={e => setReplyText(e.target.value)}
                    placeholder="Write a reply..."
                    onKeyDown={e => e.key === 'Enter' && handleReply(comment.id, comment.postId, comment.platform)}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    autoFocus />
                  <button onClick={() => handleReply(comment.id, comment.postId, comment.platform)} disabled={replyLoading || !replyText.trim()}
                    className="px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50">
                    {replyLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                  <button onClick={() => setReplyingTo(null)} className="p-2 rounded hover:bg-muted">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </>)}

      {/* Block Account Modal */}
      {blockModal && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setBlockModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-xl shadow-elevated border border-border w-full max-w-md animate-fade-in">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="font-semibold flex items-center gap-2"><Ban size={16} className="text-destructive" /> Block Account</h2>
                <button onClick={() => setBlockModal(null)} className="p-1 rounded hover:bg-muted"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
                  <p className="text-sm mb-1">Block <strong>{blockModal.authorName}</strong>?</p>
                  <p className="text-xs text-muted-foreground">This will hide all their comments and prevent them from commenting on your page.</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Their comment:</p>
                  <p className="text-sm">{blockModal.message}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5">Reason</label>
                  <select value={blockReason} onChange={e => setBlockReason(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option>Spam/Fake comment</option>
                    <option>Abusive language</option>
                    <option>Defamation</option>
                    <option>Competitor</option>
                    <option>Repeated offender</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
                <button onClick={() => setBlockModal(null)} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted">Cancel</button>
                <button onClick={() => handleBlock(blockModal)} disabled={!!actionLoading[`block_${blockModal.id}`]}
                  className="px-4 py-2 text-sm font-medium bg-destructive text-white rounded-lg hover:bg-destructive/90 disabled:opacity-50 flex items-center gap-2">
                  {actionLoading[`block_${blockModal.id}`] ? <><Loader2 size={14} className="animate-spin" /> Blocking...</> : <><Ban size={14} /> Block User</>}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
