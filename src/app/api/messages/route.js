import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

/**
 * Get page tokens — from DB first, then live as fallback.
 * ONE DB query instead of N API calls.
 */
async function getAllPageTokens() {
  const supabase = getSupabaseServer();
  
  // 1. Get stored page tokens (fastest)
  const { data: storedPages } = await supabase
    .from('page_tokens')
    .select('page_id, page_name, page_access_token, instagram_account_id');
  
  const pages = {};
  for (const p of (storedPages || [])) {
    pages[p.page_id] = {
      id: p.page_id,
      name: p.page_name,
      token: p.page_access_token,
      igId: p.instagram_account_id,
    };
  }
  
  // 2. If no stored tokens, fallback to user token
  if (Object.keys(pages).length === 0) {
    const { data: accounts } = await supabase
      .from('meta_accounts')
      .select('access_token')
      .eq('is_active', true)
      .limit(1);
    
    if (accounts?.[0]?.access_token) {
      const token = accounts[0].access_token;
      let url = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${token}`;
      while (url) {
        const res = await fetch(url);
        if (!res.ok) break;
        const json = await res.json();
        for (const p of (json.data || [])) {
          pages[p.id] = {
            id: p.id,
            name: p.name,
            token: p.access_token,
            igId: p.instagram_business_account?.id || null,
          };
        }
        url = json.paging?.next || null;
      }
    }
  }
  
  return pages;
}

/**
 * GET /api/messages
 * 
 * ?action=conversations — List conversations across all pages (default)
 * ?action=messages&conversationId=XXX — Get messages for a conversation
 * ?action=pages — List available pages
 * 
 * EFFICIENCY: 
 *   - Page tokens from DB (0 API calls)
 *   - Conversations: 1 API call per page (with limit)
 *   - Messages: 1 API call per conversation
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'conversations';
  const pageFilter = searchParams.get('page');
  const conversationId = searchParams.get('conversationId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);

  try {
    const pages = await getAllPageTokens();
    const pageList = Object.values(pages);
    
    if (!pageList.length) {
      return NextResponse.json({ 
        conversations: [], pages: [], messages: [],
        error: 'No pages connected. Re-connect Meta account and select all pages.' 
      });
    }

    // ── LIST PAGES ──────────────────────────────────────────
    if (action === 'pages') {
      return NextResponse.json({
        pages: pageList.map(p => ({ id: p.id, name: p.name, hasIg: !!p.igId })),
      });
    }

    // ── GET MESSAGES FOR A CONVERSATION ─────────────────────
    if (action === 'messages' && conversationId) {
      // Find which page owns this conversation by trying each
      let messages = [];
      let conversationInfo = null;

      for (const page of pageList) {
        try {
          const res = await fetch(
            `${META_GRAPH_URL}/${conversationId}?` +
            `fields=id,participants,updated_time,messages.limit(${limit}){id,message,from,to,created_time,attachments}` +
            `&access_token=${page.token}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          
          conversationInfo = {
            id: data.id,
            participants: data.participants?.data || [],
            updatedTime: data.updated_time,
            pageId: page.id,
            pageName: page.name,
          };
          
          messages = (data.messages?.data || []).map(m => ({
            id: m.id,
            message: m.message || '',
            from: m.from,
            to: m.to?.data || [],
            createdAt: m.created_time,
            attachments: m.attachments?.data || [],
          }));
          
          break; // Found the right page
        } catch { continue; }
      }

      return NextResponse.json({ conversation: conversationInfo, messages });
    }

    // ── LIST CONVERSATIONS ──────────────────────────────────
    // Efficient: 1 API call per page, conversations include snippet
    const allConversations = [];
    const targetPages = pageFilter 
      ? pageList.filter(p => p.id === pageFilter)
      : pageList;

    await Promise.all(targetPages.map(async (page) => {
      try {
        const res = await fetch(
          `${META_GRAPH_URL}/${page.id}/conversations?` +
          `fields=id,participants,updated_time,message_count,snippet,unread_count` +
          `&limit=${limit}` +
          `&access_token=${page.token}`
        );
        if (!res.ok) return;
        const data = await res.json();
        
        for (const conv of (data.data || [])) {
          // Find the customer (not the page itself)
          const customer = (conv.participants?.data || []).find(p => p.id !== page.id);
          
          allConversations.push({
            id: conv.id,
            snippet: conv.snippet || '',
            updatedTime: conv.updated_time,
            messageCount: conv.message_count || 0,
            unreadCount: conv.unread_count || 0,
            customerName: customer?.name || 'Unknown',
            customerId: customer?.id || null,
            customerEmail: customer?.email || null,
            pageId: page.id,
            pageName: page.name,
          });
        }
      } catch (e) {
        console.error(`[Messages] Failed for page ${page.name}:`, e.message);
      }
    }));

    // Sort by most recent
    allConversations.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));

    return NextResponse.json({
      conversations: allConversations,
      pages: pageList.map(p => ({ id: p.id, name: p.name })),
      total: allConversations.length,
    });

  } catch (e) {
    console.error('[Messages] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/messages
 * 
 * Actions:
 *   { action: 'reply', pageId, recipientId, message } — Send a message
 *   { action: 'mark_read', pageId, conversationId } — Mark as read (no-op, noted)
 * 
 * EFFICIENCY: 1 API call per action
 */
export async function POST(request) {
  const body = await request.json();
  const { action, pageId, recipientId, message, conversationId } = body;

  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  try {
    const pages = await getAllPageTokens();

    // ── SEND MESSAGE ────────────────────────────────────────
    if (action === 'reply') {
      if (!pageId || !recipientId || !message) {
        return NextResponse.json({ error: 'pageId, recipientId, and message required' }, { status: 400 });
      }

      const page = pages[pageId];
      if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

      // Facebook Send API — 1 call
      const res = await fetch(`${META_GRAPH_URL}/${pageId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
          messaging_type: 'RESPONSE',
          access_token: page.token,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json({ 
          error: err.error?.message || 'Send failed',
          code: err.error?.code,
        }, { status: 400 });
      }

      const result = await res.json();
      return NextResponse.json({ success: true, messageId: result.message_id });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (e) {
    console.error('[Messages] POST error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
