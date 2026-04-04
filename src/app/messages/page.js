'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from '@/components/AppShell';
import {
  MessageSquare, Send, Search, RefreshCw, ChevronDown, User,
  Clock, Loader2, MessageCircle, X, Filter, Inbox,
} from 'lucide-react';

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // ── Fetch conversations ─────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ action: 'conversations', limit: '50' });
      if (pageFilter !== 'all') params.set('page', pageFilter);

      const res = await fetch(`/api/messages?${params}`);
      const data = await res.json();
      if (data.conversations) setConversations(data.conversations);
      if (data.pages) setPages(data.pages);
    } catch {}
    setLoading(false);
  }, [pageFilter]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Auto-refresh conversations every 30s
  useEffect(() => {
    const iv = setInterval(fetchConversations, 30000);
    return () => clearInterval(iv);
  }, [fetchConversations]);

  // ── Load messages for selected conversation ──────────────
  const loadMessages = useCallback(async (conv) => {
    setSelectedConv(conv);
    setMessagesLoading(true);
    setMessages([]);
    setConvInfo(null);

    try {
      const res = await fetch(`/api/messages?action=messages&conversationId=${conv.id}&limit=50`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages.reverse()); // Oldest first
      if (data.conversation) setConvInfo(data.conversation);
    } catch {}
    setMessagesLoading(false);

    // Focus input
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Scroll to bottom when messages load
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
        }),
      });

      if (res.ok) {
        // Add message locally for instant UI feedback
        setMessages(prev => [...prev, {
          id: `local-${Date.now()}`,
          message: replyText.trim(),
          from: { id: selectedConv.pageId, name: selectedConv.pageName },
          createdAt: new Date().toISOString(),
          attachments: [],
        }]);
        setReplyText('');
        inputRef.current?.focus();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to send message');
      }
    } catch {
      alert('Failed to send message');
    }
    setSending(false);
  };

  // ── Filter conversations ────────────────────────────────
  const filtered = conversations.filter(c => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return c.customerName.toLowerCase().includes(q) ||
             c.snippet.toLowerCase().includes(q) ||
             c.pageName.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <AppShell title="Messages">
      <div className="flex h-[calc(100vh-8rem)] bg-card rounded-xl border border-border shadow-card overflow-hidden">
        
        {/* ── LEFT: Conversations List ──────────────────── */}
        <div className={`w-full md:w-[360px] flex-shrink-0 border-r border-border flex flex-col bg-surface ${selectedConv ? 'hidden md:flex' : 'flex'}`}>
          
          {/* Header + Search */}
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Inbox size={16} />
                Conversations
                {conversations.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">({conversations.length})</span>
                )}
              </h2>
              <button
                onClick={fetchConversations}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>

            {/* Page filter */}
            {pages.length > 1 && (
              <select
                value={pageFilter}
                onChange={e => setPageFilter(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20"
              >
                <option value="all">All Pages</option>
                {pages.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Conversations */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading conversations...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <MessageSquare size={32} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? 'No conversations found' : 'No conversations yet'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Messages from your Facebook Pages will appear here
                </span>
              </div>
            ) : (
              filtered.map(conv => {
                const isActive = selectedConv?.id === conv.id;
                const hasUnread = conv.unreadCount > 0;
                
                return (
                  <button
                    key={conv.id}
                    onClick={() => loadMessages(conv)}
                    className={`w-full text-left px-4 py-3 border-b border-border-soft hover:bg-muted/50 transition-colors ${
                      isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                    } ${hasUnread ? 'bg-primary/3' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                        hasUnread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        {conv.customerName.charAt(0).toUpperCase()}
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
                          <span className="text-[10px] text-muted-foreground">{conv.pageName}</span>
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
            // Empty state
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MessageSquare size={28} />
              </div>
              <h3 className="text-base font-semibold text-foreground">Select a conversation</h3>
              <p className="text-sm text-center max-w-xs">
                Choose a conversation from the list to view messages and reply
              </p>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-3 border-b border-border bg-surface flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Back button (mobile) */}
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="md:hidden p-1 rounded hover:bg-muted"
                  >
                    <X size={18} />
                  </button>
                  
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    {selectedConv.customerName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{selectedConv.customerName}</h3>
                    <span className="text-[10px] text-muted-foreground">
                      via {selectedConv.pageName} · {selectedConv.messageCount} messages
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => loadMessages(selectedConv)}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                  title="Refresh messages"
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
                    <span className="text-sm">No messages in this conversation</span>
                  </div>
                ) : (
                  messages.map(msg => {
                    const isPage = msg.from?.id === selectedConv.pageId;
                    
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isPage ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          isPage
                            ? 'bg-primary text-primary-foreground rounded-br-md'
                            : 'bg-muted text-foreground rounded-bl-md'
                        }`}>
                          {/* Sender name */}
                          <div className={`text-[10px] font-medium mb-0.5 ${
                            isPage ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}>
                            {msg.from?.name || 'Unknown'}
                          </div>

                          {/* Message text */}
                          {msg.message && (
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                          )}

                          {/* Attachments */}
                          {msg.attachments?.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {msg.attachments.map((att, i) => (
                                <div key={i}>
                                  {att.mime_type?.startsWith('image/') || att.image_data ? (
                                    <img
                                      src={att.image_data?.url || att.file_url}
                                      alt="Attachment"
                                      className="max-w-full rounded-lg max-h-48 object-cover"
                                    />
                                  ) : att.mime_type?.startsWith('video/') || att.video_data ? (
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
                                      className={`text-xs underline ${isPage ? 'text-primary-foreground/80' : 'text-primary'}`}
                                    >
                                      📎 Attachment
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Time */}
                          <div className={`text-[9px] mt-1 ${
                            isPage ? 'text-primary-foreground/50' : 'text-muted-foreground'
                          }`}>
                            {formatTime(msg.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Input */}
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
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors max-h-32"
                  style={{ minHeight: '42px' }}
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0"
                >
                  {sending ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
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
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
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
