import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET /api/settings/exchange-rate
export async function GET() {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'usd_to_inr_rate')
    .single();

  return NextResponse.json({ rate: data?.value?.rate || 84.5 });
}

// POST /api/settings/exchange-rate — Update exchange rate
export async function POST(request) {
  const { rate } = await request.json();
  if (!rate || rate <= 0) {
    return NextResponse.json({ error: 'Invalid rate' }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  await supabase.from('system_settings').upsert({
    key: 'usd_to_inr_rate',
    value: { rate, last_updated: new Date().toISOString().split('T')[0] },
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, rate });
}
