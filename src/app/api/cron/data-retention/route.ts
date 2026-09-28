import { NextResponse } from 'next/server';

import { sendPurgeReminder, type PurgeReminderResult } from '@/lib/admin/purge-reminder';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure } from '@/lib/signup/alerts';
import {
  deleteSelfServeLogins,
  parseSelfServeLoginList,
  type SelfServeLoginCleanup,
  type SelfServeLoginList,
} from '@/lib/signup/login-cleanup';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyCronAuth } from '@/lib/security/cron-auth';

export const dynamic = 'force-dynamic';

const logger = createLogger('data-retention');

/**
 * Daily data retention (docs/runbooks/data-retention.md):
 *
 * 1. public.run_data_retention(false) deletes or clears everything past its
 *    approved retention period and returns per-rule counts.
 * 2. Self-serve logins that never became a venue, which step 1 lists (at most
 *    100 a run), are deleted through the Auth admin API (spec §4.10, P6).
 * 3. The operator gets one email listing offboarded brands whose 30-day hold
 *    is over and whose data has not been deleted (deletion stays manual).
 *
 * Steps 1 and 3 are independent (step 2 needs step 1's list): a failure in
 * one does not stop the other, and a failure in either makes the run return
 * 500 so it shows in Vercel. Step 2 never fails the run: a login that cannot
 * be deleted (for example one with audit_log rows, whose foreign key has no
 * ON DELETE action) is logged, skipped and tried again the next day, and the
 * operator gets a sign-up alert with the count (kind and count only).
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
  /** Undefined before migration 20260928170000; null when it could not be read. */
  selfServeLogins: SelfServeLoginList | null | undefined;
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
  // A login list the app cannot read is the clean-up's problem, not the rules':
  // it is alerted in runLoginCleanup and never fails the run.
  const selfServeLogins = parseSelfServeLoginList(result.self_serve_logins);
  return { dry_run: false, ran_at: result.ran_at, rules: rules as Record<string, RuleResult>, selfServeLogins };
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

type LoginCleanupOutcome = SelfServeLoginCleanup | { error: string } | null;

/** Step 2. Never fails the run; problems are logged and alerted (kind and count only). */
async function runLoginCleanup(
  service: NonNullable<ReturnType<typeof tryCreateServiceSupabaseClient>>,
  list: SelfServeLoginList | null | undefined,
): Promise<LoginCleanupOutcome> {
  if (list === undefined) return null;
  if (list === null) {
    const error = 'run_data_retention returned a self_serve_logins list the app could not read';
    logger.error(error);
    await reportSignupFailure('login_cleanup', new Error(`${error}; no logins were deleted`));
    return { error };
  }
  try {
    const result = await deleteSelfServeLogins(service, list, logger);
    logger.info('self-serve login clean-up', { ...result });
    if (result.failed > 0) {
      logger.error('self-serve logins could not all be deleted', undefined, { ...result });
      await reportSignupFailure(
        'login_cleanup',
        new Error(`${result.failed} of ${result.due} self-serve logins due for deletion could not be deleted; the next run tries again`),
      );
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('self-serve login clean-up threw', error instanceof Error ? error : new Error(message));
    await reportSignupFailure('login_cleanup', new Error(`the clean-up stopped: ${message}`));
    return { error: message };
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
  const logins = retention.ok ? await runLoginCleanup(service, retention.result.selfServeLogins) : null;
  const reminder = await runPurgeReminder(service);

  // The login clean-up is deliberately left out: it alerts on its own.
  const failed = !retention.ok || !reminder.ok;
  return NextResponse.json(
    {
      retention: retention.ok ? { ranAt: retention.result.ran_at, rules: retention.result.rules } : { error: retention.error },
      selfServeLogins: retention.ok ? logins : { error: 'not run: retention failed' },
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
