'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { env } from '@/env';
import { consumeAuthRateLimit, clientIpFromHeaders, peekAuthRateLimit } from '@/lib/auth/rate-limit';
import { buildAuthConfirmUrl, renderInviteEmail, SIGNUP_VENUE_PATH } from '@/lib/auth/email-links';
import { sendEmail } from '@/lib/email/resend';
import { CONTACT } from '@/lib/legal/company';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure, type SignupFailureKind } from '@/lib/signup/alerts';
import { renderExistingLoginEmail, renderSignupConfirmEmail } from '@/lib/signup/emails';
import { SIGNUP_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { TURNSTILE_RESPONSE_FIELD, turnstileRemoteIp, verifyTurnstileToken } from '@/lib/signup/turnstile';
import { isTurnstileSetupFailure } from '@/lib/signup/turnstile-errors';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// requestSignup: the /signup form (tasks/SPEC-self-serve-signup.md §4.2).
//
// Every step fails closed. A dependency failure (switch read, Turnstile,
// limiter, generateLink, the membership lookup, the sign-up record, Resend)
// and the site-wide email ceiling refuse with a visible message and alert the
// operator (§4.9). Ordinary mistakes (a bad email, a failed bot check, an
// address Supabase will not accept) only show a message.
//
// Every address goes through the same first step, generateLink type 'invite'.
// Supabase checks the address before it looks for a login, and refuses a
// confirmed login without changing anything, so the answer never depends on
// who has a login. Whatever the email, a request that gets past the checks
// answers { success: true } and the page shows the same "Check your email"
// screen:
//   no login, or unconfirmed with no brand   -> sign-up link, one sign-up row
//   unconfirmed, member or invited to a brand -> their invite again, naming the brand, no sign-up row
//   confirmed (Supabase: email_exists)        -> "you already have a login" email
//   over the per-email or per-IP limit        -> nothing sent
// ---------------------------------------------------------------------------

export interface SignupRequestResult {
  success?: boolean;
  error?: string;
}

const logger = createLogger('signup');

const emailSchema = z.string().trim().toLowerCase().max(254).email(SIGNUP_MESSAGES.invalidEmail);

type Outcome = 'signup' | 'member_invite' | 'existing_login' | 'limited' | 'invalid_address';

/** Thrown inside the request to refuse it with an alert of the given kind. */
class SignupDependencyError extends Error {
  constructor(
    readonly kind: SignupFailureKind,
    message: string,
  ) {
    super(message);
  }
}

type AuthErrorLike = { status?: number; code?: string; message?: string };

function errorText(error: AuthErrorLike | null | undefined): string {
  if (!error) return 'no data returned';
  return `${error.code ?? error.status ?? ''} ${error.message ?? ''}`.trim();
}

/**
 * Supabase refused the address itself (its format or its domain), not a
 * dependency failure: the visitor is asked for a valid address, with no alert.
 * Checked on the local stack: "Unable to validate email address: invalid
 * format" answers 400 validation_failed. email_address_invalid is Supabase's
 * code for an address it will not accept (for example a domain that cannot
 * receive mail).
 */
function isAddressRefusal(error: AuthErrorLike): boolean {
  const addressCodes = ['validation_failed', 'email_address_invalid'];
  const status = error.status ?? 0;
  if (status !== 400 && status !== 422) return false;
  if (error.code) return addressCodes.includes(error.code);
  return /validate email address|email address .*invalid/i.test(error.message ?? '');
}

/** Supabase: the address already has a confirmed login (invite refused, nothing changed). */
function isConfirmedLogin(error: AuthErrorLike): boolean {
  if (error.code) return error.code === 'email_exists';
  return error.status === 422 && /already been registered/i.test(error.message ?? '');
}

type InviteLinkResult =
  | { status: 'link'; userId: string; tokenHash: string }
  | { status: 'invalid_address' }
  | { status: 'confirmed' };

/**
 * A new login with no password, or a new link for an unconfirmed one (which
 * replaces the earlier link). Refused, with nothing changed, for an address
 * Supabase will not accept or a login that is already confirmed.
 *
 * A 5xx is tried once more before it counts as an outage: two requests for
 * the same brand-new address at the same moment race on Supabase's unique
 * email index, and the loser's second try finds the new login and simply
 * makes a fresh link for it (only the newest link then works, the accepted
 * two-tab case in the spec).
 */
async function generateInviteLink(email: string): Promise<InviteLinkResult> {
  const service = createServiceSupabaseClient();
  type Answer = Awaited<ReturnType<typeof service.auth.admin.generateLink>>;
  const attempt = async (): Promise<Answer> => {
    try {
      return await service.auth.admin.generateLink({ type: 'invite', email });
    } catch (error) {
      throw new SignupDependencyError('generate_link', `generateLink threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  let answer = await attempt();
  if ((answer.error?.status ?? 0) >= 500) {
    logger.warn('generateLink answered a server error; trying once more', { status: answer.error?.status });
    answer = await attempt();
  }

  const { data, error } = answer;
  if (error && isAddressRefusal(error)) return { status: 'invalid_address' };
  if (error && isConfirmedLogin(error)) return { status: 'confirmed' };
  const tokenHash = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || !tokenHash || !userId) throw new SignupDependencyError('generate_link', `generateLink: ${errorText(error)}`);
  return { status: 'link', userId, tokenHash };
}

/**
 * The brands this login belongs to or has an open, unexpired team invitation
 * to (service role, scoped by user id). Either way the person was brought in
 * by a venue, so they get that venue's invite again, never a create-a-venue
 * link or a sign-up row.
 */
async function brandsOf(userId: string): Promise<{ hasBrand: boolean; brandNames: string[] }> {
  const service = createServiceSupabaseClient();
  const { data: memberships, error: memberError } = await service
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId);
  if (memberError) throw new SignupDependencyError('lookup', `account_members: ${errorText(memberError)}`);

  // An instant compared in the database, not a date shown to anyone.
  const now = new Date().toISOString();
  const { data: invitations, error: invitationError } = await service
    .from('team_invitations')
    .select('account_id')
    .eq('user_id', userId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', now);
  if (invitationError) throw new SignupDependencyError('lookup', `team_invitations: ${errorText(invitationError)}`);

  const accountIds = [
    ...new Set(
      [...((memberships ?? []) as Array<{ account_id: string }>), ...((invitations ?? []) as Array<{ account_id: string }>)].map(
        (row) => row.account_id,
      ),
    ),
  ];
  if (accountIds.length === 0) return { hasBrand: false, brandNames: [] };

  const { data: brands, error: brandError } = await service.from('accounts').select('business_name').in('id', accountIds);
  if (brandError) throw new SignupDependencyError('lookup', `accounts: ${errorText(brandError)}`);
  const brandNames = ((brands ?? []) as Array<{ business_name: string | null }>)
    .map((row) => row.business_name ?? '')
    .filter((name) => name.trim().length > 0);
  return { hasBrand: true, brandNames };
}

/** One self_serve_signups row per login: inserted, or its last_requested_at and request_count moved on. */
async function recordSignupRequest(userId: string): Promise<void> {
  const service = createServiceSupabaseClient();
  const { error } = await service.rpc('record_self_serve_signup_request', { p_user_id: userId });
  if (error) throw new SignupDependencyError('database', `record_self_serve_signup_request: ${errorText(error)}`);
}

async function limiter<T>(check: () => Promise<T>): Promise<T> {
  try {
    return await check();
  } catch (error) {
    throw new SignupDependencyError('rate_limiter', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Count one sign-up email against the site-wide ceiling, just before sending.
 * The ceiling was already checked (without counting) before anything was
 * created, so this only refuses when many requests arrive at the same moment.
 */
async function countSiteEmail(email: string, ip: string): Promise<void> {
  const site = await limiter(() => consumeAuthRateLimit('signup_email_site', { email, ip }));
  if (site.status === 'limited') throw new SignupDependencyError('site_limit', 'more than 60 sign-up emails this hour');
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
  const limit = await limiter(() => consumeAuthRateLimit('signup_request', { email, ip }));
  if (limit.status === 'limited') return 'limited';

  // Site-wide ceiling on sign-up emails (protects the shared sender): read
  // now, before anything is created, and counted only for an address
  // Supabase accepts, so a refused address never uses it up.
  const site = await limiter(() => peekAuthRateLimit('signup_email_site', { email, ip }));
  if (site.status === 'limited') throw new SignupDependencyError('site_limit', 'more than 60 sign-up emails this hour');

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  const link = await generateInviteLink(email);

  if (link.status === 'invalid_address') return 'invalid_address';

  if (link.status === 'confirmed') {
    await countSiteEmail(email, ip);
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

  const { hasBrand, brandNames } = await brandsOf(link.userId);
  if (hasBrand) {
    // A member, or invited to a brand by its owner, who never accepted: send
    // that invite again. No sign-up row: this person joins a venue, not a new one.
    await countSiteEmail(email, ip);
    await send(email, renderInviteEmail({ link: buildAuthConfirmUrl({ siteUrl, tokenHash: link.tokenHash, type: 'invite' }), brandNames }));
    return 'member_invite';
  }

  await recordSignupRequest(link.userId);
  await countSiteEmail(email, ip);
  const confirmUrl = buildAuthConfirmUrl({ siteUrl, tokenHash: link.tokenHash, type: 'signup', next: SIGNUP_VENUE_PATH });
  await send(email, renderSignupConfirmEmail({ link: confirmUrl, signupUrl: new URL('/signup', siteUrl).toString() }));
  return 'signup';
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

  // 4 and 5. Limits, link, lookup, record, email.
  try {
    const outcome = await fulfil(email, clientIpFromHeaders(requestHeaders));
    logger.info('sign-up request handled', { outcome });
    if (outcome === 'invalid_address') return { error: SIGNUP_MESSAGES.invalidEmail };
    return { success: true };
  } catch (error) {
    const kind = error instanceof SignupDependencyError ? error.kind : 'unexpected';
    await reportSignupFailure(kind, error);
    return { error: SIGNUP_MESSAGES.couldNotFinish };
  }
}

// ---------------------------------------------------------------------------
// reportTurnstileWidgetFailure: the browser tells us the Turnstile widget on
// /signup could not load or run (review of PR #144). Without it, a blocked
// Cloudflare script, a widget outage or a site key refused for the domain
// would lose every sign-up with nothing on our side. The visitor already sees
// an error with our email address; this only raises the operator alert.
//
// It is a public endpoint, so it trusts nothing it is sent: the reason must
// be one of three words and the Cloudflare error code digits only, nothing
// about the visitor is recorded, it does nothing unless the switch is on
// (never on Preview), and it counts 3 an hour per IP on top of the alert's
// own hourly dedupe and row cap.
// ---------------------------------------------------------------------------

const widgetFailureSchema = z.object({
  reason: z.enum(['script_load_failed', 'script_timeout', 'render_failed', 'widget_error']),
  code: z
    .string()
    .regex(/^\d{1,8}$/)
    .optional(),
});

export async function reportTurnstileWidgetFailure(input: unknown): Promise<void> {
  if (env.server.VERCEL_ENV === 'preview') return;
  const parsed = widgetFailureSchema.safeParse(input);
  if (!parsed.success) return;
  // Only failures that mean our set-up is broken (the form filters the same way).
  if (!isTurnstileSetupFailure(parsed.data.reason, parsed.data.code)) return;
  if ((await getSelfServeSignupSwitch()) !== 'open') return;

  const ip = clientIpFromHeaders(await headers());
  try {
    const limit = await consumeAuthRateLimit('signup_widget_report', { email: '', ip });
    if (limit.status === 'limited') return;
  } catch (error) {
    // Without the limiter it cannot be kept from flooding alerts, so it stays quiet;
    // a limiter outage is reported by every other sign-up and sign-in path.
    logger.warn('Turnstile widget report skipped: rate limiter unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const { reason, code } = parsed.data;
  await reportSignupFailure(
    'turnstile_widget',
    new Error(`Turnstile widget failed in the browser: ${reason}${code ? ` (Cloudflare error code ${code})` : ''}`),
  );
}
