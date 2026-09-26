'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { env } from '@/env';
import { ACTIVE_BRAND_COOKIE, activeBrandCookieOptions } from '@/lib/auth/active-brand';
import { checkAuthRateLimit } from '@/lib/auth/rate-limit';
import { getCurrentUser } from '@/lib/auth/server';
import { isUnknownUserOtpError } from '@/lib/auth/otp-errors';
import { buildAuthConfirmUrl, renderPasswordResetEmail } from '@/lib/auth/email-links';
import { destinationAfterPasswordSet } from '@/lib/billing/setup-redirect';
import { sendEmail } from '@/lib/email/resend';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(1, 'Password is required');

/**
 * Send a magic link to the given email address.
 * Rate-limited: 5 attempts per 60 seconds per email.
 */
export async function sendMagicLink(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const rawEmail = formData.get('email');
  const emailResult = emailSchema.safeParse(rawEmail);

  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? 'Invalid email address' };
  }

  const email = emailResult.data.trim().toLowerCase();

  // Rate limit check (AUTH-08)
  const rateLimit = await checkAuthRateLimit(email);
  if (!rateLimit.allowed) {
    return { error: 'Too many attempts. Please try again later.' };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const siteUrl = env.client.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    // shouldCreateUser: false -- logins are only created by invite (and, later,
    // by the sign-up flow). Without it any email address would get a login with
    // no brand. An unknown email gets the same response as a known one so the
    // form does not reveal who has an account.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
        shouldCreateUser: false,
      },
    });

    if (error && isUnknownUserOtpError(error)) {
      return { success: true };
    }

    if (error) {
      console.error('[auth] sendMagicLink error:', error.message);
      return { error: 'Failed to send magic link. Please try again.' };
    }

    return { success: true };
  } catch (error) {
    console.error('[auth] sendMagicLink unexpected error:', error);
    return { error: 'Failed to send magic link. Please try again.' };
  }
}

/**
 * Sign in with email and password.
 * Rate-limited: 5 attempts per 60 seconds per email.
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

  // Rate limit check (AUTH-08)
  const rateLimit = await checkAuthRateLimit(email);
  if (!rateLimit.allowed) {
    return { error: 'Too many attempts. Please try again later.' };
  }

  try {
    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('[auth] signInWithPassword error:', error.message);
      return { error: 'Invalid email or password.' };
    }

    return { success: true };
  } catch (error) {
    console.error('[auth] signInWithPassword unexpected error:', error);
    return { error: 'Sign in failed. Please try again.' };
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
 * Unknown emails get the same response as known ones.
 */
export async function requestPasswordReset(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const emailResult = emailSchema.safeParse(formData.get('email'));
  if (!emailResult.success) {
    return { error: emailResult.error.issues[0]?.message ?? 'Invalid email address' };
  }
  const email = emailResult.data.trim().toLowerCase();

  const rateLimit = await checkAuthRateLimit(email);
  if (!rateLimit.allowed) {
    return { error: 'Too many attempts. Please try again later.' };
  }

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    console.error('[auth] requestPasswordReset: NEXT_PUBLIC_SITE_URL is not set');
    return { error: 'We could not send the email. Please try again shortly.' };
  }

  try {
    const service = createServiceSupabaseClient();
    const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      // Unknown email (or no login): say nothing different.
      return { success: true };
    }

    const link = buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'recovery' });
    const message = renderPasswordResetEmail({ link });
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
    return { success: true };
  } catch (error) {
    console.error('[auth] requestPasswordReset failed:', error instanceof Error ? error.message : error);
    return { error: 'We could not send the email. Please try again shortly.' };
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
