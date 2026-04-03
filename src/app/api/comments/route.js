import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

/**
 * Fetch all Page Access Tokens that the user manages.
 * Comments on Page posts require a Page token, NOT the user token.
 */
async function getPageTokens(userAccessToken) {
  const pageTokenMap = {}; // { pageId: { token, name } }
  try {
    let url = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userAccessToken}`;
    while (url) {
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      for (const page of (json.data || [])) {
        pageTokenMap[page.id] = { token: page.access_token, name: page.name };
      }
      url = json.paging?.next || null;
    }
  } catch (err) {
    console.error('Failed to fetch page tokens:', err.message);
  }
  return pageTokenMap;
}

// GET /api/comments?account=&ad=&limit=100
// Fetches ad comments from Meta API — live, not cached
// Returns: { comments[], ads[] (for filter dropdown), total }
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account');
  const adFilter = searchParams.get('ad'); // Filter to specific ad external ID
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

  const supabase = getSupabaseServer();

  try {
    // Get accounts
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
    const allAds = []; // For the filter dropdown

    // Process all accounts in parallel
    await Promise.all(accounts.map(async (account) => {
      try {
        // Step 1: Get Page Access Tokens + ads with post IDs — in parallel
        const [pageTokenMap, adsRes] = await Promise.all([
          getPageTokens(account.access_token),
          fetch(
            `${META_GRAPH_URL}/act_${account.meta_account_id}/ads?` +
            `fields=id,name,status,creative{effective_object_story_id,thumbnail_url}` +
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

        // Build ads list for filter dropdown
        const adsWithPosts = adsData.filter(ad => ad.creative?.effective_object_story_id);

        for (const ad of adsWithPosts) {
          const postId = ad.creative.effective_object_story_id;
          const platform = postId.includes('_') ? 'facebook' : 'instagram';
          allAds.push({
            id: ad.id,
            name: ad.name,
            status: ad.status,
            postId,
            thumbnailUrl: ad.creative?.thumbnail_url || null,
            platform,
            accountName: account.name,
            accountId: account.id,
          });
        }

        // Step 2: If filtering to specific ad, only get comments for that ad
        let adsToFetch = adsWithPosts;
        if (adFilter) {
          adsToFetch = adsWithPosts.filter(ad => ad.id === adFilter);
          if (adsToFetch.length === 0) return; // This account doesn't have that ad
        }

        // Limit to 50 ads to respect rate limits (unless filtering to 1)
        if (!adFilter) adsToFetch = adsToFetch.slice(0, 50);

        // Step 3: Fetch comments in parallel batches of 10
        const BATCH_SIZE = 10;
        for (let i = 0; i < adsToFetch.length; i += BATCH_SIZE) {
          const batch = adsToFetch.slice(i, i + BATCH_SIZE);

          await Promise.all(batch.map(async (ad) => {
            try {
              const postId = ad.creative.effective_object_story_id;
              const pageId = postId.split('_')[0];
              const tokenForComments = pageTokenMap[pageId]?.token || account.access_token;
              const platform = postId.includes('_') ? 'facebook' : 'instagram';

              // Fetch comments with full pagination for single-ad filter
              let commentsUrl = `${META_GRAPH_URL}/${postId}/comments?` +
                `fields=id,message,from{name,id},created_time,like_count,comment_count,is_hidden,attachment` +
                `&limit=${adFilter ? 100 : 25}&order=reverse_chronological` +
                `&access_token=${tokenForComments}`;

              while (commentsUrl) {
                const commentsRes = await fetch(commentsUrl);
                if (!commentsRes.ok) {
                  const errBody = await commentsRes.json().catch(() => ({}));
                  console.warn(`[Comments] Comment fetch failed for post ${postId}:`, errBody.error?.message || commentsRes.status);
                  break;
                }

                const commentsJson = await commentsRes.json();
                const comments = commentsJson.data || [];

                for (const c of comments) {
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
                    adId: ad.id,
                    adName: ad.name,
                    adStatus: ad.status,
                    thumbnailUrl: ad.creative?.thumbnail_url || null,
                    postId,
                    accountName: account.name,
                    accountId: account.id,
                    platform,
                  });
                }

                // Only paginate if filtering to a single ad (get all comments for that ad)
                commentsUrl = adFilter ? (commentsJson.paging?.next || null) : null;
              }
            } catch (err) {
              console.error(`[Comments] Error processing ad ${ad.name}:`, err.message);
            }
          }));
        }

      } catch (err) {
        console.error(`[Comments] Error for account ${account.name}:`, err.message);
      }
    }));

    // Sort by newest first
    allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Deduplicate ads list by ad ID
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

// POST /api/comments — Reply, hide/unhide, delete
export async function POST(request) {
  const { commentId, action, message, postId } = await request.json();

  if (!commentId || !action) {
    return NextResponse.json({ error: 'commentId and action required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // We need a Page Access Token to reply/moderate comments on page posts
  // The commentId format is "pageId_commentId" or just an ID
  // We need to find which page this belongs to and get its token

  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('access_token')
    .eq('is_active', true);

  if (!accounts?.length) {
    return NextResponse.json({ error: 'No active account' }, { status: 400 });
  }

  // Try each account until we find one that works
  let lastError = null;

  for (const account of accounts) {
    try {
      // Get page tokens for this account
      const pageTokenMap = await getPageTokens(account.access_token);

      // Try to determine the page ID from the comment ID or post ID
      let tokenToUse = account.access_token;
      const possiblePageId = (postId || commentId).split('_')[0];
      if (pageTokenMap[possiblePageId]) {
        tokenToUse = pageTokenMap[possiblePageId].token;
      } else {
        // Try all page tokens
        const pageTokens = Object.values(pageTokenMap).map(p => p.token);
        if (pageTokens.length > 0) {
          tokenToUse = pageTokens[0]; // Use first available page token
        }
      }

      if (action === 'reply') {
        if (!message) return NextResponse.json({ error: 'Message required for reply' }, { status: 400 });

        const res = await fetch(`${META_GRAPH_URL}/${commentId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: tokenToUse }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = err.error?.message || 'Failed to reply';
          continue; // Try next account
        }

        return NextResponse.json({ success: true, action: 'reply' });
      }

      if (action === 'hide' || action === 'unhide') {
        const res = await fetch(`${META_GRAPH_URL}/${commentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_hidden: action === 'hide', access_token: tokenToUse }),
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
      continue; // Try next account
    }
  }

  return NextResponse.json({ error: lastError || 'All accounts failed' }, { status: 500 });
}
