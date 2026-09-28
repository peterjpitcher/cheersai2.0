'use server';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { consumeAuthRateLimit } from '@/lib/auth/rate-limit';
import { sendEmail } from '@/lib/email/resend';
import { CONTACT } from '@/lib/legal/company';
import { createLogger } from '@/lib/logging';
import {
  CLOSURE_AUDIT_ACTION,
  findRecentClosureRequest,
  renderClosureConfirmationEmail,
  renderClosureRequestOperatorEmail,
} from '@/lib/settings/closure-request';
import { isBrandOwnerMember, ownerActionContext } from '@/lib/settings/owner-access';
import { OWNER_DATA_MESSAGES } from '@/lib/settings/owner-data';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

// ---------------------------------------------------------------------------
// requestVenueClosure: "Ask us to close this venue" in Settings
// (tasks/SPEC-self-serve-signup.md, section 5, "Later (P10)"). Decision D5
// keeps closing with the operator, so this deletes and stops nothing.
//
//   1. a signed-in login whose active brand is the brand the page was
//      rendered for, with a real owner membership row for it (a super-admin's
//      implied owner role does not count), and the sign-up switch on;
//   2. an earlier request for this brand in the last 24 hours (admin_audit)
//      means nothing is sent again: the owner is shown when it was made;
//   3. a per-brand claim (venue_closure_lock: one per 60 seconds, atomic in
//      the database limiter), so two tabs or two owners pressing Send
//      together send one request, and a send that timed out but was delivered
//      is not repeated straight away. The claim is never released early;
//   4. at most 5 sends per brand per 24-hour window (venue_closure_attempt),
//      so a request that keeps failing to be recorded cannot flood the
//      operator's inbox;
//   5. admin_audit is read again under the claim;
//   6. email the operator (required: if it cannot be sent the owner is told
//      it failed, with our address, and the operator is alerted);
//   7. record venue_closure_request in admin_audit (ids and kind only);
//   8. email the owner a confirmation listing what happens next.
// Steps 7 and 8 run once the operator has the request: a failure there is
// logged and alerted, and the owner is still told we have it.
// ---------------------------------------------------------------------------

export interface ClosureRequestResult {
  success?: boolean;
  error?: string;
  /** True when this brand already asked within the repeat window: nothing was sent. */
  alreadyRequested?: boolean;
  /** When the request (or the earlier one) was made, as an ISO timestamp. */
  requestedAt?: string;
  /** False when the operator has the request but the owner's confirmation email failed. */
  confirmationSent?: boolean;
}

const logger = createLogger('closure-request');

/** The request emails give up after this long, so the owner is never left waiting on Resend. */
const EMAIL_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function failed(what: string, error: unknown, accountId: string | null): Promise<ClosureRequestResult> {
  await reportSignupFailure('closure_request', new Error(`${what}: ${messageOf(error)}${accountId ? ` (brand ${accountId})` : ''}`));
  return { error: OWNER_DATA_MESSAGES.closureFailed };
}

export async function requestVenueClosure(input: { accountId: string }): Promise<ClosureRequestResult> {
  const ctx = await ownerActionContext();
  if ('unavailable' in ctx) return failed('sign-in lookup', ctx.unavailable, null);
  const accountId = ctx.accountId;
  if (typeof input?.accountId !== 'string' || input.accountId !== accountId) return { error: OWNER_DATA_MESSAGES.brandSwitched };

  try {
    if (!(await isBrandOwnerMember(ctx.supabase, accountId, ctx.user.id))) return { error: OWNER_DATA_MESSAGES.ownersOnly };
  } catch (error) {
    return failed('owner lookup', error, accountId);
  }

  const signupSwitch = await getSelfServeSignupSwitch();
  if (signupSwitch === 'unavailable') {
    await reportSignupFailure('switch', new Error(`the switch could not be read for a closure request (brand ${accountId})`));
    return { error: OWNER_DATA_MESSAGES.closureFailed };
  }
  if (signupSwitch !== 'open') return { error: OWNER_DATA_MESSAGES.notAvailable };

  // Step 2: the quick answer for a repeat.
  try {
    const earlier = await findRecentClosureRequest(ctx.supabase, accountId, new Date());
    if (earlier) return { success: true, alreadyRequested: true, requestedAt: earlier };
  } catch (error) {
    return failed('admin_audit lookup', error, accountId);
  }

  // Steps 3 to 5: the claim, the daily cap, then the record again under the claim.
  const subject = { email: '', ip: '', accountId };
  try {
    const claim = await consumeAuthRateLimit('venue_closure_lock', subject);
    if (claim.status === 'limited') {
      const justMade = await findRecentClosureRequest(ctx.supabase, accountId, new Date());
      return justMade
        ? { success: true, alreadyRequested: true, requestedAt: justMade }
        : { error: OWNER_DATA_MESSAGES.closureInProgress };
    }
    const attempt = await consumeAuthRateLimit('venue_closure_attempt', subject);
    if (attempt.status === 'limited') return { error: OWNER_DATA_MESSAGES.closureTooManyAttempts };
    const earlier = await findRecentClosureRequest(ctx.supabase, accountId, new Date());
    if (earlier) return { success: true, alreadyRequested: true, requestedAt: earlier };
  } catch (error) {
    return failed('claim', error, accountId);
  }

  const now = new Date();
  const venueName = ctx.user.businessName?.trim() || 'Your venue';

  // Step 6: the operator must have the request, or the owner is told it failed.
  try {
    const to = env.server.OPERATOR_ALERT_EMAIL;
    if (!to) throw new Error('OPERATOR_ALERT_EMAIL is not set');
    const message = renderClosureRequestOperatorEmail({
      venueName,
      accountId,
      ownerEmail: ctx.user.email,
      requestedAt: now,
      adminUrl: new URL('/admin', env.client.NEXT_PUBLIC_SITE_URL).toString(),
    });
    await withTimeout(sendEmail({ to, subject: message.subject, html: message.html, required: true }), EMAIL_TIMEOUT_MS, 'the closure request email');
  } catch (error) {
    return failed('operator email', error, accountId);
  }

  // Step 7: the record that makes a second request today send nothing.
  try {
    await logAdminEvent({
      actorUserId: ctx.user.id,
      action: CLOSURE_AUDIT_ACTION,
      targetUserId: ctx.user.id,
      targetAccountId: accountId,
      detail: { kind: 'owner_request' },
    });
  } catch (error) {
    logger.error('closure request emailed, but not recorded in admin_audit', error instanceof Error ? error : undefined, { accountId });
    await reportSignupFailure('closure_notice', new Error(`admin_audit: ${messageOf(error)} (brand ${accountId})`));
  }

  // Step 8: the owner's confirmation, to the signed-in login's own address.
  let confirmationSent = true;
  try {
    const message = renderClosureConfirmationEmail({ venueName, requestedAt: now, contactEmail: CONTACT.email });
    await withTimeout(
      sendEmail({ to: ctx.user.email, subject: message.subject, html: message.html, required: true }),
      EMAIL_TIMEOUT_MS,
      'the closure confirmation email',
    );
  } catch (error) {
    confirmationSent = false;
    logger.error('closure request confirmation email failed', error instanceof Error ? error : undefined, { accountId });
    await reportSignupFailure('closure_notice', new Error(`confirmation email: ${messageOf(error)} (brand ${accountId})`));
  }

  return { success: true, requestedAt: now.toISOString(), confirmationSent };
}
