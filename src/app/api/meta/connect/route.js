import { NextResponse } from 'next/server';

// Initiates Meta OAuth flow — redirects user to Facebook login
export async function GET() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/meta/callback`;
  const scope = 'ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_read_user_content,instagram_basic,instagram_manage_comments';

  const authUrl =
    `https://www.facebook.com/v22.0/dialog/oauth?` +
    `client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&response_type=code`;

  return NextResponse.redirect(authUrl);
}
