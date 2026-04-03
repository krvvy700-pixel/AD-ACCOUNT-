import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';

// GET — list all automation rules
export async function GET() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data });
}

// POST — create a new rule
export async function POST(request) {
  const body = await request.json();
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      name: body.name,
      description: body.description,
      scope: body.scope || 'campaign',
      conditions: body.conditions,
      action_type: body.action_type,
      action_params: body.action_params,
      cooldown_minutes: body.cooldown_minutes ?? 60,
      max_triggers_per_day: body.max_triggers_per_day || 10,
      min_spend_threshold: body.min_spend_threshold ?? 1.00,
      requires_approval: body.requires_approval || false,
      dry_run: body.dry_run || false,
      target_ids: body.target_ids || null,
      target_account_ids: body.target_account_ids || null,
      target_external_ids: body.target_external_ids || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}

// PATCH — update a rule (toggle active, edit fields)
export async function PATCH(request) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('automation_rules')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// DELETE — delete a rule
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'Missing rule id' }, { status: 400 });

  const supabase = getSupabaseServer();
  const { error } = await supabase.from('automation_rules').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
