'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/AppShell';
import { useAccount } from '@/context/AccountContext';
import { useAuth } from '@/context/AuthContext';
import {
  MessageCircle, Loader2, Send, Eye, EyeOff, Trash2, RefreshCw,
  X, Power, PowerOff, Search, Filter, Globe,
} from 'lucide-react';

const FbIcon = ({ size = 12 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
const IgIcon = ({ size = 12 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>;

export default function CommentsPage() {
  const { selectedAccountId } = useAccount();
  const { canPauseEnable } = useAuth();

  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  // Action loading
  const [actionLoading, setActionLoading] = useState({});

  const fetchComments = useCallback(async () => {
    if (!fetchEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const acctParam = selectedAccountId && selectedAccountId !== 'all' ? `&account=${selectedAccountId}` : '';
      const res = await fetch(`/api/comments?limit=100${acctParam}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const data = await res.json();
      setComments(data.comments || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
      setComments([]);
    }
    setLoading(false);
  }, [fetchEnabled, selectedAccountId]);

  useEffect(() => {
    if (fetchEnabled) fetchComments();
    else { setComments([]); setTotal(0); }
  }, [fetchComments, fetchEnabled]);

  // Filter comments
  const filtered = comments.filter(c => {
    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
    if (!searchQuery) return true;
    return c.message?.toLowerCase().includes(searchQuery.toLowerCase())
      || c.authorName?.toLowerCase().includes(searchQuery.toLowerCase())
      || c.adName?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Handle reply
  const handleReply = async (commentId) => {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, action: 'reply', message: replyText }),
      });
      if (res.ok) {
        setReplyingTo(null);
        setReplyText('');
        fetchComments(); // Refresh to show new reply count
      }
    } catch {}
    setReplyLoading(false);
  };

  // Handle hide/delete
  const handleAction = async (commentId, action) => {
    setActionLoading(l => ({ ...l, [commentId]: action }));
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, action }),
      });
      if (res.ok) {
        if (action === 'delete') {
          setComments(prev => prev.filter(c => c.id !== commentId));
        } else {
          setComments(prev => prev.map(c =>
            c.id === commentId ? { ...c, isHidden: action === 'hide' } : c
          ));
        }
      }
    } catch {}
    setActionLoading(l => ({ ...l, [commentId]: null }));
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <AppShell title="Comments">
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
                ? `${total} comments fetched from your ad accounts`
                : 'Enable to fetch comments from your ads — uses Meta API'}
            </p>
          </div>
        </div>
        <button onClick={() => setFetchEnabled(v => !v)}
          className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${fetchEnabled ? 'bg-success' : 'bg-muted'}`}>
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${fetchEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Controls */}
      {fetchEnabled && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
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
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-card p-12 text-center">
          <MessageCircle size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            {comments.length === 0 ? 'No comments found on your ads' : 'No comments match your search'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{filtered.length} comments</p>

          {filtered.map(comment => (
            <div key={comment.id}
              className={`bg-card rounded-xl border shadow-card p-4 transition-all ${
                comment.isHidden ? 'border-warning/30 opacity-60' : 'border-border'
              }`}>
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  {/* Ad thumbnail */}
                  {comment.thumbnailUrl && (
                    <img src={comment.thumbnailUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
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
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      on <span className="font-medium">{comment.adName}</span> · {timeAgo(comment.createdAt)}
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
                    <button onClick={() => handleAction(comment.id, comment.isHidden ? 'unhide' : 'hide')}
                      disabled={!!actionLoading[comment.id]}
                      className="p-1.5 rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
                      title={comment.isHidden ? 'Unhide' : 'Hide'}>
                      {actionLoading[comment.id] === 'hide' || actionLoading[comment.id] === 'unhide'
                        ? <Loader2 size={12} className="animate-spin" />
                        : comment.isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button onClick={() => { if (confirm('Delete this comment?')) handleAction(comment.id, 'delete'); }}
                      disabled={!!actionLoading[comment.id]}
                      className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50" title="Delete">
                      {actionLoading[comment.id] === 'delete'
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Trash2 size={12} />}
                    </button>
                  </div>
                )}
              </div>

              {/* Comment message */}
              <p className="text-sm text-foreground ml-[52px] mb-2">{comment.message}</p>

              {/* Stats */}
              <div className="flex items-center gap-4 ml-[52px] text-[10px] text-muted-foreground">
                {comment.likeCount > 0 && <span>❤️ {comment.likeCount}</span>}
                {comment.replyCount > 0 && <span>💬 {comment.replyCount} replies</span>}
              </div>

              {/* Reply input */}
              {replyingTo === comment.id && (
                <div className="flex items-center gap-2 ml-[52px] mt-3">
                  <input value={replyText} onChange={e => setReplyText(e.target.value)}
                    placeholder="Write a reply..."
                    onKeyDown={e => e.key === 'Enter' && handleReply(comment.id)}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <button onClick={() => handleReply(comment.id)} disabled={replyLoading || !replyText.trim()}
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
    </AppShell>
  );
}
