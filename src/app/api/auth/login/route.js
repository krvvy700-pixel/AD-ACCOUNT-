import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const AUTH_COOKIE = 'meta_ads_session';

// POST /api/auth/login — Validate credentials, set session cookie
export async function POST(request) {
  try {
    const { username, password } = await request.json();

    const validUser = process.env.ADMIN_USERNAME;
    const validPass = process.env.ADMIN_PASSWORD;

    if (!validUser || !validPass) {
      console.error('[Auth] ADMIN_USERNAME or ADMIN_PASSWORD not set in environment');
      return NextResponse.json({ error: 'Auth not configured on server' }, { status: 500 });
    }

    if (username !== validUser || password !== validPass) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create a session token: base64(username:timestamp:signature)
    const timestamp = Date.now();
    const payload = `${username}:${timestamp}`;
    const signature = await sign(payload, validPass);
    const token = btoa(`${payload}:${signature}`);

    // Set HTTP-only cookie — expires in 7 days
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}

// DELETE /api/auth/login — Logout (clear cookie)
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return NextResponse.json({ success: true });
}

// Simple HMAC-like signature using Web Crypto
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
