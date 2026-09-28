'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { env } from '@/env';
import { ACTIVE_BRAND_COOKIE, activeBrandCookieOptions } from '@/lib/auth/active-brand';
import { reportAuthFailure } from '@/lib/auth/alerts';
import { checkAuthRateLimit, clientIpFromHeaders, type AuthRateLimitAction } from '@/lib/auth/rate-limit';
import { getCurrentUser } from '@/lib/auth/server';
import {
  buildAuthConfirmUrl,
  DEFAULT_SIGNED_IN_PATH,
  renderMagicLinkEmail,
  renderPasswordResetEmail,
  safeNextPath,
} from '@/lib/auth/email-links';
import { destinationAfterPasswordSet } from '@/lib/billing/setup-redirect';
import { sendEmail } from '@/lib/email/resend';
import { CONTACT } from '@/lib/legal/company';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(1, 'Password is required');

/** Shown when a dependency (the rate limiter, Supabase Auth, email) fails: the request is refused, never waved through. */
const COULD_NOT_FINISH = `We could not finish this. Please try again in a minute, or email ${CONTACT.email}.`;

/**
 * Count this attempt against the database rate limits (spec §4.11) and turn a
 * refusal into the message the form shows. Returns null when it may go ahead.
 * A limiter failure refuses the request (fail closed); the operator has
 * already been told by checkAuthRateLimit.
 */
async function rateLimitRefusal(action: AuthRateLimitAction, email: string): Promise<string | null> {
  const ip = clientIpFromHeaders(await headers());
  const decision = await checkAuthRateLimit(action, { email, ip });
  if (decision.status === 'allowed') return null;
  if (decision.status === 'unavailable') return COULD_NOT_FINISH;
  if (action === 'password_sign_in') return 'Too many sign-in attempts. Please wait a minute and try again.';
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  return `Too many requests. Please try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * A wrong email or password (Supabase answers 400). Anything else, such as a
 * network failure (status 0), Supabase's own rate limit (429) or an outage
 * (5xx), is a dependency failure: refused and reported, not blamed on the user.
 */
function isWrongCredentials(error: { status?: number; code?: string }): boolean {
  return error.status === 400 || error.code === 'invalid_credentials' || error.code === 'email_not_confirmed';
}

/**
 * Supabase Auth's answer for a login that does not exist (generateLink
 * recovery or getUserById): 404 user_not_found. Anything else is a failure.
 */
function isUnknownUserError(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === 'user_not_found';
}

function describeAuthError(error: { status?: number; code?: string; message: string }): string {
  return `${error.code ?? error.status ?? ''} ${error.message}`;
}

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/**
 * The login a magic link may go to: one whose email is exactly this address
 * and confirmed. Null for an unknown address and for an unconfirmed login (a
 * pending invite or sign-up, which must go through its own link). Asked first
 * because generateLink type 'magiclink' creates a login for an unknown
 * address. The address is looked up in public.user_auth_snapshot, the
 * trigger-kept mirror of auth.users that team invites use, and the login's
 * confirmation comes from the Auth admin API (service role cannot read
 * auth.users). Throws when either lookup fails.
 */
async function magicLinkLoginId(service: ServiceClient, email: string): Promise<string | null> {
  const { data: snapshot, error: snapshotError } = await service
    .from('user_auth_snapshot')
    .select('user_id')
    .eq('email', email)
    .maybeSingle<{ user_id: string }>();
  if (snapshotError) throw new Error(`user_auth_snapshot lookup failed: ${snapshotError.message}`);
  if (!snapshot) return null;

  const { data, error } = await service.auth.admin.getUserById(snapshot.user_id);
  // A snapshot row that outlived its login: nobody to send to.
  if (error && isUnknownUserError(error)) return null;
  if (error || !data?.user) throw new Error(`getUserById: ${error ? describeAuthError(error) : 'no user returned'}`);

  const user = data.user;
  if (user.email?.toLowerCase() !== email || !user.email_confirmed_at) return null;
  return user.id;
}

/**
 * Email a magic link. The link is generated server-side and sent through
 * Resend (not Supabase's mailer or template), like resets and invites, and
 * lands on /auth/confirm, whose button signs the person in.
 *
 * A magic link never creates a login: an unknown address or an unconfirmed
 * login gets nothing, and the same answer as a known one, so the form does
 * not reveal who has an account. As with resets, a known address takes longer
 * to answer because an email is sent; the rate limits bound what that shows.
 * Rate-limited in the database: 3 an hour per email, 10 an hour per IP.
 */
export async function sendMagicLink(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const emailResult = emailSchema.safeParse(formData.get('email'));
  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? 'Invalid email address' };
  }
  const email = emailResult.data.trim().toLowerCase();
  const rawNext = formData.get('next');
  const next = safeNextPath(typeof rawNext === 'string' ? rawNext : null, DEFAULT_SIGNED_IN_PATH);

  const refusal = await rateLimitRefusal('magic_link', email);
  if (refusal) return { error: refusal };

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    await reportAuthFailure('magic_link', new Error('NEXT_PUBLIC_SITE_URL is not set'));
    return { error: COULD_NOT_FINISH };
  }

  try {
    const service = createServiceSupabaseClient();
    const loginId = await magicLinkLoginId(service, email);
    // Unknown address or unconfirmed login: send nothing, say nothing different.
    if (!loginId) return { success: true };

    const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      throw new Error(`generateLink: ${error ? describeAuthError(error) : 'no token returned'}`);
    }
    // Only the login checked above; a new one appears only if that login was
    // deleted in the moment between the two calls. Never email that link.
    if (data.user?.id !== loginId || data.properties.verification_type !== 'magiclink') {
      throw new Error(`generateLink answered for another login (verification type ${data.properties.verification_type})`);
    }

    const link = buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'magiclink', next });
    const message = renderMagicLinkEmail({ link });
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
    return { success: true };
  } catch (error) {
    await reportAuthFailure('magic_link', error);
    return { error: COULD_NOT_FINISH };
  }
}

/**
 * Sign in with email and password.
 * Rate-limited in the database: 5 a minute per email and IP pair, 20 a minute per IP.
 */
export async function signInWithPassword(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');

  const emailResult = emailSchema.safeParse(rawEmail);
  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? 'Invalid email address' };
  }

  const passwordResult = passwordSchema.safeParse(rawPassword);
  if (!passwordResult.success) {
    return { error: passwordResult.error.issues[0]?.message ?? 'Password is required' };
  }

  const email = emailResult.data.trim().toLowerCase();
  const password = passwordResult.data;

  const refusal = await rateLimitRefusal('password_sign_in', email);
  if (refusal) return { error: refusal };

  try {
    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error && isWrongCredentials(error)) {
      return { error: 'Invalid email or password.' };
    }

    if (error) {
      await reportAuthFailure('sign_in', new Error(`signInWithPassword: ${error.code ?? error.status ?? ''} ${error.message}`));
      return { error: COULD_NOT_FINISH };
    }

    return { success: true };
  } catch (error) {
    await reportAuthFailure('sign_in', error);
    return { error: COULD_NOT_FINISH };
  }
}

const MIN_PASSWORD_LENGTH = 12;

const newPasswordSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(72),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { message: 'The passwords do not match.' });

/**
 * Set or change the signed-in user's password. Used after accepting an invite
 * and after following a password reset link (both land here signed in).
 */
export async function setPassword(
  formData: FormData,
): Promise<{ success?: boolean; error?: string; next?: string }> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid password.' };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: 'Your link has expired. Ask for a new one and try again.' };
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      console.error('[auth] setPassword error:', error.message);
      return { error: 'Could not save your password. Please try again.' };
    }
    // An invited owner whose brand has not set up billing goes to Billing next (spec §4.4).
    return { success: true, next: await destinationAfterPasswordSet() };
  } catch (error) {
    console.error('[auth] setPassword unexpected error:', error);
    return { error: 'Could not save your password. Please try again.' };
  }
}

/**
 * Email a password reset link. The link is generated server-side and sent
 * through Resend (not the Supabase template), so its format is ours.
 * Unknown emails get the same response as known ones. Also the way to get a
 * new link when an invite has expired: a recovery link confirms the login too.
 * Rate-limited in the database: 3 an hour per email, 10 an hour per IP.
 */
export async function requestPasswordReset(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const emailResult = emailSchema.safeParse(formData.get('email'));
  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? 'Invalid email address' };
  }
  const email = emailResult.data.trim().toLowerCase();

  const refusal = await rateLimitRefusal('password_reset', email);
  if (refusal) return { error: refusal };

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    await reportAuthFailure('password_reset', new Error('NEXT_PUBLIC_SITE_URL is not set'));
    return { error: COULD_NOT_FINISH };
  }

  try {
    const service = createServiceSupabaseClient();
    const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
    if (error && isUnknownUserError(error)) {
      // No login for this email: say nothing different.
      return { success: true };
    }
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      throw new Error(`generateLink: ${error ? `${error.code ?? error.status ?? ''} ${error.message}` : 'no token returned'}`);
    }

    const link = buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'recovery' });
    const message = renderPasswordResetEmail({ link });
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
    return { success: true };
  } catch (error) {
    await reportAuthFailure('password_reset', error);
    return { error: COULD_NOT_FINISH };
  }
}

/**
 * Sign out the current user, clear the active-brand cookie, and redirect.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(ACTIVE_BRAND_COOKIE);
  redirect('/login');
}

/**
 * Switch the active brand. Re-verifies the user is a member of the target brand
 * server-side (never trusts the client value), sets the active-brand cookie,
 * and revalidates the layout so every server component re-renders for the new
 * brand.
 */
export async function switchActiveBrand(
  accountId: string,
): Promise<{ success?: boolean; error?: string }> {
  const parsed = z.string().uuid().safeParse(accountId);
  if (!parsed.success) {
    return { error: 'Invalid brand.' };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: 'Not authenticated.' };
  }

  const isMember = user.brands.some((brand) => brand.accountId === parsed.data);
  if (!isMember) {
    return { error: 'You do not have access to that brand.' };
  }

  const store = await cookies();
  store.set(ACTIVE_BRAND_COOKIE, parsed.data, activeBrandCookieOptions());
  revalidatePath('/', 'layout');
  return { success: true };
}
