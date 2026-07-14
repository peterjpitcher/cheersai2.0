'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { env } from '@/env';
import { ACTIVE_BRAND_COOKIE, activeBrandCookieOptions } from '@/lib/auth/active-brand';
import { checkAuthRateLimit } from '@/lib/auth/rate-limit';
import { getCurrentUser } from '@/lib/auth/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

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
