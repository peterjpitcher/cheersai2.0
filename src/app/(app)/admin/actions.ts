'use server';

import { IANAZone } from 'luxon';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

type ActionResult = { success?: boolean; error?: string };

/**
 * Resolve an auth context and require the caller be a global super-admin.
 * Returns null (never throws) when the caller is authenticated but not an admin,
 * so callers can surface a Forbidden result rather than a redirect.
 */
async function requireSuperAdmin(): Promise<AuthContext | null> {
  const ctx = await requireAuthContext();
  return ctx.isSuperAdmin ? ctx : null;
}

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// createBrand
// ---------------------------------------------------------------------------

const createBrandSchema = z.object({
  name: z.string().trim().min(1, 'Brand name is required').max(120),
  email: z.string().trim().email('A valid contact email is required'),
  timezone: z
    .string()
    .trim()
    .default(DEFAULT_TIMEZONE)
    .refine((tz) => IANAZone.isValidZone(tz), 'Invalid timezone'),
});

export async function createBrand(input: {
  name: string;
  email: string;
  timezone?: string;
}): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };

  const parsed = createBrandSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid brand details.' };
  }

  const { data, error } = await ctx.supabase
    .from('accounts')
    .insert({
      business_name: parsed.data.name,
      email: parsed.data.email,
      timezone: parsed.data.timezone,
      created_by_user_id: ctx.user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    return { error: 'Could not create the brand.' };
  }

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'create_brand',
    targetAccountId: data.id,
    detail: { name: parsed.data.name, timezone: parsed.data.timezone },
  });
  revalidatePath('/admin');
  return { success: true };
}

// ---------------------------------------------------------------------------
// assign / revoke membership
// ---------------------------------------------------------------------------

export async function assignMembership(userId: string, accountId: string): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(userId).success || !uuid.safeParse(accountId).success) {
    return { error: 'Invalid user or brand.' };
  }

  const { error } = await ctx.supabase
    .from('account_members')
    .upsert(
      { account_id: accountId, user_id: userId, created_by: ctx.user.id },
      { onConflict: 'account_id,user_id' },
    );
  if (error) return { error: 'Could not grant access.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'assign_member',
    targetUserId: userId,
    targetAccountId: accountId,
  });
  revalidatePath('/admin');
  return { success: true };
}

export async function revokeMembership(userId: string, accountId: string): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(userId).success || !uuid.safeParse(accountId).success) {
    return { error: 'Invalid user or brand.' };
  }

  const { error } = await ctx.supabase
    .from('account_members')
    .delete()
    .eq('account_id', accountId)
    .eq('user_id', userId);
  if (error) return { error: 'Could not revoke access.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'revoke_member',
    targetUserId: userId,
    targetAccountId: accountId,
  });
  revalidatePath('/admin');
  return { success: true };
}

// ---------------------------------------------------------------------------
// setSuperAdmin (with last-admin protection)
// ---------------------------------------------------------------------------

export async function setSuperAdmin(userId: string, makeAdmin: boolean): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(userId).success) return { error: 'Invalid user.' };

  if (makeAdmin) {
    const { error } = await ctx.supabase
      .from('app_admins')
      .upsert({ user_id: userId, created_by: ctx.user.id }, { onConflict: 'user_id' });
    if (error) return { error: 'Could not grant admin.' };
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'grant_admin', targetUserId: userId });
    revalidatePath('/admin');
    return { success: true };
  }

  // Revoking: block removal of the last remaining administrator (lockout guard).
  const { count, error: countError } = await ctx.supabase
    .from('app_admins')
    .select('user_id', { count: 'exact', head: true });
  if (countError) return { error: 'Could not verify administrators.' };
  if ((count ?? 0) <= 1) {
    return { error: 'Cannot remove the last administrator.' };
  }

  const { error } = await ctx.supabase.from('app_admins').delete().eq('user_id', userId);
  if (error) return { error: 'Could not revoke admin.' };
  await logAdminEvent({ actorUserId: ctx.user.id, action: 'revoke_admin', targetUserId: userId });
  revalidatePath('/admin');
  return { success: true };
}

// ---------------------------------------------------------------------------
// inviteUser (new users) -- assigns memberships on success
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  accountIds: z.array(uuid).min(1, 'Select at least one brand'),
});

export async function inviteUser(input: {
  email: string;
  accountIds: string[];
}): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid invite.' };
  }

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const { data, error } = await ctx.supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/confirm`,
  });

  if (error || !data?.user) {
    // Most commonly: the user already exists. Direct the admin to assign them
    // from the existing-users list instead (a separate, idempotent journey).
    return { error: 'Could not invite. If the user already exists, assign them a brand instead.' };
  }

  const newUserId = data.user.id;
  const rows = parsed.data.accountIds.map((accountId) => ({
    account_id: accountId,
    user_id: newUserId,
    created_by: ctx.user.id,
  }));
  const { error: memberError } = await ctx.supabase
    .from('account_members')
    .upsert(rows, { onConflict: 'account_id,user_id' });
  if (memberError) {
    return { error: 'Invite sent, but assigning brands failed. Assign them manually.' };
  }

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'invite_user',
    targetUserId: newUserId,
    detail: { email: parsed.data.email, accountIds: parsed.data.accountIds },
  });
  revalidatePath('/admin');
  return { success: true };
}
