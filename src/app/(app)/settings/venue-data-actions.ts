'use server';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { isOwner } from '@/lib/auth/roles';
import { requireAuthContext } from '@/lib/auth/server';
import { sendEmail } from '@/lib/email/resend';
import { CONTACT } from '@/lib/legal/company';
import { createLogger } from '@/lib/logging';
import {
  CLOSURE_AUDIT_ACTION,
  findRecentClosureRequest,
  renderClosureConfirmationEmail,
  renderClosureRequestOperatorEmail,
} from '@/lib/settings/closure-request';
import { OWNER_DATA_MESSAGES } from '@/lib/settings/owner-data';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

// ---------------------------------------------------------------------------
// requestVenueClosure: "Ask us to close this venue" in Settings
// (tasks/SPEC-self-serve-signup.md, section 5, "Later (P10)"). Decision D5
// keeps closing with the operator, so this deletes and stops nothing.
//
//   1. a signed-in owner of the active brand, which must be the brand the page
//      was rendered for; the self-serve sign-up switch must be on;
//   2. an earlier request for this brand in the last 24 hours (admin_audit)
//      means no email is sent again: the owner is shown when they asked;
//   3. email the operator (required: if it cannot be sent the owner is told
//      it failed, with our address, and the operator is alerted);
//   4. record venue_closure_request in admin_audit (ids and kind only);
//   5. email the owner a confirmation listing what happens next.
// Steps 4 and 5 run once the operator has the request: a failure there is
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

export async function requestVenueClosure(input: { accountId: string }): Promise<ClosureRequestResult> {
  const ctx = await requireAuthContext();
  const accountId = ctx.accountId;
  if (typeof input?.accountId !== 'string' || input.accountId !== accountId) return { error: OWNER_DATA_MESSAGES.brandSwitched };
  if (!isOwner(ctx)) return { error: OWNER_DATA_MESSAGES.ownersOnly };

  const signupSwitch = await getSelfServeSignupSwitch();
  if (signupSwitch === 'unavailable') {
    await reportSignupFailure('switch', new Error(`the switch could not be read for a closure request (brand ${accountId})`));
    return { error: OWNER_DATA_MESSAGES.closureFailed };
  }
  if (signupSwitch !== 'open') return { error: OWNER_DATA_MESSAGES.notAvailable };

  const now = new Date();
  try {
    const earlier = await findRecentClosureRequest(ctx.supabase, accountId, now);
    if (earlier) return { success: true, alreadyRequested: true, requestedAt: earlier };
  } catch (error) {
    await reportSignupFailure('closure_request', new Error(`${messageOf(error)} (brand ${accountId})`));
    return { error: OWNER_DATA_MESSAGES.closureFailed };
  }

  const venueName = ctx.user.businessName?.trim() || 'Your venue';

  // Step 3: the operator must have the request, or the owner is told it failed.
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
    await reportSignupFailure('closure_request', new Error(`operator email: ${messageOf(error)} (brand ${accountId})`));
    return { error: OWNER_DATA_MESSAGES.closureFailed };
  }

  // Step 4: the record that makes a second request today send nothing.
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

  // Step 5: the owner's confirmation, to the signed-in login's own address.
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
