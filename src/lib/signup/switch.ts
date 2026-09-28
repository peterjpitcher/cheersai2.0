import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { createLogger } from '@/lib/logging';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * The self-serve sign-up switch (SPEC-self-serve-signup §4.1, §4.2, P2).
 *
 * One row in public.app_flags, next to billing_enforcement, so it flips with
 * SQL and no deploy. It stays off until Meta App Review is approved, the D7
 * gate passes, billing enforcement is on and the sign-up PRs are live.
 *
 * Fail closed: a missing row, a missing service key, a database error or a
 * slow read all count as not open. 'unavailable' is kept apart from 'closed'
 * so the sign-up actions (PR 5) can alert the operator when the read fails;
 * every caller must treat anything other than 'open' as closed.
 */
export const SELF_SERVE_SIGNUP_FLAG = 'self_serve_signup';

export type SelfServeSignupSwitch = 'open' | 'closed' | 'unavailable';

/** A public page must not hang on a slow database: give up and stay closed. */
const READ_TIMEOUT_MS = 3000;

const logger = createLogger('signup');

/** Reads the switch with a service-role client; null (not configured) counts as unavailable. */
export async function readSelfServeSignupSwitch(service: SupabaseClient | null): Promise<SelfServeSignupSwitch> {
  if (!service) return 'unavailable';
  try {
    const { data, error } = await service
      .from('app_flags')
      .select('enabled')
      .eq('name', SELF_SERVE_SIGNUP_FLAG)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
      .maybeSingle<{ enabled: boolean }>();
    if (error) {
      logger.warn('self-serve sign-up switch read failed; treating it as closed', { error: error.message });
      return 'unavailable';
    }
    return data?.enabled === true ? 'open' : 'closed';
  } catch (error) {
    logger.warn('self-serve sign-up switch read failed; treating it as closed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unavailable';
  }
}

/** One read per request, however many server components and metadata calls ask. */
export const getSelfServeSignupSwitch = cache(async (): Promise<SelfServeSignupSwitch> => {
  let service: SupabaseClient | null;
  try {
    service = tryCreateServiceSupabaseClient();
  } catch {
    service = null;
  }
  return readSelfServeSignupSwitch(service);
});
