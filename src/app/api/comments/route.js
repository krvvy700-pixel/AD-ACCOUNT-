import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

// GET /api/comments?account=&from=&to=&limit=50
// Fetches ad comments from Meta API — live, not cached
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

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
      return NextResponse.json({ comments: [], error: 'No active accounts' });
    }

    const allComments = [];

    // Process all accounts in parallel
    await Promise.all(accounts.map(async (account) => {
      try {
        // Step 1: Get ads with their post IDs (1 API call)
        const adsRes = await fetch(
          `${META_GRAPH_URL}/act_${account.meta_account_id}/ads?` +
          `fields=id,name,status,creative{effective_object_story_id,thumbnail_url}&limit=100` +
          `&access_token=${account.access_token}`
        );

        if (!adsRes.ok) return;
        const { data: ads } = await adsRes.json();
        if (!ads?.length) return;

        // Step 2: For ads with post IDs, fetch comments in parallel (batched)
        const adsWithPosts = ads
          .filter(ad => ad.creative?.effective_object_story_id)
          .slice(0, 30); // Limit to 30 ads to respect rate limits

        await Promise.all(adsWithPosts.map(async (ad) => {
          try {
            const postId = ad.creative.effective_object_story_id;
            const commentsRes = await fetch(
              `${META_GRAPH_URL}/${postId}/comments?` +
              `fields=id,message,from{name,id},created_time,like_count,comment_count,is_hidden` +
              `&limit=25&order=reverse_chronological` +
              `&access_token=${account.access_token}`
            );

            if (!commentsRes.ok) return;
            const { data: comments } = await commentsRes.json();
            if (!comments?.length) return;

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
                adId: ad.id,
                adName: ad.name,
                adStatus: ad.status,
                thumbnailUrl: ad.creative?.thumbnail_url || null,
                postId,
                accountName: account.name,
                platform: postId.includes('_') ? 'facebook' : 'instagram',
              });
            }
          } catch {}
        }));

      } catch (err) {
        console.error(`Comments fetch error for ${account.name}:`, err.message);
      }
    }));

    // Sort by newest first
    allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return NextResponse.json({
      comments: allComments.slice(0, limit),
      total: allComments.length,
    });

  } catch (err) {
    console.error('Comments API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/comments — Reply to a comment or hide/unhide
export async function POST(request) {
  const { commentId, action, message, accountId } = await request.json();

  if (!commentId || !action) {
    return NextResponse.json({ error: 'commentId and action required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Get access token
  let tokenQuery = supabase.from('meta_accounts').select('access_token').eq('is_active', true);
  if (accountId) tokenQuery = tokenQuery.eq('id', accountId);
  const { data: accounts } = await tokenQuery.limit(1);

  if (!accounts?.length) {
    return NextResponse.json({ error: 'No active account' }, { status: 400 });
  }

  const token = accounts[0].access_token;

  try {
    if (action === 'reply') {
      if (!message) return NextResponse.json({ error: 'Message required for reply' }, { status: 400 });

      const res = await fetch(`${META_GRAPH_URL}/${commentId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          access_token: token,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to reply');
      }

      return NextResponse.json({ success: true, action: 'reply' });
    }

    if (action === 'hide' || action === 'unhide') {
      const res = await fetch(`${META_GRAPH_URL}/${commentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_hidden: action === 'hide',
          access_token: token,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Failed to ${action}`);
      }

      return NextResponse.json({ success: true, action });
    }

    if (action === 'delete') {
      const res = await fetch(`${META_GRAPH_URL}/${commentId}?access_token=${token}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to delete');
      }

      return NextResponse.json({ success: true, action: 'delete' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('Comment action error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
