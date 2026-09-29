import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createLogger } from '@/lib/logging';
import { findSignupDigest, type SignupDigest } from '@/lib/signup/digest';
import { findSignupFunnel, type SignupFunnel } from '@/lib/signup/funnel';
import { getSelfServeSignupSwitch, type SelfServeSignupSwitch } from '@/lib/signup/switch';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Data for the admin Sign-ups card (tasks/SPEC-self-serve-signup.md §4.9,
// §4.10, decision P10). Super-admins only: the card's route handler
// (src/app/api/admin/signups/route.ts) checks the flag before it calls this.
//
// It reuses the daily operator email's lists (./digest.ts) and the funnel
// (./funnel.ts), so the card, the email and the runbook agree. It never
// throws: a failed or slow read comes back as an error for the card to show,
// and is logged. At the deadline every read is cancelled (in flight, and no
// further page or lookup is started), not just abandoned.
// ---------------------------------------------------------------------------

/** Longest the card waits before it shows an error instead of the figures. */
export const SIGNUPS_OVERVIEW_TIMEOUT_MS = 8000;

const logger = createLogger('signup');

export type SignupsOverview =
  | {
      status: 'ready';
      /** The customer-facing sign-up switch, so zeros read as "closed", not "broken". */
      signupSwitch: SelfServeSignupSwitch;
      funnel: SignupFunnel;
      digest: SignupDigest;
      readAt: string;
    }
  | { status: 'error'; message: string; readAt: string };

interface LoadOptions {
  now?: Date;
  /** Injected in tests; by default the service-role client (null when it is not configured). */
  service?: SupabaseClient | null;
  timeoutMs?: number;
}

function timeoutMessage(ms: number): string {
  return `the sign-up figures took longer than ${Math.round(ms / 1000)} seconds`;
}

/**
 * Runs the reads with one deadline: the signal goes to every query (so the
 * requests are cancelled) and the race gives up at the same moment even if
 * something does not honour the signal. A timer rather than
 * AbortSignal.timeout(), so tests can drive it with fake timers.
 */
async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(timeoutMessage(ms));
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function serviceClient(options: LoadOptions): SupabaseClient | null {
  if (options.service !== undefined) return options.service;
  try {
    return tryCreateServiceSupabaseClient();
  } catch {
    return null;
  }
}

export async function loadSignupsOverview(options: LoadOptions = {}): Promise<SignupsOverview> {
  const now = options.now ?? new Date();
  const readAt = now.toISOString();
  try {
    const service = serviceClient(options);
    if (!service) throw new Error('the Supabase service key is not configured');
    const [signupSwitch, funnel, digest] = await withDeadline(options.timeoutMs ?? SIGNUPS_OVERVIEW_TIMEOUT_MS, (signal) =>
      Promise.all([
        getSelfServeSignupSwitch(),
        findSignupFunnel(service, now, { signal }),
        findSignupDigest(service, now, { signal }),
      ]),
    );
    return { status: 'ready', signupSwitch, funnel, digest, readAt };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('admin sign-ups card could not be read', err);
    return { status: 'error', message: err.message.slice(0, 300), readAt };
  }
}
