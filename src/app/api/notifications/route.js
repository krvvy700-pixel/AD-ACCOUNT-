import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET — list notifications
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const limit = parseInt(searchParams.get('limit') || '20');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.eq('is_read', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also get unread count
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  return NextResponse.json({ notifications: data, unreadCount: count || 0 });
}

// POST — mark notifications as read
export async function POST(request) {
  const { ids, markAll } = await request.json();
  const supabase = getSupabaseServer();

  if (markAll) {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
  } else if (ids?.length) {
    await supabase.from('notifications').update({ is_read: true }).in('id', ids);
  }

  return NextResponse.json({ success: true });
}
