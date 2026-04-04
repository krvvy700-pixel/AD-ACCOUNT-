import { NextResponse } from 'next/server';
import { evaluateLiveRules } from '@/lib/live-rule-evaluator';
import { getSupabaseServer } from '@/lib/supabase-server';

// POST /api/automation/live-evaluate
// Called by CRON every 60 seconds. Fetches live Meta data and evaluates ad rules.
//
// CRON SETUP (cron-job.org — free):
//   URL: https://your-domain.com/api/automation/live-evaluate
//   Method: POST
//   Header: x-cron-secret: YOUR_CRON_SECRET_KEY
//   Schedule: Every 1 minute
//
export async function POST(request) {
  // Auth: cron secret OR manual trigger
  const cronSecret = request.headers.get('x-cron-secret');
  const manualTrigger = request.headers.get('x-manual-trigger');

  if (!manualTrigger && cronSecret !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const source = manualTrigger ? 'manual' : 'cron';

  try {
    const result = await evaluateLiveRules();

    // ── Track cron health ──────────────────────────────────
    // Store last run time, result, and source in system_settings
    const supabase = getSupabaseServer();
    await supabase.from('system_settings').upsert({
      key: 'cron_health',
      value: {
        last_run_at: new Date().toISOString(),
        source,
        status: 'success',
        evaluated: result.evaluated || 0,
        paused: result.paused || 0,
        resumed: result.resumed || 0,
        skipped: result.skipped || result.skippedMinSpend || 0,
        rules_checked: result.rules || 0,
        elapsed_ms: result.elapsed_ms || 0,
        error: null,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    return NextResponse.json({ ...result, source });
  } catch (err) {
    console.error('[LiveEvaluate] Error:', err);

    // Track failure too
    try {
      const supabase = getSupabaseServer();
      await supabase.from('system_settings').upsert({
        key: 'cron_health',
        value: {
          last_run_at: new Date().toISOString(),
          source,
          status: 'failed',
          error: err.message,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch {}

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/automation/live-evaluate — cron health check
// Returns last run time, status, and cron health diagnosis
export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', 'cron_health')
      .single();

    if (!data?.value) {
      return NextResponse.json({
        status: 'never_run',
        message: 'Cron has never executed. Set up cron-job.org to hit POST /api/automation/live-evaluate every 60s.',
        healthy: false,
      });
    }

    const lastRun = new Date(data.value.last_run_at);
    const ageMs = Date.now() - lastRun.getTime();
    const ageMins = Math.floor(ageMs / 60000);

    // Health diagnosis:
    // - Healthy: last run < 3 min ago
    // - Warning: last run 3-10 min ago
    // - Critical: last run > 10 min ago
    let health = 'healthy';
    let healthColor = 'green';
    if (ageMins > 10) { health = 'critical'; healthColor = 'red'; }
    else if (ageMins > 3) { health = 'warning'; healthColor = 'yellow'; }

    return NextResponse.json({
      healthy: health === 'healthy',
      health,
      healthColor,
      lastRunAt: data.value.last_run_at,
      lastRunAge: ageMins < 1 ? 'just now' : `${ageMins}m ago`,
      lastRunAgeMs: ageMs,
      source: data.value.source,
      status: data.value.status,
      lastResult: {
        evaluated: data.value.evaluated,
        paused: data.value.paused,
        resumed: data.value.resumed,
        skipped: data.value.skipped,
        rulesChecked: data.value.rules_checked,
        elapsedMs: data.value.elapsed_ms,
        error: data.value.error,
      },
    });
  } catch (err) {
    return NextResponse.json({
      healthy: false,
      health: 'error',
      error: err.message,
    });
  }
}
