import 'server-only';

import { env } from '@/env';
import { sendEmail } from '@/lib/email/resend';
import { createLogger } from '@/lib/logging';

const logger = createLogger('auth');

/** The public auth paths whose dependencies can fail. */
export type AuthFailureKind =
  | 'rate_limiter'
  | 'sign_in'
  | 'magic_link'
  | 'password_reset'
  | 'email_link'
  | 'invite_login_cleanup';

const WHAT_BROKE: Record<AuthFailureKind, string> = {
  rate_limiter:
    'Cheers could not check its sign-in rate limits, so password sign-in, magic links and password resets are being refused until it recovers. Check that migration 20260928120000 (consume_rate_limit) is applied and that Supabase is up.',
  sign_in: 'A password sign-in failed for a reason other than a wrong password (Supabase Auth error or outage).',
  magic_link: 'Cheers could not send a magic link (the login lookup, Supabase Auth or Resend failed).',
  password_reset: 'Cheers could not create or send a password reset link (Supabase Auth or Resend failed).',
  email_link:
    'Cheers could not check an invite, reset or sign-in link after the visitor pressed "Confirm and continue" (Supabase Auth error or outage). The link is probably still unused.',
  invite_login_cleanup:
    'A team invite to a new address created a login, then the invite was refused or failed, and Cheers could not delete that unused login. It has no brand and was never emailed a link. Delete it in Supabase Auth (the user id is below and in the Vercel logs).',
};

const ALERT_INTERVAL_MS = 60 * 60 * 1000;
const ALERT_TIMEOUT_MS = 3000;
const lastAlertAt = new Map<AuthFailureKind, number>();

/** Test hook: forget which alerts this server instance has already sent. */
export function resetAuthFailureAlertsForTests(): void {
  lastAlertAt.clear();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Anything shaped like an email address, written plainly or URL-encoded
 * (`owner%40venue.test`). A dependency's error text (Resend's, say) could
 * quote the visitor's address, so it is replaced before the failure is logged
 * or emailed. Neither half may contain "/", and the domain must end in a
 * dotted label that starts with a letter, so stack-trace paths such as
 * `node_modules/@supabase/auth-js` or `@supabase+auth-js@2.89.0` are kept.
 */
const EMAIL_ADDRESS_PATTERN = /[a-z0-9._%+-]+(?:@|%40)(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*/gi;

function withoutEmailAddresses(text: string): string {
  return text.replace(EMAIL_ADDRESS_PATTERN, '[email address]');
}

/** The error as logged: same name, message and stack, with any email address replaced. */
function redactedError(error: unknown, message: string): Error | undefined {
  if (!(error instanceof Error)) return undefined;
  const redacted = new Error(message);
  redacted.name = error.name;
  if (error.stack) redacted.stack = withoutEmailAddresses(error.stack);
  return redacted;
}

/**
 * Make an auth dependency failure visible on our side (workspace rule: public
 * write paths fail closed and raise something we can see). Every failure is
 * logged; the operator gets an email at most once per kind per server instance
 * per hour (spec §4.9, "Database down"). There is no admin_audit dedupe because
 * the database is usually what failed. Never throws, never waits more than
 * three seconds, and never includes the visitor's email or IP address.
 */
export async function reportAuthFailure(kind: AuthFailureKind, error: unknown): Promise<void> {
  const message = withoutEmailAddresses(error instanceof Error ? error.message : String(error));
  logger.error(`${kind} dependency failed`, redactedError(error, message), { kind, message });

  const now = Date.now();
  const last = lastAlertAt.get(kind);
  if (last !== undefined && now - last < ALERT_INTERVAL_MS) return;
  lastAlertAt.set(kind, now);

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) {
    console.error('[auth] OPERATOR_ALERT_EMAIL is not set; the auth failure alert was not sent.');
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendEmail({
        to,
        subject: `[Cheers operator] Sign-in problem: ${kind}`,
        html: `
<p>${escapeHtml(WHAT_BROKE[kind])}</p>
<p>Error: ${escapeHtml(message.slice(0, 500))}</p>
<p>Visitors are shown an error and asked to try again or email us. You will not get another email about this from the same server for an hour; the Vercel logs have every failure.</p>
`.trim(),
        required: true,
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ALERT_TIMEOUT_MS);
      }),
    ]);
  } catch (alertError) {
    console.error('[auth] could not send the auth failure alert:', alertError instanceof Error ? alertError.message : alertError);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
