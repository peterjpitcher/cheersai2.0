import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { after } from 'next/server';

import { BILLING_ENFORCEMENT_FLAG } from '@/lib/billing/enforcement';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * The self-serve sign-up switch (SPEC-self-serve-signup §4.1, §4.2, P2, P3).
 *
 * One row in public.app_flags, next to billing_enforcement, so it flips with
 * SQL and no deploy. It stays off until Meta App Review is approved, the D7
 * gate passes, billing enforcement is on and the sign-up PRs are live.
 *
 * Open needs both rows on (P3, §6 opening day): with billing enforcement off,
 * a venue that skipped Checkout would use Cheers free. Both rows are read in
 * one query. The switch on while billing_enforcement is off or missing (a
 * missing row is off for billing too, src/lib/billing/enforcement.ts) reads as
 * 'enforcement_off': closed, logged on every read, and alerted to the operator
 * (kind 'signup_without_enforcement'). The database function
 * provision_self_serve_brand re-reads only self_serve_signup; this app gate
 * runs first in every sign-up path and is the control.
 *
 * Fail closed: a missing row, a missing service key, a database error or a
 * slow read all count as not open. 'unavailable' is kept apart from 'closed'
 * so the sign-up actions (PR 5) can alert the operator when the read fails;
 * every caller must treat anything other than 'open' as closed.
 */
export const SELF_SERVE_SIGNUP_FLAG = 'self_serve_signup';

export type SelfServeSignupSwitch = 'open' | 'closed' | 'enforcement_off' | 'unavailable';

/** A public page must not hang on a slow database: give up and stay closed. */
const READ_TIMEOUT_MS = 3000;

/**
 * Every public page reads the switch, so each loaded copy of this module
 * raises the alert at most once an hour. A server can load more than one copy
 * (route handlers and pages are bundled apart: a local run on 29 September
 * 2026 raised it twice, from robots.txt and from the pages), so expect a few
 * an hour in all; reportSignupFailure then sends one email an hour overall.
 * Without this, every page view would write to the database while the flags
 * are wrong.
 */
const ENFORCEMENT_ALERT_INTERVAL_MS = 60 * 60 * 1000;

const logger = createLogger('signup');

let lastEnforcementAlertAt: number | null = null;

/** Test hook: forget that this copy of the module has already raised the enforcement alert. */
export function resetSignupSwitchAlertForTests(): void {
  lastEnforcementAlertAt = null;
}

/** 'on' only for enabled = true; a row that is missing, or anything else in it, is not on. */
function flagState(rows: unknown[], name: string): 'on' | 'off' | 'missing' {
  const row = rows.find(
    (candidate): candidate is { name: string; enabled?: unknown } =>
      typeof candidate === 'object' && candidate !== null && (candidate as { name?: unknown }).name === name,
  );
  if (!row) return 'missing';
  return row.enabled === true ? 'on' : 'off';
}

function alertSignupWithoutEnforcement(billingEnforcement: 'off' | 'missing'): void {
  const now = Date.now();
  if (lastEnforcementAlertAt !== null && now - lastEnforcementAlertAt < ENFORCEMENT_ALERT_INTERVAL_MS) return;
  lastEnforcementAlertAt = now;

  // Flag names and state only: nothing about the visitor.
  const send = (): Promise<void> =>
    reportSignupFailure(
      'signup_without_enforcement',
      new Error(`app_flags.self_serve_signup is on but app_flags.billing_enforcement is ${billingEnforcement}`),
    );
  try {
    // After the response, so no page waits for the alert's database writes and email.
    after(send);
  } catch {
    // Outside a request there is no after(): send it now without waiting. The
    // helper never rejects today; the catch keeps a future rejection from going
    // unhandled.
    void send().catch(() => undefined);
  }
}

/** Reads the switch with a service-role client; null (not configured) counts as unavailable. */
export async function readSelfServeSignupSwitch(service: SupabaseClient | null): Promise<SelfServeSignupSwitch> {
  if (!service) return 'unavailable';
  let rows: unknown[];
  try {
    const { data, error } = await service
      .from('app_flags')
      .select('name, enabled')
      .in('name', [SELF_SERVE_SIGNUP_FLAG, BILLING_ENFORCEMENT_FLAG])
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
    if (error) {
      logger.warn('self-serve sign-up switch read failed; treating it as closed', { error: error.message });
      return 'unavailable';
    }
    if (!Array.isArray(data)) {
      logger.warn('self-serve sign-up switch read returned no rows list; treating it as closed');
      return 'unavailable';
    }
    rows = data;
  } catch (error) {
    logger.warn('self-serve sign-up switch read failed; treating it as closed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unavailable';
  }

  if (flagState(rows, SELF_SERVE_SIGNUP_FLAG) !== 'on') return 'closed';
  const billingEnforcement = flagState(rows, BILLING_ENFORCEMENT_FLAG);
  if (billingEnforcement === 'on') return 'open';

  logger.warn('self-serve sign-up switch is on but billing enforcement is not; sign-up stays closed', {
    billingEnforcement,
  });
  alertSignupWithoutEnforcement(billingEnforcement);
  return 'enforcement_off';
}

function readWithServiceClient(): Promise<SelfServeSignupSwitch> {
  let service: SupabaseClient | null;
  try {
    service = tryCreateServiceSupabaseClient();
  } catch {
    service = null;
  }
  return readSelfServeSignupSwitch(service);
}

/**
 * Reads in flight or done, keyed by the request's headers object. Next hands
 * the page and its generateMetadata the same object for one request, while
 * React's cache() is not shared between the two (a hung database cost two
 * 3-second timeouts on `/`, measured 28 September 2026). Entries go when the
 * request's headers object is collected.
 */
const readsByRequest = new WeakMap<object, Promise<SelfServeSignupSwitch>>();

/**
 * The switch for the current request, read at most once per request however
 * many times the page, its metadata or other server components ask. Outside a
 * request (no headers), it reads directly.
 */
export async function getSelfServeSignupSwitch(): Promise<SelfServeSignupSwitch> {
  let request: object | null;
  try {
    request = await headers();
  } catch {
    request = null;
  }
  if (!request) return readWithServiceClient();

  const existing = readsByRequest.get(request);
  if (existing) return existing;
  const read = readWithServiceClient();
  readsByRequest.set(request, read);
  return read;
}
