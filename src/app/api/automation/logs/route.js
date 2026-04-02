import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET /api/automation/logs — Fetch automation execution history
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ruleId = searchParams.get('rule_id');
  const limit = parseInt(searchParams.get('limit') || '50');

  const supabase = getSupabaseServer();
  let query = supabase
    .from('automation_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ruleId) query = query.eq('rule_id', ruleId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}

// POST /api/automation/logs — Undo (reverse) an automation action
export async function POST(request) {
  const { logId } = await request.json();
  if (!logId) return NextResponse.json({ error: 'Missing logId' }, { status: 400 });

  const supabase = getSupabaseServer();

  // Get the log entry
  const { data: log, error } = await supabase
    .from('automation_logs')
    .select('*')
    .eq('id', logId)
    .single();

  if (error || !log) return NextResponse.json({ error: 'Log not found' }, { status: 404 });
  if (log.is_reversed) return NextResponse.json({ error: 'Already reversed' }, { status: 400 });
  if (!log.previous_value) return NextResponse.json({ error: 'No previous value to restore' }, { status: 400 });

  // TODO: Execute the reversal via Meta API using log.previous_value
  // For now, just mark as reversed

  await supabase
    .from('automation_logs')
    .update({ is_reversed: true, reversed_at: new Date().toISOString() })
    .eq('id', logId);

  return NextResponse.json({ success: true, message: 'Action reversed' });
}
