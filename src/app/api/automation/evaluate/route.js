import { NextResponse } from 'next/server';
import { evaluateAllRules } from '@/lib/rule-evaluator';

// POST /api/automation/evaluate — Trigger rule evaluation
// Called by cron service or manually. Protected by CRON_SECRET_KEY.
export async function POST(request) {
  const authHeader = request.headers.get('x-cron-secret');
  const manualTrigger = request.headers.get('x-manual-trigger');

  if (!manualTrigger && authHeader !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await evaluateAllRules();
    return NextResponse.json(result);
  } catch (err) {
    console.error('Rule evaluation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
