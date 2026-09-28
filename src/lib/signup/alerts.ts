import 'server-only';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email/resend';
import { createLogger } from '@/lib/logging';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Operator alerts for the self-serve sign-up request (tasks/SPEC-self-serve-
// signup.md §4.9). Sign-up is a public write path, so every failure caused by
// a dependency is refused with a visible error AND made visible on our side.
//
// For each failure:
//   1. log it (Vercel logs);
//   2. count it in the database limiter under 'signup_alert:kind:<kind>'
//      (one atomic call that also says whether this is the first of the hour);
//   3. write an 'operator_signup_alert' row to admin_audit (kind and count
//      only; kept 6 years), so an outage that also stopped the email is still
//      on record;
//   4. email the operator, at most once per kind per hour.
// If the database is down (steps 2 and 3 fail), the email goes anyway, at most
// once per kind per server instance per hour.
//
// Never throws, and never records or sends the visitor's email or IP address.
// ---------------------------------------------------------------------------

export type SignupFailureKind =
  | 'switch'
  | 'turnstile'
  | 'turnstile_widget'
  | 'rate_limiter'
  | 'site_limit'
  | 'lookup'
  | 'generate_link'
  | 'database'
  | 'email'
  | 'login_cleanup'
  | 'unexpected';

const WHAT_BROKE: Record<SignupFailureKind, string> = {
  switch: 'Cheers could not read the self-serve sign-up switch (app_flags.self_serve_signup), so sign-up is refused as if it were off.',
  turnstile:
    'Cheers could not check the Cloudflare Turnstile answer on the sign-up form (TURNSTILE_SECRET_KEY missing or rejected, Cloudflare down or slow, or test keys in Production).',
  turnstile_widget:
    "A visitor's browser reported that the Cloudflare Turnstile check on the sign-up form could not load or run (Cloudflare's script blocked or down, or the site key refused for this domain), so they could not ask to sign up. They were shown an error and our email address.",
  rate_limiter: 'Cheers could not check the sign-up rate limits (public.consume_rate_limit failed; Supabase may be down).',
  site_limit:
    'The site-wide limit of 60 sign-up emails an hour was reached, so further sign-up requests are refused this hour. It protects the shared sending address; check for abuse before raising it.',
  lookup: 'Cheers could not look up whether a sign-up email already has a login (user_auth_snapshot, account_members or the Auth admin API failed).',
  generate_link: 'Supabase Auth could not create a sign-up or invite link (auth.admin.generateLink failed).',
  database: 'Cheers could not record a sign-up request in public.self_serve_signups (record_self_serve_signup_request failed).',
  email: 'Resend could not send a sign-up email (confirmation, member invite or "you already have a login").',
  login_cleanup:
    'The daily data-retention run could not delete some self-serve logins that never became a venue (the deletion check or the Auth admin API failed; a login with rows in audit_log cannot be deleted). The other retention rules ran. The next daily run tries again; the Vercel logs name each user id and the reason.',
  unexpected: 'Something unexpected failed while handling a sign-up request (for example the service-role client could not be created). The error below says what.',
};

const ALERT_WINDOW_SECONDS = 60 * 60;
const ALERT_TIMEOUT_MS = 3000;
/** Bookkeeping rows per kind per hour; the count on the last one says how many more there were. */
const MAX_AUDIT_ROWS_PER_HOUR = 50;

const logger = createLogger('signup');
const lastEmailAt = new Map<SignupFailureKind, number>();

/** Test hook: forget which alerts this server instance has already sent. */
export function resetSignupAlertsForTests(): void {
  lastEmailAt.clear();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Keeps any email address that a dependency echoed back out of logs and alerts. */
export function redactEmails(text: string): string {
  return text.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Steps 2 and 3. Returns whether to email, or null when the database could not be used. */
async function recordInDatabase(kind: SignupFailureKind): Promise<boolean | null> {
  try {
    const service = createServiceSupabaseClient();
    const { data, error } = await withTimeout(
      Promise.resolve(
        service.rpc('consume_rate_limit', {
          p_key: `signup_alert:kind:${kind}`,
          p_limit: 1,
          p_window_seconds: ALERT_WINDOW_SECONDS,
        }),
      ),
      ALERT_TIMEOUT_MS,
    );
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; hits?: unknown } | null;
    if (!row || typeof row.allowed !== 'boolean' || typeof row.hits !== 'number') {
      throw new Error('consume_rate_limit returned no usable row');
    }
    if (row.hits <= MAX_AUDIT_ROWS_PER_HOUR) {
      try {
        await withTimeout(
          logAdminEvent({
            actorUserId: null,
            action: 'operator_signup_alert',
            detail: { kind, count: row.hits },
            result: 'failure',
          }),
          ALERT_TIMEOUT_MS,
        );
      } catch (auditError) {
        logger.error('could not record the sign-up alert in admin_audit', auditError instanceof Error ? auditError : undefined, {
          kind,
        });
      }
    }
    return row.allowed;
  } catch (bookkeepingError) {
    logger.error('could not count the sign-up alert in the database', bookkeepingError instanceof Error ? bookkeepingError : undefined, {
      kind,
    });
    return null;
  }
}

export async function reportSignupFailure(kind: SignupFailureKind, error: unknown): Promise<void> {
  const message = redactEmails(error instanceof Error ? error.message : String(error));
  logger.error(`sign-up ${kind} failed`, undefined, { kind, message });

  let shouldEmail = await recordInDatabase(kind);
  if (shouldEmail === null) {
    const now = Date.now();
    const last = lastEmailAt.get(kind);
    shouldEmail = last === undefined || now - last >= ALERT_WINDOW_SECONDS * 1000;
  }
  if (!shouldEmail) return;
  lastEmailAt.set(kind, Date.now());

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) {
    console.error('[signup] OPERATOR_ALERT_EMAIL is not set; the sign-up failure alert was not sent.');
    return;
  }

  try {
    await withTimeout(
      sendEmail({
        to,
        subject: `[Cheers operator] Sign-up problem: ${kind}`,
        html: `
<p>${escapeHtml(WHAT_BROKE[kind])}</p>
<p>Error: ${escapeHtml(message.slice(0, 500))}</p>
<p>Visitors are shown an error and asked to try again or email us. You will not get another email about this kind of problem for an hour; the Vercel logs have every failure, and admin_audit has an operator_signup_alert row for each (up to ${MAX_AUDIT_ROWS_PER_HOUR} an hour).</p>
`.trim(),
        required: true,
      }),
      ALERT_TIMEOUT_MS,
    );
  } catch (alertError) {
    console.error('[signup] could not send the sign-up failure alert:', alertError instanceof Error ? alertError.message : alertError);
  }
}
