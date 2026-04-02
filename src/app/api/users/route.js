import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { hashPassword, generateSalt } from '@/lib/auth';

// GET /api/users — List all users (admin only — enforced by middleware)
export async function GET() {
  const supabase = getSupabaseServer();

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, display_name, role, is_active, last_login_at, created_at')
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ users: users || [] });
  } catch (err) {
    console.error('Users list error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/users — Create a new user (admin only)
export async function POST(request) {
  const { username, password, displayName, role } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const validRoles = ['admin', 'developer', 'viewer'];
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Must be: ${validRoles.join(', ')}` }, { status: 400 });
  }

  // Prevent creating users with env admin username
  if (username === process.env.ADMIN_USERNAME) {
    return NextResponse.json({ error: 'This username is reserved' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    // Check if username already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }

    // Hash password with random salt
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        username,
        display_name: displayName || username,
        password_hash: passwordHash,
        password_salt: salt,
        role: role || 'viewer',
        is_active: true,
      })
      .select('id, username, display_name, role, is_active, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json({ user });
  } catch (err) {
    console.error('User create error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/users — Update user (role, active status, password reset)
export async function PATCH(request) {
  const { id, role, isActive, password, displayName } = await request.json();

  if (!id) {
    return NextResponse.json({ error: 'User id required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    const updates = { updated_at: new Date().toISOString() };

    if (role) {
      const validRoles = ['admin', 'developer', 'viewer'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      updates.role = role;
    }

    if (isActive !== undefined) {
      updates.is_active = isActive;
    }

    if (displayName !== undefined) {
      updates.display_name = displayName;
    }

    if (password) {
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      const salt = generateSalt();
      updates.password_hash = await hashPassword(password, salt);
      updates.password_salt = salt;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, username, display_name, role, is_active')
      .single();

    if (error) throw error;

    return NextResponse.json({ user: data });
  } catch (err) {
    console.error('User update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/users — Delete a user (admin only)
export async function DELETE(request) {
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: 'User id required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('User delete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
