import { NextResponse } from 'next/server';

// Initiates Meta OAuth flow — redirects user to Facebook login
// auth_type=rerequest → Forces Facebook to re-show ALL permissions (even if previously granted)
// This ensures the user sees the "Which Pages?" screen and can select ALL pages
export async function GET() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/meta/callback`;
  // ALL PERMISSIONS — grab everything
  const scope = [
    // Ads
    'ads_read', 'ads_management',
    // Business
    'business_management',
    // Pages — full control
    'pages_show_list', 'pages_read_engagement', 'pages_manage_engagement',
    'pages_read_user_content', 'pages_manage_posts', 'pages_manage_metadata',
    'pages_messaging',
    // Instagram — full control
    'instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages',
    'instagram_content_publish',
    // Insights & Leads
    'read_insights', 'leads_retrieval',
    // Catalog
    'catalog_management',
    // Email
    'email',
    // Public profile
    'public_profile',
  ].join(',');

  const authUrl =
    `https://www.facebook.com/v22.0/dialog/oauth?` +
    `client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&auth_type=rerequest` +
    `&response_type=code`;

  return NextResponse.redirect(authUrl);
}
