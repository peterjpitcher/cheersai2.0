'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { env } from '@/env';
import { consumeAuthRateLimit, clientIpFromHeaders } from '@/lib/auth/rate-limit';
import { buildAuthConfirmUrl, renderInviteEmail, SIGNUP_VENUE_PATH } from '@/lib/auth/email-links';
import { sendEmail } from '@/lib/email/resend';
import { CONTACT } from '@/lib/legal/company';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure, type SignupFailureKind } from '@/lib/signup/alerts';
import { renderExistingLoginEmail, renderSignupConfirmEmail } from '@/lib/signup/emails';
import { SIGNUP_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { TURNSTILE_RESPONSE_FIELD, turnstileRemoteIp, verifyTurnstileToken } from '@/lib/signup/turnstile';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// requestSignup: the /signup form (tasks/SPEC-self-serve-signup.md §4.2).
//
// Every step fails closed. A dependency failure (switch read, Turnstile,
// limiter, lookup, generateLink, the sign-up record, Resend) and the
// site-wide email ceiling refuse with a visible message and alert the
// operator (§4.9). Ordinary mistakes (a bad email, a failed bot check) only
// show a message.
//
// Whatever the email, a request that gets past those checks answers
// { success: true } and the page shows the same "Check your email" screen, so
// the form never reveals who has a login:
//   no login                              -> sign-up link, sign-up row
//   login, unconfirmed, no brand          -> new sign-up link, same sign-up row
//   login, unconfirmed, has a brand       -> their member invite again, no sign-up row
//   login, confirmed                      -> "you already have a login" email
//   over the per-email or per-IP limit    -> nothing sent
// ---------------------------------------------------------------------------

export interface SignupRequestResult {
  success?: boolean;
  error?: string;
}

const logger = createLogger('signup');

const emailSchema = z.string().trim().toLowerCase().max(254).email(SIGNUP_MESSAGES.invalidEmail);

type Outcome = 'new' | 'repeat' | 'member_invite' | 'existing_login' | 'limited';

/** Thrown inside the request to refuse it with an alert of the given kind. */
class SignupDependencyError extends Error {
  constructor(
    readonly kind: SignupFailureKind,
    message: string,
  ) {
    super(message);
  }
}

function errorText(error: { status?: number; code?: string; message?: string } | null | undefined): string {
  if (!error) return 'no data returned';
  return `${error.code ?? error.status ?? ''} ${error.message ?? ''}`.trim();
}

interface ExistingLogin {
  userId: string;
  confirmed: boolean;
  brandNames: string[];
  hasBrand: boolean;
}

/** The login for this email, if any, with its confirmation and brands (service role, scoped by user id). */
async function findExistingLogin(email: string): Promise<ExistingLogin | null> {
  const service = createServiceSupabaseClient();
  const { data: snapshot, error: snapshotError } = await service
    .from('user_auth_snapshot')
    .select('user_id')
    .eq('email', email)
    .maybeSingle<{ user_id: string }>();
  if (snapshotError) throw new SignupDependencyError('lookup', `user_auth_snapshot: ${errorText(snapshotError)}`);
  if (!snapshot) return null;

  const userId = snapshot.user_id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
  if (userError || !userData?.user) throw new SignupDependencyError('lookup', `getUserById: ${errorText(userError)}`);

  const { data: memberships, error: memberError } = await service
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId);
  if (memberError) throw new SignupDependencyError('lookup', `account_members: ${errorText(memberError)}`);
  const accountIds = ((memberships ?? []) as Array<{ account_id: string }>).map((row) => row.account_id);

  let brandNames: string[] = [];
  if (accountIds.length > 0) {
    const { data: brands, error: brandError } = await service.from('accounts').select('business_name').in('id', accountIds);
    if (brandError) throw new SignupDependencyError('lookup', `accounts: ${errorText(brandError)}`);
    brandNames = ((brands ?? []) as Array<{ business_name: string | null }>)
      .map((row) => row.business_name ?? '')
      .filter((name) => name.trim().length > 0);
  }

  return { userId, confirmed: Boolean(userData.user.email_confirmed_at), brandNames, hasBrand: accountIds.length > 0 };
}

/** A new link for an unconfirmed login, or a new login with no password. Replaces any earlier link. */
async function generateInviteLink(email: string): Promise<{ userId: string; tokenHash: string }> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service.auth.admin.generateLink({ type: 'invite', email });
  const tokenHash = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || !tokenHash || !userId) throw new SignupDependencyError('generate_link', `generateLink: ${errorText(error)}`);
  return { userId, tokenHash };
}

/** One self_serve_signups row per login: inserted, or its last_requested_at and request_count moved on. */
async function recordSignupRequest(userId: string): Promise<void> {
  const service = createServiceSupabaseClient();
  const { error } = await service.rpc('record_self_serve_signup_request', { p_user_id: userId });
  if (error) throw new SignupDependencyError('database', `record_self_serve_signup_request: ${errorText(error)}`);
}

async function send(email: string, message: { subject: string; html: string }): Promise<void> {
  try {
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
  } catch (error) {
    throw new SignupDependencyError('email', error instanceof Error ? error.message : String(error));
  }
}

async function fulfil(email: string, ip: string): Promise<Outcome> {
  // Per-email and per-IP limits: over them, nothing is sent, and the page
  // looks the same as when something was.
  let limit;
  try {
    limit = await consumeAuthRateLimit('signup_request', { email, ip });
  } catch (error) {
    throw new SignupDependencyError('rate_limiter', error instanceof Error ? error.message : String(error));
  }
  if (limit.status === 'limited') return 'limited';

  // Site-wide ceiling on sign-up emails: protects the shared sender.
  let site;
  try {
    site = await consumeAuthRateLimit('signup_email_site', { email, ip });
  } catch (error) {
    throw new SignupDependencyError('rate_limiter', error instanceof Error ? error.message : String(error));
  }
  if (site.status === 'limited') {
    throw new SignupDependencyError('site_limit', 'more than 60 sign-up emails this hour');
  }

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  const existing = await findExistingLogin(email);

  if (existing?.confirmed) {
    await send(
      email,
      renderExistingLoginEmail({
        loginUrl: new URL('/login', siteUrl).toString(),
        resetUrl: new URL('/forgot-password', siteUrl).toString(),
        contactEmail: CONTACT.email,
      }),
    );
    return 'existing_login';
  }

  if (existing?.hasBrand) {
    // Invited by the operator or an owner and never accepted: send that
    // invite again. No sign-up row: this person is a member, not a new venue.
    const { tokenHash } = await generateInviteLink(email);
    const link = buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'invite' });
    await send(email, renderInviteEmail({ link, brandNames: existing.brandNames }));
    return 'member_invite';
  }

  const { userId, tokenHash } = await generateInviteLink(email);
  await recordSignupRequest(userId);
  const link = buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'signup', next: SIGNUP_VENUE_PATH });
  await send(email, renderSignupConfirmEmail({ link, signupUrl: new URL('/signup', siteUrl).toString() }));
  return existing ? 'repeat' : 'new';
}

export async function requestSignup(formData: FormData): Promise<SignupRequestResult> {
  // 1. Never on Vercel Preview: it writes to the live database.
  if (env.server.VERCEL_ENV === 'preview') return { error: SIGNUP_MESSAGES.preview };

  // 1. The switch. Anything but open counts as closed; a failed read also alerts.
  const state = await getSelfServeSignupSwitch();
  if (state === 'unavailable') {
    await reportSignupFailure('switch', new Error('app_flags.self_serve_signup could not be read'));
    return { error: SIGNUP_MESSAGES.notOpen };
  }
  if (state !== 'open') return { error: SIGNUP_MESSAGES.notOpen };

  // 2. The email.
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) return { error: SIGNUP_MESSAGES.invalidEmail };
  const email = parsed.data;

  // 3. Turnstile, checked by our server.
  const requestHeaders = await headers();
  const token = formData.get(TURNSTILE_RESPONSE_FIELD);
  const check = await verifyTurnstileToken({
    token: typeof token === 'string' ? token : null,
    remoteIp: turnstileRemoteIp(requestHeaders),
  });
  if (check.status === 'failed') return { error: SIGNUP_MESSAGES.botCheckFailed };
  if (check.status === 'unavailable') {
    await reportSignupFailure('turnstile', new Error(check.reason));
    return { error: SIGNUP_MESSAGES.couldNotFinish };
  }

  // 4 and 5. Limits, lookup, link, record, email.
  try {
    const outcome = await fulfil(email, clientIpFromHeaders(requestHeaders));
    logger.info('sign-up request handled', { outcome });
    return { success: true };
  } catch (error) {
    const kind = error instanceof SignupDependencyError ? error.kind : 'unexpected';
    await reportSignupFailure(kind, error);
    return { error: SIGNUP_MESSAGES.couldNotFinish };
  }
}
