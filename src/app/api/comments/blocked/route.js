import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function GET() {
  const supabase = getSupabaseServer();
  try {
    const { data: blocked, error } = await supabase
      .from('blocked_accounts')
      .select('*')
      .order('blocked_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ blocked: blocked || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
