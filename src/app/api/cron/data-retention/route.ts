import { NextResponse } from 'next/server';

import { sendPurgeReminder, type PurgeReminderResult } from '@/lib/admin/purge-reminder';
import { createLogger } from '@/lib/logging';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

const logger = createLogger('data-retention');

/**
 * Daily data retention (docs/runbooks/data-retention.md):
 *
 * 1. public.run_data_retention(false) deletes or clears everything past its
 *    approved retention period and returns per-rule counts.
 * 2. The operator gets one email listing offboarded brands whose 30-day hold
 *    is over and whose data has not been deleted (deletion stays manual).
 *
 * The two steps are independent: a failure in one does not stop the other,
 * but either failure makes the run return 500 so it shows in Vercel.
 */

interface RuleResult {
  action: string;
  cutoff: string;
  due: number;
  done: number;
}

interface RetentionResult {
  dry_run: boolean;
  ran_at: string;
  rules: Record<string, RuleResult>;
}

function isRuleResult(value: unknown): value is RuleResult {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.action === 'string' &&
    typeof rule.cutoff === 'string' &&
    typeof rule.due === 'number' &&
    typeof rule.done === 'number'
  );
}

/** The RPC's jsonb, checked; anything unexpected counts as a failure. */
function parseRetentionResult(data: unknown): RetentionResult | null {
  if (!data || typeof data !== 'object') return null;
  const result = data as Record<string, unknown>;
  if (result.dry_run !== false || typeof result.ran_at !== 'string') return null;
  if (!result.rules || typeof result.rules !== 'object') return null;
  const rules = result.rules as Record<string, unknown>;
  const names = Object.keys(rules);
  if (names.length === 0 || !names.every((name) => isRuleResult(rules[name]))) return null;
  return { dry_run: false, ran_at: result.ran_at, rules: rules as Record<string, RuleResult> };
}

async function runRetention(
  service: NonNullable<ReturnType<typeof tryCreateServiceSupabaseClient>>,
): Promise<{ ok: true; result: RetentionResult } | { ok: false; error: string }> {
  try {
    const { data, error } = await service.rpc('run_data_retention', { p_dry_run: false });
    if (error) {
      logger.error('run_data_retention failed', new Error(error.message));
      return { ok: false, error: error.message };
    }
    const result = parseRetentionResult(data);
    if (!result) {
      logger.error('run_data_retention returned an unexpected result', undefined, { data });
      return { ok: false, error: 'Unexpected result from run_data_retention' };
    }
    for (const [rule, counts] of Object.entries(result.rules)) {
      logger.info('retention rule', { rule, ...counts });
      if (counts.done < counts.due) {
        // Capped at 10,000 rows per rule per run; the next run carries on.
        logger.warn('retention rule has rows left for the next run', { rule, left: counts.due - counts.done });
      }
    }
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('run_data_retention threw', error instanceof Error ? error : new Error(message));
    return { ok: false, error: message };
  }
}

async function runPurgeReminder(
  service: NonNullable<ReturnType<typeof tryCreateServiceSupabaseClient>>,
): Promise<{ ok: true; result: PurgeReminderResult } | { ok: false; error: string }> {
  try {
    const result = await sendPurgeReminder(service);
    logger.info('purge reminder', { ...result });
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('purge reminder failed', error instanceof Error ? error : new Error(message));
    return { ok: false, error: message };
  }
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    logger.error('Supabase service role is not configured');
    return NextResponse.json({ error: 'Supabase service role is not configured' }, { status: 500 });
  }

  const retention = await runRetention(service);
  const reminder = await runPurgeReminder(service);

  const failed = !retention.ok || !reminder.ok;
  return NextResponse.json(
    {
      retention: retention.ok ? { ranAt: retention.result.ran_at, rules: retention.result.rules } : { error: retention.error },
      purgeReminder: reminder.ok ? reminder.result : { error: reminder.error },
    },
    { status: failed ? 500 : 200 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
