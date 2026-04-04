import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { exchangeCodeForToken, fetchAdAccounts } from '@/lib/meta-api';

const META_GRAPH_URL = 'https://graph.facebook.com/v22.0';

/**
 * Fetch ALL page tokens the user has access to.
 * These are needed for comment moderation (delete, reply, hide).
 */
async function fetchAllPageTokens(userAccessToken) {
  const pages = [];
  let url = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${userAccessToken}`;
  
  while (url) {
    const res = await fetch(url);
    if (!res.ok) break;
    const json = await res.json();
    for (const p of (json.data || [])) {
      pages.push({
        page_id: p.id,
        page_name: p.name,
        page_access_token: p.access_token,
        instagram_account_id: p.instagram_business_account?.id || null,
      });
    }
    url = json.paging?.next || null;
  }
  
  return pages;
}

// Meta OAuth callback — exchanges code for token, saves accounts + page tokens
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=no_code`
    );
  }

  try {
    // 1. Exchange code for long-lived token (server-side, secret used)
    const { accessToken, expiresIn } = await exchangeCodeForToken(code);

    // 2. Fetch all ad accounts + all page tokens in parallel
    const [accounts, pageTokens] = await Promise.all([
      fetchAdAccounts(accessToken),
      fetchAllPageTokens(accessToken),
    ]);

    // 3. Store in database
    const supabase = getSupabaseServer();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Save ad accounts
    for (const acct of accounts) {
      await supabase.from('meta_accounts').upsert({
        meta_account_id: acct.metaAccountId,
        name: acct.name,
        currency: acct.currency,
        timezone: acct.timezone,
        status: acct.isActive ? 'active' : 'inactive',
        is_active: true,
        access_token: accessToken,
        token_expires_at: expiresAt,
      }, { onConflict: 'meta_account_id' });
    }

    // Save page tokens — critical for comment moderation across ALL pages
    for (const page of pageTokens) {
      await supabase.from('page_tokens').upsert({
        page_id: page.page_id,
        page_name: page.page_name,
        page_access_token: page.page_access_token,
        instagram_account_id: page.instagram_account_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'page_id' });
    }

    console.log(`[OAuth] Connected: ${accounts.length} ad accounts, ${pageTokens.length} pages`);

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?connected=true&accounts=${accounts.length}&pages=${pageTokens.length}`
    );
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(err.message)}`
    );
  }
}

