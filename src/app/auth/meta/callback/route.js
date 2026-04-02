import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { exchangeCodeForToken, fetchAdAccounts } from '@/lib/meta-api';

// Meta OAuth callback — exchanges code for token, saves accounts
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

    // 2. Fetch all ad accounts user has access to
    const accounts = await fetchAdAccounts(accessToken);

    // 3. Store in database
    const supabase = getSupabaseServer();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

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

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?connected=true&accounts=${accounts.length}`
    );
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(err.message)}`
    );
  }
}
