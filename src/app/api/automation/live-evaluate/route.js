import { NextResponse } from 'next/server';
import { evaluateLiveRules } from '@/lib/live-rule-evaluator';

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

  try {
    const result = await evaluateLiveRules();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[LiveEvaluate] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET — health check for monitoring
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'live-evaluate', interval: '60s' });
}
