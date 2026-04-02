import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'meta_ads_session';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/favicon.ico',
];

// Paths that use their own auth (cron secret)
const CRON_PATHS = [
  '/api/sync',
  '/api/automation/evaluate',
];

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith('/_next/') || pathname.startsWith('/static/') || pathname.endsWith('.ico') || pathname.endsWith('.png') || pathname.endsWith('.svg')) {
    return NextResponse.next();
  }

  // Cron paths have their own auth — let them through (they check CRON_SECRET_KEY)
  if (CRON_PATHS.some(p => pathname === p)) {
    const hasCronSecret = request.headers.get('x-cron-secret');
    if (hasCronSecret) return NextResponse.next();
  }

  // Check session cookie
  const sessionCookie = request.cookies.get(AUTH_COOKIE);

  if (!sessionCookie?.value) {
    // No session — redirect to login (for pages) or return 401 (for API)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Validate session token
  try {
    const decoded = atob(sessionCookie.value);
    const parts = decoded.split(':');
    if (parts.length !== 3) throw new Error('Invalid token format');

    const [username, timestamp, signature] = parts;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      // Can't validate without password — deny
      return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
    }

    // Verify signature
    const payload = `${username}:${timestamp}`;
    const expectedSig = await sign(payload, adminPassword);

    if (signature !== expectedSig) {
      // Invalid signature — clear cookie and redirect to login
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Invalid session' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', request.url));
      response.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' });
      return response;
    }

    // Check if token is expired (7 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Session expired' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', request.url));
      response.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' });
      return response;
    }

    // Valid session — proceed
    return NextResponse.next();
  } catch {
    // Malformed token — redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: [
    // Match all routes except _next/static, _next/image, favicon
    '/((?!_next/static|_next/image).*)',
  ],
};

// HMAC signature for session validation
async function sign(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
