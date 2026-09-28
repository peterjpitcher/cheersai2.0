'use server';

import { headers } from 'next/headers';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { clientIpFromHeaders, consumeAuthRateLimit } from '@/lib/auth/rate-limit';
import { BILLING_SETUP_PATH } from '@/lib/billing/setup-redirect';
import { sendEmail } from '@/lib/email/resend';
import { LEGAL_VERSION } from '@/lib/legal/company';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { renderNewVenueOperatorEmail } from '@/lib/signup/emails';
import { VENUE_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import {
  isProvisioned,
  provisionSelfServeBrand,
  readSignedInLogin,
  type ProvisionOutcome,
  type ProvisionRefusal,
  type SignedInUser,
} from '@/lib/signup/venue';
import { readVenueForm, storedBusinessType, VENUE_TYPES, venueFormSchema, type VenueForm } from '@/lib/signup/venue-form';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// createSelfServeVenue: the /signup/venue form (tasks/SPEC-self-serve-signup.md
// §4.4). This is the gate for confirmed sign-up links (§4.3): /auth/confirm
// cannot keep them shut, so nothing is created here unless the switch is on.
//
// Each step fails closed. A dependency failure (switch read, session, limiter,
// saving the password, provisioning) refuses with a visible message and our
// contact address and alerts the operator (§4.9). Ordinary mistakes (a field
// left out, the wrong email, a weak password) only show a message.
//
//   1. never on Vercel Preview (it writes to the live database);
//   2. the switch (unreadable counts as closed, and alerts);
//   3. the signed-in login, from the verified session (never the form), with
//      a confirmed email;
//   4. 10 attempts an hour per login;
//   5. the fields, and the typed email must be the login's (§4.3);
//   6. the password and name (auth.updateUser, safe to repeat);
//   7. public.provision_self_serve_brand: one transaction, under the sign-up
//      row lock, re-checking everything (a double submit, refresh or second
//      tab gets the same brand back);
//   8. for a new brand only: admin_audit (ids only) and the operator's email,
//      neither of which ever blocks the customer; then Billing.
// ---------------------------------------------------------------------------

export interface CreateVenueResult {
  success?: boolean;
  error?: string;
  /** Where the browser goes next (a same-origin path). */
  next?: string;
}

const logger = createLogger('signup');

type UpdateUserError = { status?: number; code?: string; message?: string };

function isWeakPassword(error: UpdateUserError): boolean {
  return error.code === 'weak_password';
}

/** A repeat submit: Supabase refuses to "change" a password to the one it already has. */
function isSamePassword(error: UpdateUserError): boolean {
  return error.code === 'same_password';
}

type SaveOutcome = { status: 'saved' } | { status: 'weak' } | { status: 'failed'; error: string };

/** Sets the password and the name (user metadata full_name) on the signed-in login. */
async function savePasswordAndName(password: string, fullName: string): Promise<SaveOutcome> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password, data: { full_name: fullName } });
    if (!error) return { status: 'saved' };
    if (isWeakPassword(error)) return { status: 'weak' };
    if (isSamePassword(error)) {
      // The password is already this one (the first submit saved it): save the name alone.
      const { error: nameError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
      if (!nameError) return { status: 'saved' };
      return { status: 'failed', error: `updateUser (name): ${nameError.code ?? nameError.status ?? ''} ${nameError.message}` };
    }
    return { status: 'failed', error: `updateUser: ${error.code ?? error.status ?? ''} ${error.message}` };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Step 8: the record and the operator's email. Never throws; a failure alerts. */
async function announceNewVenue(user: SignedInUser, form: VenueForm, accountId: string, createdAt: Date): Promise<void> {
  try {
    await logAdminEvent({
      actorUserId: user.id,
      action: 'self_serve_venue_created',
      targetUserId: user.id,
      targetAccountId: accountId,
    });
  } catch (error) {
    logger.error('could not record the new self-serve venue in admin_audit', error instanceof Error ? error : undefined, { accountId });
    await reportSignupFailure('venue_notice', new Error(`admin_audit insert failed for brand ${accountId}`));
  }

  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) {
    logger.error('OPERATOR_ALERT_EMAIL is not set; the new-venue email was not sent', undefined, { accountId });
    return;
  }
  try {
    const typeLabel = VENUE_TYPES.find((type) => type.value === form.venueType)?.label ?? form.venueType;
    const message = renderNewVenueOperatorEmail({
      venueName: form.venueName,
      venueTypeLabel: typeLabel,
      signupEmail: user.email,
      createdAt,
      accountId,
      adminUrl: new URL('/admin', env.client.NEXT_PUBLIC_SITE_URL).toString(),
    });
    await sendEmail({ to, subject: message.subject, html: message.html, required: true });
  } catch (error) {
    logger.error('could not email the operator about a new self-serve venue', error instanceof Error ? error : undefined, { accountId });
    await reportSignupFailure('venue_notice', new Error(`new-venue email failed for brand ${accountId}`));
  }
}

function refusal(outcome: ProvisionRefusal): CreateVenueResult | null {
  switch (outcome.status) {
    case 'closed':
      return { error: VENUE_MESSAGES.notOpen };
    case 'member':
      return { error: VENUE_MESSAGES.member };
    case 'venue_closed':
      return { error: VENUE_MESSAGES.venueClosed };
    case 'no_login':
      return { error: VENUE_MESSAGES.signedOut };
    default:
      // email_mismatch: the app already matched the form to the session, so
      // the login's stored email disagreeing is a fault on our side.
      return null;
  }
}

export async function createSelfServeVenue(formData: FormData): Promise<CreateVenueResult> {
  // 1. Never on Vercel Preview: it writes to the live database.
  if (env.server.VERCEL_ENV === 'preview') return { error: VENUE_MESSAGES.preview };

  // 2. The switch. Anything but open counts as closed; a failed read also alerts.
  const state = await getSelfServeSignupSwitch();
  if (state === 'unavailable') {
    await reportSignupFailure('switch', new Error('app_flags.self_serve_signup could not be read (venue set-up)'));
    return { error: VENUE_MESSAGES.couldNotFinish };
  }
  if (state !== 'open') return { error: VENUE_MESSAGES.notOpen };

  // 3. The signed-in login, from the verified session.
  const login = await readSignedInLogin();
  if (login.status === 'unavailable') {
    await reportSignupFailure('session', new Error(login.error));
    return { error: VENUE_MESSAGES.couldNotFinish };
  }
  if (login.status === 'signed_out') return { error: VENUE_MESSAGES.signedOut };
  const { user } = login;
  if (!user.emailConfirmed || !user.email) return { error: VENUE_MESSAGES.unconfirmed };

  // 4. 10 attempts an hour per login.
  try {
    const limit = await consumeAuthRateLimit('signup_venue', {
      email: '',
      ip: clientIpFromHeaders(await headers()),
      userId: user.id,
    });
    if (limit.status === 'limited') {
      return { error: VENUE_MESSAGES.tooManyAttempts(Math.max(1, Math.ceil(limit.retryAfterSeconds / 60))) };
    }
  } catch (error) {
    await reportSignupFailure('rate_limiter', error);
    return { error: VENUE_MESSAGES.couldNotFinish };
  }

  // 5. The fields. The typed email must be the login's (spec §4.3).
  const parsed = venueFormSchema.safeParse(readVenueForm(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? VENUE_MESSAGES.couldNotFinish };
  const form = parsed.data;
  if (form.email !== user.email) return { error: VENUE_MESSAGES.emailMismatch(user.email) };

  // 6. The password and name. Safe to repeat.
  const saved = await savePasswordAndName(form.password, form.fullName);
  if (saved.status === 'weak') return { error: VENUE_MESSAGES.weakPassword };
  if (saved.status === 'failed') {
    await reportSignupFailure('account_update', new Error(saved.error));
    return { error: VENUE_MESSAGES.couldNotFinish };
  }

  // 7. The brand, in one transaction under the sign-up row lock.
  let outcome: ProvisionOutcome;
  const createdAt = new Date();
  try {
    outcome = await provisionSelfServeBrand(createServiceSupabaseClient(), {
      userId: user.id,
      venueName: form.venueName,
      businessType: storedBusinessType(form.venueType),
      email: user.email,
      legalVersion: LEGAL_VERSION,
    });
  } catch (error) {
    await reportSignupFailure('provisioning', error);
    return { error: VENUE_MESSAGES.couldNotFinish };
  }

  if (!isProvisioned(outcome)) {
    const answer = refusal(outcome);
    if (answer) return answer;
    await reportSignupFailure('provisioning', new Error(`provision_self_serve_brand answered ${outcome.status}`));
    return { error: VENUE_MESSAGES.couldNotFinish };
  }

  logger.info('self-serve venue', { status: outcome.status, accountId: outcome.accountId });
  // 8. Only the call that made the brand announces it.
  if (outcome.status === 'created') await announceNewVenue(user, form, outcome.accountId, createdAt);
  return { success: true, next: BILLING_SETUP_PATH };
}
