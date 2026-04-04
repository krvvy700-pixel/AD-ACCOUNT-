'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from '@/components/AppShell';
import {
  MessageSquare, Send, Search, RefreshCw, User,
  Loader2, MessageCircle, X, Inbox, Filter, ChevronDown,
} from 'lucide-react';

// Brand icons (lucide-react doesn't include brand icons)
const FbIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const IgIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

export default function MessagesPage() {
  const [conversations, setConversations] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [convInfo, setConvInfo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageFilter, setPageFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [fbCount, setFbCount] = useState(0);
  const [igCount, setIgCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Fetch conversations ─────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ action: 'conversations', limit: '50' });
      if (pageFilter !== 'all') params.set('page', pageFilter);
      if (platformFilter !== 'all') params.set('platform', platformFilter);

      const res = await fetch(`/api/messages?${params}`);
      const data = await res.json();
      if (data.conversations) setConversations(data.conversations);
      if (data.pages) setPages(data.pages);
      if (data.fbCount != null) setFbCount(data.fbCount);
      if (data.igCount != null) setIgCount(data.igCount);
    } catch {}
    setLoading(false);
  }, [pageFilter, platformFilter]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(fetchConversations, 30000);
    return () => clearInterval(iv);
  }, [fetchConversations]);

  // ── Load messages ────────────────────────────────────────
  const loadMessages = useCallback(async (conv) => {
    setSelectedConv(conv);
    setMessagesLoading(true);
    setMessages([]);
    setConvInfo(null);

    try {
      const params = new URLSearchParams({
        action: 'messages',
        conversationId: conv.id,
        convPlatform: conv.platform,
        limit: '50',
      });
      const res = await fetch(`/api/messages?${params}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages.reverse());
      if (data.conversation) setConvInfo(data.conversation);
    } catch {}
    setMessagesLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send reply ──────────────────────────────────────────
  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedConv || sending) return;

    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          pageId: selectedConv.pageId,
          recipientId: selectedConv.customerId,
          message: replyText.trim(),
          platform: selectedConv.platform,
          igId: selectedConv.igId,
        }),
      });

      if (res.ok) {
        const senderName = selectedConv.platform === 'instagram'
          ? selectedConv.pageName
          : selectedConv.pageName;
        const senderId = selectedConv.platform === 'instagram'
          ? selectedConv.igId
          : selectedConv.pageId;

        setMessages(prev => [...prev, {
          id: `local-${Date.now()}`,
          message: replyText.trim(),
          from: { id: senderId, name: senderName },
          createdAt: new Date().toISOString(),
          attachments: [],
        }]);
        setReplyText('');
        inputRef.current?.focus();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to send');
      }
    } catch {
      alert('Failed to send');
    }
    setSending(false);
  };

  // ── Filter conversations by search ──────────────────────
  const filtered = conversations.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.customerName.toLowerCase().includes(q) ||
           c.snippet.toLowerCase().includes(q) ||
           c.pageName.toLowerCase().includes(q);
  });

  const igPages = pages.filter(p => p.hasIg);

  return (
    <AppShell title="Messages">
      <div className="flex h-[calc(100vh-8rem)] bg-card rounded-xl border border-border shadow-card overflow-hidden">
        
        {/* ── LEFT: Conversations List ──────────────────── */}
        <div className={`w-full md:w-[380px] flex-shrink-0 border-r border-border flex flex-col bg-surface ${selectedConv ? 'hidden md:flex' : 'flex'}`}>
          
          {/* Header */}
          <div className="px-4 py-3 border-b border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Inbox size={16} />
                Messages
              </h2>
              <div className="flex items-center gap-1.5">
                {fbCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-medium flex items-center gap-1">
                    <FbIcon size={10} /> {fbCount}
                  </span>
                )}
                {igCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 text-purple-600 font-medium flex items-center gap-1">
                    <IgIcon size={10} /> {igCount}
                  </span>
                )}
                <button
                  onClick={fetchConversations}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>

            {/* Filters row */}
            <div className="flex gap-2">
              {/* Platform filter */}
              <div className="flex bg-muted rounded-lg p-0.5 flex-1">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'facebook', label: 'FB', icon: FbIcon },
                  { value: 'instagram', label: 'IG', icon: IgIcon },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setPlatformFilter(value)}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all ${
                      platformFilter === value
                        ? 'bg-surface text-foreground shadow-card'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {Icon && <Icon size={11} />}
                    {label}
                  </button>
                ))}
              </div>

              {/* Page filter */}
              <select
                value={pageFilter}
                onChange={e => setPageFilter(e.target.value)}
                className="px-2 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20 max-w-[140px]"
              >
                <option value="all">All Pages</option>
                {pages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.hasIg ? '(+IG)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conversations */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading conversations...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <MessageSquare size={32} className="text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {searchQuery ? 'No conversations found' : 'No conversations yet'}
                </span>
                <span className="text-xs text-muted-foreground text-center px-6">
                  {platformFilter === 'instagram'
                    ? 'Instagram DMs from your connected IG accounts will appear here'
                    : 'Messages from your Facebook Pages will appear here'}
                </span>
              </div>
            ) : (
              filtered.map(conv => {
                const isActive = selectedConv?.id === conv.id;
                const hasUnread = conv.unreadCount > 0;
                const isIG = conv.platform === 'instagram';
                
                return (
                  <button
                    key={conv.id}
                    onClick={() => loadMessages(conv)}
                    className={`w-full text-left px-4 py-3 border-b border-border-soft hover:bg-muted/50 transition-colors ${
                      isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="relative">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          hasUnread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {conv.customerName.charAt(0).toUpperCase()}
                        </div>
                        {/* Platform badge */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-surface ${
                          isIG ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-blue-500'
                        }`}>
                          {isIG ? <IgIcon size={8} className="text-white" /> : <FbIcon size={8} className="text-white" />}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${hasUnread ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
                            {conv.customerName}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {timeAgo(conv.updatedTime)}
                          </span>
                        </div>
                        <p className={`text-xs truncate mt-0.5 ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {conv.snippet || 'No messages'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground truncate">{conv.pageName}</span>
                          <span className={`text-[9px] px-1 rounded font-medium ${
                            isIG ? 'text-purple-500' : 'text-blue-500'
                          }`}>
                            {isIG ? 'IG' : 'FB'}
                          </span>
                          {hasUnread && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-bold">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT: Message Thread ─────────────────────── */}
        <div className={`flex-1 flex flex-col ${!selectedConv ? 'hidden md:flex' : 'flex'}`}>
          {!selectedConv ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MessageSquare size={28} />
              </div>
              <h3 className="text-base font-semibold text-foreground">Select a conversation</h3>
              <p className="text-sm text-center max-w-xs">
                Choose from Facebook Messenger or Instagram DMs to view and reply
              </p>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-3 border-b border-border bg-surface flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="md:hidden p-1 rounded hover:bg-muted"
                  >
                    <X size={18} />
                  </button>
                  
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {selectedConv.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-surface ${
                      selectedConv.platform === 'instagram' ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-blue-500'
                    }`}>
                      {selectedConv.platform === 'instagram'
                        ? <IgIcon size={8} className="text-white" />
                        : <FbIcon size={8} className="text-white" />
                      }
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{selectedConv.customerName}</h3>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className={`px-1 rounded font-bold ${
                        selectedConv.platform === 'instagram' ? 'text-purple-500' : 'text-blue-500'
                      }`}>
                        {selectedConv.platform === 'instagram' ? 'Instagram' : 'Messenger'}
                      </span>
                      · {selectedConv.pageName}
                      {selectedConv.messageCount > 0 && ` · ${selectedConv.messageCount} msgs`}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => loadMessages(selectedConv)}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <RefreshCw size={14} className={messagesLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-background">
                {messagesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={20} className="animate-spin text-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                    <MessageCircle size={24} />
                    <span className="text-sm">No messages</span>
                  </div>
                ) : (
                  messages.map(msg => {
                    const ownId = selectedConv.platform === 'instagram'
                      ? selectedConv.igId
                      : selectedConv.pageId;
                    const isPage = msg.from?.id === ownId || msg.from?.id === selectedConv.pageId;
                    
                    return (
                      <div key={msg.id} className={`flex ${isPage ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          isPage
                            ? selectedConv.platform === 'instagram'
                              ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-br-md'
                              : 'bg-primary text-primary-foreground rounded-br-md'
                            : 'bg-muted text-foreground rounded-bl-md'
                        }`}>
                          <div className={`text-[10px] font-medium mb-0.5 ${
                            isPage ? 'opacity-70' : 'text-muted-foreground'
                          }`}>
                            {msg.from?.name || msg.from?.username || 'Unknown'}
                          </div>

                          {msg.message && (
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                          )}

                          {msg.attachments?.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {msg.attachments.map((att, i) => (
                                <div key={i}>
                                  {(att.mime_type?.startsWith('image/') || att.image_data) ? (
                                    <img
                                      src={att.image_data?.url || att.file_url}
                                      alt=""
                                      className="max-w-full rounded-lg max-h-48 object-cover"
                                    />
                                  ) : (att.mime_type?.startsWith('video/') || att.video_data) ? (
                                    <video
                                      src={att.video_data?.url || att.file_url}
                                      controls
                                      className="max-w-full rounded-lg max-h-48"
                                    />
                                  ) : (
                                    <a
                                      href={att.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`text-xs underline ${isPage ? 'opacity-80' : 'text-primary'}`}
                                    >
                                      📎 Attachment
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className={`text-[9px] mt-1 ${isPage ? 'opacity-50' : 'text-muted-foreground'}`}>
                            {formatTime(msg.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply */}
              <form onSubmit={handleSendReply} className="px-4 py-3 border-t border-border bg-surface flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply(e);
                    }
                  }}
                  placeholder={`Reply via ${selectedConv.platform === 'instagram' ? 'Instagram' : 'Messenger'}...`}
                  rows={1}
                  className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors max-h-32"
                  style={{ minHeight: '42px' }}
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className={`p-2.5 rounded-xl text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0 ${
                    selectedConv.platform === 'instagram'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                      : 'bg-primary'
                  }`}
                >
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
