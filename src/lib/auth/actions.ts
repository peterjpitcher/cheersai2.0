'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { env } from '@/env';
import { checkAuthRateLimit } from '@/lib/auth/rate-limit';
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
 * Sign out the current user and redirect to login.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}
