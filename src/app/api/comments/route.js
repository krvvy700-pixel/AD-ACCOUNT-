import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

/**
 * Fetch Page Access Tokens + Instagram Business Account → Page mappings.
 * IG comments require the Page token of the FB Page connected to the IG Business Account.
 */
async function getPageTokens(userAccessToken) {
  const pageTokenMap = {}; // { pageId: { token, name } }
  const igToPageMap = {}; // { igBusinessAccountId: pageId }
  try {
    let url = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${userAccessToken}`;
    while (url) {
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      for (const page of (json.data || [])) {
        pageTokenMap[page.id] = { token: page.access_token, name: page.name };
        if (page.instagram_business_account?.id) {
          igToPageMap[page.instagram_business_account.id] = page.id;
        }
      }
      url = json.paging?.next || null;
    }
  } catch (err) {
    console.error('Failed to fetch page tokens:', err.message);
  }
  return { pageTokenMap, igToPageMap };
}

/**
 * Find the right token for Instagram API calls.
 * Uses instagram_actor_id → Page mapping, then falls back.
 */
function findIgToken(igActorId, pageTokenMap, igToPageMap, fallbackToken) {
  if (igActorId && igToPageMap[igActorId]) {
    const pageId = igToPageMap[igActorId];
    if (pageTokenMap[pageId]) return pageTokenMap[pageId].token;
  }
  for (const [, pageId] of Object.entries(igToPageMap)) {
    if (pageTokenMap[pageId]) return pageTokenMap[pageId].token;
  }
  const firstPage = Object.values(pageTokenMap)[0];
  return firstPage?.token || fallbackToken;
}

// ─── GET /api/comments ───
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account');
  const adFilter = searchParams.get('ad');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

  const supabase = getSupabaseServer();

  try {
    let accountQuery = supabase
      .from('meta_accounts')
      .select('id, meta_account_id, access_token, name')
      .eq('is_active', true);
    if (accountId && accountId !== 'all') {
      accountQuery = accountQuery.eq('id', accountId);
    }
    const { data: accounts } = await accountQuery;

    if (!accounts?.length) {
      return NextResponse.json({ comments: [], ads: [], total: 0, error: 'No active accounts' });
    }

    const allComments = [];
    const allAds = [];

    await Promise.all(accounts.map(async (account) => {
      try {
        // Step 1: Get Page tokens + IG mapping + Ads in parallel
        const [{ pageTokenMap, igToPageMap }, adsRes] = await Promise.all([
          getPageTokens(account.access_token),
          fetch(
            `${META_GRAPH_URL}/act_${account.meta_account_id}/ads?` +
            `fields=id,name,status,creative{effective_object_story_id,effective_instagram_media_id,instagram_actor_id,thumbnail_url}` +
            `&limit=200&access_token=${account.access_token}`
          ),
        ]);

        if (!adsRes.ok) {
          const errBody = await adsRes.json().catch(() => ({}));
          console.error(`[Comments] Ads fetch failed for ${account.name}:`, errBody.error?.message || adsRes.status);
          return;
        }

        // Paginate through ALL ads
        let adsData = [];
        let adsJson = await adsRes.json();
        if (adsJson.data) adsData.push(...adsJson.data);
        let nextUrl = adsJson.paging?.next;
        while (nextUrl) {
          const nextRes = await fetch(nextUrl);
          if (!nextRes.ok) break;
          const nextJson = await nextRes.json();
          if (nextJson.data) adsData.push(...nextJson.data);
          nextUrl = nextJson.paging?.next;
        }

        if (!adsData.length) return;

        // Build ads list — each ad gets one entry, detect platform from available IDs
        const processableAds = [];
        for (const ad of adsData) {
          const fbPostId = ad.creative?.effective_object_story_id || null;
          const igMediaId = ad.creative?.effective_instagram_media_id || null;
          const igActorId = ad.creative?.instagram_actor_id || null;
          if (!fbPostId && !igMediaId) continue;

          const platform = igMediaId ? (fbPostId ? 'both' : 'instagram') : 'facebook';
          processableAds.push({ ...ad, _fbPostId: fbPostId, _igMediaId: igMediaId, _igActorId: igActorId, _platform: platform });

          allAds.push({
            id: ad.id,
            name: ad.name,
            status: ad.status,
            postId: fbPostId || igMediaId,
            thumbnailUrl: ad.creative?.thumbnail_url || null,
            platform,
            accountName: account.name,
            accountId: account.id,
          });
        }

        // Apply ad filter
        let adsToFetch = processableAds;
        if (adFilter) {
          adsToFetch = processableAds.filter(ad => ad.id === adFilter);
          if (adsToFetch.length === 0) return;
        }
        if (!adFilter) adsToFetch = adsToFetch.slice(0, 50);

        // Step 2: Fetch comments in parallel batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < adsToFetch.length; i += BATCH_SIZE) {
          const batch = adsToFetch.slice(i, i + BATCH_SIZE);

          await Promise.all(batch.map(async (ad) => {
            // ─── Facebook comments ───
            if (ad._fbPostId) {
              try {
                const postId = ad._fbPostId;
                const pageId = postId.split('_')[0];
                const token = pageTokenMap[pageId]?.token || account.access_token;

                let commentsUrl = `${META_GRAPH_URL}/${postId}/comments?` +
                  `fields=id,message,from{name,id},created_time,like_count,comment_count,is_hidden,attachment` +
                  `&limit=${adFilter ? 100 : 25}&order=reverse_chronological` +
                  `&access_token=${token}`;

                while (commentsUrl) {
                  const commentsRes = await fetch(commentsUrl);
                  if (!commentsRes.ok) {
                    console.warn(`[FB Comments] Failed for post ${postId}`);
                    break;
                  }
                  const commentsJson = await commentsRes.json();
                  for (const c of (commentsJson.data || [])) {
                    allComments.push({
                      id: c.id,
                      message: c.message || '',
                      authorName: c.from?.name || 'Unknown',
                      authorId: c.from?.id || null,
                      createdAt: c.created_time,
                      likeCount: c.like_count || 0,
                      replyCount: c.comment_count || 0,
                      isHidden: c.is_hidden || false,
                      hasAttachment: !!c.attachment,
                      attachmentType: c.attachment?.type || null,
                      attachmentUrl: c.attachment?.media?.image?.src || c.attachment?.url || null,
                      adId: ad.id, adName: ad.name, adStatus: ad.status,
                      thumbnailUrl: ad.creative?.thumbnail_url || null,
                      postId,
                      accountName: account.name, accountId: account.id,
                      platform: 'facebook',
                    });
                  }
                  commentsUrl = adFilter ? (commentsJson.paging?.next || null) : null;
                }
              } catch (err) {
                console.error(`[FB Comments] Error for ad ${ad.name}:`, err.message);
              }
            }

            // ─── Instagram comments ───
            if (ad._igMediaId) {
              try {
                const mediaId = ad._igMediaId;
                const token = findIgToken(ad._igActorId, pageTokenMap, igToPageMap, account.access_token);

                let commentsUrl = `${META_GRAPH_URL}/${mediaId}/comments?` +
                  `fields=id,text,timestamp,from{id,username},like_count,hidden,replies{id}` +
                  `&limit=${adFilter ? 100 : 25}` +
                  `&access_token=${token}`;

                while (commentsUrl) {
                  const commentsRes = await fetch(commentsUrl);
                  if (!commentsRes.ok) {
                    const errBody = await commentsRes.json().catch(() => ({}));
                    console.warn(`[IG Comments] Failed for media ${mediaId}:`, errBody.error?.message || commentsRes.status);
                    break;
                  }
                  const commentsJson = await commentsRes.json();
                  for (const c of (commentsJson.data || [])) {
                    allComments.push({
                      id: c.id,
                      message: c.text || '',
                      authorName: c.from?.username || c.username || 'Unknown',
                      authorId: c.from?.id || null,
                      createdAt: c.timestamp,
                      likeCount: c.like_count || 0,
                      replyCount: c.replies?.data?.length || 0,
                      isHidden: c.hidden || false,
                      hasAttachment: false,
                      attachmentType: null,
                      attachmentUrl: null,
                      adId: ad.id, adName: ad.name, adStatus: ad.status,
                      thumbnailUrl: ad.creative?.thumbnail_url || null,
                      postId: mediaId,
                      accountName: account.name, accountId: account.id,
                      platform: 'instagram',
                    });
                  }
                  commentsUrl = adFilter ? (commentsJson.paging?.next || null) : null;
                }
              } catch (err) {
                console.error(`[IG Comments] Error for ad ${ad.name}:`, err.message);
              }
            }
          }));
        }

      } catch (err) {
        console.error(`[Comments] Error for account ${account.name}:`, err.message);
      }
    }));

    allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const uniqueAds = [];
    const seenAdIds = new Set();
    for (const ad of allAds) {
      if (!seenAdIds.has(ad.id)) {
        seenAdIds.add(ad.id);
        uniqueAds.push(ad);
      }
    }

    return NextResponse.json({
      comments: allComments.slice(0, limit),
      ads: uniqueAds,
      total: allComments.length,
    });

  } catch (err) {
    console.error('Comments API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST /api/comments — Reply, hide/unhide, delete ───
export async function POST(request) {
  const { commentId, action, message, postId, platform } = await request.json();

  if (!commentId || !action) {
    return NextResponse.json({ error: 'commentId and action required' }, { status: 400 });
  }

  const isIG = platform === 'instagram';
  const supabase = getSupabaseServer();

  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('access_token')
    .eq('is_active', true);

  if (!accounts?.length) {
    return NextResponse.json({ error: 'No active account' }, { status: 400 });
  }

  let lastError = null;

  for (const account of accounts) {
    try {
      const { pageTokenMap, igToPageMap } = await getPageTokens(account.access_token);

      let tokenToUse = account.access_token;
      if (isIG) {
        tokenToUse = findIgToken(null, pageTokenMap, igToPageMap, account.access_token);
      } else {
        const possiblePageId = (postId || commentId).split('_')[0];
        if (pageTokenMap[possiblePageId]) {
          tokenToUse = pageTokenMap[possiblePageId].token;
        } else {
          const pageTokens = Object.values(pageTokenMap).map(p => p.token);
          if (pageTokens.length > 0) tokenToUse = pageTokens[0];
        }
      }

      if (action === 'reply') {
        if (!message) return NextResponse.json({ error: 'Message required for reply' }, { status: 400 });
        // Instagram: /{id}/replies, Facebook: /{id}/comments
        const endpoint = isIG ? 'replies' : 'comments';
        const res = await fetch(`${META_GRAPH_URL}/${commentId}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: tokenToUse }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = err.error?.message || 'Failed to reply';
          continue;
        }
        return NextResponse.json({ success: true, action: 'reply' });
      }

      if (action === 'hide' || action === 'unhide') {
        // Instagram uses 'hide', Facebook uses 'is_hidden'
        const body = isIG
          ? { hide: action === 'hide', access_token: tokenToUse }
          : { is_hidden: action === 'hide', access_token: tokenToUse };

        const res = await fetch(`${META_GRAPH_URL}/${commentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = err.error?.message || `Failed to ${action}`;
          continue;
        }
        return NextResponse.json({ success: true, action });
      }

      if (action === 'delete') {
        const res = await fetch(`${META_GRAPH_URL}/${commentId}?access_token=${tokenToUse}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = err.error?.message || 'Failed to delete';
          continue;
        }
        return NextResponse.json({ success: true, action: 'delete' });
      }

      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return NextResponse.json({ error: lastError || 'All accounts failed' }, { status: 500 });
}
