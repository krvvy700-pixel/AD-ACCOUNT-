import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySignature } from '@/lib/auth';

// GET /api/auth/me — Returns current user info (role, username)
// Used by AuthContext to determine role-based UI visibility
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('meta_ads_session');

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const decoded = atob(sessionCookie.value);
    const parts = decoded.split(':');

    let username, role;
    if (parts.length === 4) {
      [username, role] = parts;
    } else if (parts.length === 3) {
      [username] = parts;
      role = 'admin';
    } else {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Verify signature to prevent tampering
    const signingSecret = process.env.ADMIN_PASSWORD;
    if (!signingSecret) {
      return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
    }

    const payload = parts.length === 4
      ? `${parts[0]}:${parts[1]}:${parts[2]}`
      : `${parts[0]}:${parts[1]}`;
    const signature = parts[parts.length - 1];

    const isValid = await verifySignature(payload, signature, signingSecret);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    return NextResponse.json({
      username,
      role,
      permissions: {
        canEdit: role === 'admin' || role === 'developer',
        canManageUsers: role === 'admin',
        canCreateRules: role === 'admin' || role === 'developer',
        canPauseEnable: role === 'admin' || role === 'developer',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
}
