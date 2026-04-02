import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET — list accounts
export async function GET() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('meta_accounts')
    .select('id, meta_account_id, name, currency, timezone, status, is_active, last_synced_at, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data });
}

// PATCH — toggle account active status
export async function PATCH(request) {
  const { id, is_active } = await request.json();
  const supabase = getSupabaseServer();

  const { error } = await supabase
    .from('meta_accounts')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
