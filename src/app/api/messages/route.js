import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

/**
 * Get ALL page tokens + IG accounts from DB.
 * ONE DB query — zero API calls.
 */
async function getAllPageTokens() {
  const supabase = getSupabaseServer();
  
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
  
  // Fallback: if no stored tokens, fetch from user token
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
 * ?action=conversations — List FB + IG conversations (default)
 * ?action=messages&conversationId=XXX&platform=facebook|instagram — Messages for a conversation
 * ?action=pages — List available pages with IG accounts
 * ?platform=all|facebook|instagram — Filter by platform
 * ?page=PAGEID — Filter by specific page
 * 
 * EFFICIENCY: 
 *   - Page tokens from DB (0 API calls)
 *   - FB conversations: 1 API call per page
 *   - IG conversations: 1 API call per IG account
 *   - Messages: 1 API call per conversation click
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'conversations';
  const pageFilter = searchParams.get('page');
  const platformFilter = searchParams.get('platform') || 'all';
  const conversationId = searchParams.get('conversationId');
  const convPlatform = searchParams.get('convPlatform') || 'facebook';
  const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);

  try {
    const pages = await getAllPageTokens();
    const pageList = Object.values(pages);
    
    if (!pageList.length) {
      return NextResponse.json({ 
        conversations: [], pages: [],
        error: 'No pages connected. Re-connect Meta and select all pages.' 
      });
    }

    // ── LIST PAGES (with debug info) ────────────────────────
    if (action === 'pages') {
      return NextResponse.json({
        pages: pageList.map(p => ({
          id: p.id, name: p.name,
          hasIg: !!p.igId, igId: p.igId,
        })),
      });
    }

    // ── GET MESSAGES FOR A CONVERSATION ─────────────────────
    if (action === 'messages' && conversationId) {
      let messages = [];
      let conversationInfo = null;

      // Try ALL pages until one works (works for both FB and IG)
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
            igId: page.igId,
            platform: convPlatform,
          };
          
          messages = (data.messages?.data || []).map(m => ({
            id: m.id,
            message: m.message || '',
            from: m.from,
            to: m.to?.data || [],
            createdAt: m.created_time,
            attachments: m.attachments?.data || [],
          }));
          
          break;
        } catch { continue; }
      }

      return NextResponse.json({ conversation: conversationInfo, messages });
    }

    // ── LIST CONVERSATIONS (FB + IG) ────────────────────────
    const allConversations = [];
    const igErrors = [];
    const targetPages = pageFilter 
      ? pageList.filter(p => p.id === pageFilter)
      : pageList;

    const fetchPromises = [];

    for (const page of targetPages) {
      // ── Facebook Messenger conversations ──
      if (platformFilter === 'all' || platformFilter === 'facebook') {
        fetchPromises.push(
          (async () => {
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
                const customer = (conv.participants?.data || []).find(p => p.id !== page.id);
                allConversations.push({
                  id: conv.id,
                  snippet: conv.snippet || '',
                  updatedTime: conv.updated_time,
                  messageCount: conv.message_count || 0,
                  unreadCount: conv.unread_count || 0,
                  customerName: customer?.name || 'Unknown',
                  customerId: customer?.id || null,
                  pageId: page.id,
                  pageName: page.name,
                  platform: 'facebook',
                });
              }
            } catch (e) {
              console.error(`[Messages] FB failed for ${page.name}:`, e.message);
            }
          })()
        );
      }

      // ── Instagram DM conversations ──
      // Strategy 1: Use PAGE-level endpoint with platform=instagram (most reliable)
      // Strategy 2: Use IG account endpoint as fallback
      // NO igId check — we try the page endpoint for ALL pages
      if (platformFilter === 'all' || platformFilter === 'instagram') {
        fetchPromises.push(
          (async () => {
            let igFound = false;

            // STRATEGY 1: Page-level conversations with platform=instagram
            // This works even without knowing the igId
            try {
              const res = await fetch(
                `${META_GRAPH_URL}/${page.id}/conversations?` +
                `fields=id,participants,updated_time,message_count,snippet,unread_count` +
                `&platform=instagram` +
                `&limit=${limit}` +
                `&access_token=${page.token}`
              );
              
              if (res.ok) {
                const data = await res.json();
                for (const conv of (data.data || [])) {
                  const participants = conv.participants?.data || [];
                  const customer = participants.find(p => p.id !== page.id && p.id !== page.igId) || participants[0];
                  
                  allConversations.push({
                    id: conv.id,
                    snippet: conv.snippet || '',
                    updatedTime: conv.updated_time,
                    messageCount: conv.message_count || 0,
                    unreadCount: conv.unread_count || 0,
                    customerName: customer?.username || customer?.name || 'IG User',
                    customerId: customer?.id || null,
                    pageId: page.id,
                    pageName: page.name,
                    igId: page.igId,
                    platform: 'instagram',
                  });
                  igFound = true;
                }
                if (data.data?.length > 0) igFound = true;
              } else {
                const err = await res.json().catch(() => ({}));
                console.error(`[Messages] IG via page ${page.name}:`, err.error?.message || res.status);
                igErrors.push(`${page.name}: ${err.error?.message || res.status}`);
              }
            } catch (e) {
              console.error(`[Messages] IG page-level for ${page.name}:`, e.message);
            }

            // STRATEGY 2: IG account direct endpoint (fallback)
            if (!igFound && page.igId) {
              try {
                const res = await fetch(
                  `${META_GRAPH_URL}/${page.igId}/conversations?` +
                  `fields=id,participants,updated_time,messages.limit(1){message,from,created_time}` +
                  `&limit=${limit}` +
                  `&access_token=${page.token}`
                );
                
                if (res.ok) {
                  const data = await res.json();
                  for (const conv of (data.data || [])) {
                    const participants = conv.participants?.data || [];
                    const customer = participants.find(p => p.id !== page.igId) || participants[0];
                    const lastMsg = conv.messages?.data?.[0];
                    
                    allConversations.push({
                      id: conv.id,
                      snippet: lastMsg?.message || '',
                      updatedTime: conv.updated_time || lastMsg?.created_time,
                      messageCount: 0,
                      unreadCount: 0,
                      customerName: customer?.username || customer?.name || 'IG User',
                      customerId: customer?.id || null,
                      pageId: page.id,
                      pageName: page.name,
                      igId: page.igId,
                      platform: 'instagram',
                    });
                  }
                } else {
                  const err = await res.json().catch(() => ({}));
                  console.error(`[Messages] IG direct for ${page.name}:`, err.error?.message || res.status);
                  if (!igErrors.find(e => e.startsWith(page.name))) {
                    igErrors.push(`${page.name}: ${err.error?.message || res.status}`);
                  }
                }
              } catch (e) {
                console.error(`[Messages] IG direct for ${page.name}:`, e.message);
              }
            }
          })()
        );
      }
    }

    await Promise.all(fetchPromises);
    allConversations.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));

    // Deduplicate conversations (same conv might appear from both strategies)
    const seen = new Set();
    const dedupedConversations = [];
    for (const conv of allConversations) {
      if (!seen.has(conv.id)) {
        seen.add(conv.id);
        dedupedConversations.push(conv);
      }
    }

    return NextResponse.json({
      conversations: dedupedConversations,
      pages: pageList.map(p => ({ id: p.id, name: p.name, hasIg: !!p.igId, igId: p.igId })),
      total: dedupedConversations.length,
      fbCount: dedupedConversations.filter(c => c.platform === 'facebook').length,
      igCount: dedupedConversations.filter(c => c.platform === 'instagram').length,
      // Debug info — helps diagnose issues
      _debug: {
        pagesChecked: targetPages.length,
        pagesWithIg: targetPages.filter(p => p.igId).length,
        igErrors: igErrors.length > 0 ? igErrors : undefined,
      },
    });

  } catch (e) {
    console.error('[Messages] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/messages — Send a reply (FB or IG)
 * 
 * { action: 'reply', pageId, recipientId, message, platform }
 * 
 * EFFICIENCY: 1 API call
 */
export async function POST(request) {
  const body = await request.json();
  const { action, pageId, recipientId, message, platform, igId } = body;

  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });

  try {
    const pages = await getAllPageTokens();

    if (action === 'reply') {
      if (!pageId || !recipientId || !message) {
        return NextResponse.json({ error: 'pageId, recipientId, and message required' }, { status: 400 });
      }

      const page = pages[pageId];
      if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

      if (platform === 'instagram') {
        // Instagram Send API
        const targetIgId = igId || page.igId;
        if (!targetIgId) return NextResponse.json({ error: 'Instagram account not found' }, { status: 404 });

        const res = await fetch(`${META_GRAPH_URL}/${targetIgId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message },
            access_token: page.token,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return NextResponse.json({ 
            error: err.error?.message || 'IG send failed',
            code: err.error?.code,
          }, { status: 400 });
        }

        const result = await res.json();
        return NextResponse.json({ success: true, messageId: result.message_id });

      } else {
        // Facebook Messenger Send API
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
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (e) {
    console.error('[Messages] POST error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
