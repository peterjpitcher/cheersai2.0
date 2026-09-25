'use server';

import { IANAZone } from 'luxon';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { exportBrandData, offboardBrand, purgeBrand } from '@/lib/admin/offboarding';
import { buildAuthConfirmUrl, renderInviteEmail, renderPasswordResetEmail } from '@/lib/auth/email-links';
import { sendEmail } from '@/lib/email/resend';
import { can } from '@/lib/billing/entitlement';
import { getBrandEntitlement } from '@/lib/billing/entitlement-server';
import { releaseHeldPublishJobs } from '@/lib/billing/publish-hold';
import { requireAuthContext } from '@/lib/auth/server';
import { createLogger } from '@/lib/logging';
import type { BrandFeature } from '@/lib/auth/features';
import type { AuthContext } from '@/lib/auth/types';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { generateIngestSecret } from '@/lib/security/signing';

type ActionResult = { success?: boolean; error?: string };

const logger = createLogger('admin');

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
      // Legacy single-owner column, still NOT NULL on the live table. Access is by
      // account_members, not this; the connection-expiry alert emails this login, so
      // the creating admin gets those alerts for the new brand.
      auth_user_id: ctx.user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    logger.error('create brand failed', undefined, {
      actorUserId: ctx.user.id,
      code: error?.code,
      reason: error?.message,
    });
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
// booking-conversion ingest key (per-brand)
// ---------------------------------------------------------------------------

/**
 * Generate (or rotate) a brand's booking-conversion ingest key. The plaintext
 * key is returned ONCE for the admin to hand to the brand's booking site; it is
 * stored plaintext in a service-role-only column and matched by the webhook as a
 * routing key. The key is never logged. Rotating invalidates the previous key.
 */
export async function generateBookingIngestKey(
  accountId: string,
): Promise<ActionResult & { key?: string }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };

  const key = generateIngestSecret();
  const { data, error } = await ctx.supabase
    .from('accounts')
    .update({ booking_ingest_secret: key })
    .eq('id', accountId)
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return { error: 'Could not set the booking key.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'set_booking_key',
    targetAccountId: accountId,
  });
  revalidatePath('/admin');
  return { success: true, key };
}

/** Disable a brand's booking-conversion ingestion by clearing its ingest key. */
export async function clearBookingIngestKey(accountId: string): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };

  const { error } = await ctx.supabase
    .from('accounts')
    .update({ booking_ingest_secret: null })
    .eq('id', accountId);

  if (error) return { error: 'Could not disable booking ingestion.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'clear_booking_key',
    targetAccountId: accountId,
  });
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

  // Order matters: create the login without sending anything, write brand
  // access, and only then email the link. A failure at any step stops before
  // the invitee receives a link to an account with no brands.
  const { data, error } = await ctx.supabase.auth.admin.generateLink({
    type: 'invite',
    email: parsed.data.email,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !data?.user || !tokenHash) {
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
    logger.error('invite_user membership write failed', undefined, { targetUserId: newUserId, reason: memberError.message });
    return {
      error:
        'The login was created but brand access could not be saved, so no email was sent. Add their brands in the users list, then use "Send password link".',
    };
  }

  const { data: brandRows } = await ctx.supabase
    .from('accounts')
    .select('business_name')
    .in('id', parsed.data.accountIds);
  const brandNames = (brandRows ?? [])
    .map((row: { business_name: string | null }) => row.business_name ?? '')
    .filter(Boolean);

  const link = buildAuthConfirmUrl({ siteUrl: siteUrlOrThrow(), tokenHash, type: 'invite' });
  const email = renderInviteEmail({ link, brandNames });
  try {
    await sendEmail({ to: parsed.data.email, subject: email.subject, html: email.html, required: true });
  } catch (sendError) {
    logger.error('invite_user email failed', sendError instanceof Error ? sendError : undefined, { targetUserId: newUserId });
    await logAdminEvent({
      actorUserId: ctx.user.id,
      action: 'invite_user',
      targetUserId: newUserId,
      detail: { email: parsed.data.email, accountIds: parsed.data.accountIds },
      result: 'failure',
    });
    revalidatePath('/admin');
    return {
      error:
        'The login and brand access were saved, but the invite email failed to send. Use "Send password link" in the users list to try again.',
    };
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

// ---------------------------------------------------------------------------
// sendPasswordLink -- resend access to an existing user (failed or expired
// invite, or a user who never set a password)
// ---------------------------------------------------------------------------

export async function sendPasswordLink(userId: string): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(userId).success) return { error: 'Invalid user.' };

  const { data: userData, error: userError } = await ctx.supabase.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) return { error: 'Could not find that user.' };

  const { data, error } = await ctx.supabase.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { error: 'Could not create a password link. Try again.' };

  const link = buildAuthConfirmUrl({ siteUrl: siteUrlOrThrow(), tokenHash, type: 'recovery' });
  const message = renderPasswordResetEmail({ link });
  try {
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
  } catch (sendError) {
    logger.error('send_password_link email failed', sendError instanceof Error ? sendError : undefined, { targetUserId: userId });
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'send_password_link', targetUserId: userId, result: 'failure' });
    return { error: 'The email failed to send. Try again shortly.' };
  }

  await logAdminEvent({ actorUserId: ctx.user.id, action: 'send_password_link', targetUserId: userId });
  return { success: true };
}

function siteUrlOrThrow(): string {
  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error('NEXT_PUBLIC_SITE_URL is not set; cannot build auth links.');
  return siteUrl;
}

// ---------------------------------------------------------------------------
// setBrandFeature -- per-brand feature switches (paid ads, tournaments,
// management-app import). See src/lib/auth/features.ts.
// ---------------------------------------------------------------------------

const FEATURE_COLUMNS = {
  paidAds: 'paid_ads_enabled',
  tournaments: 'tournaments_enabled',
  managementImport: 'management_import_enabled',
} as const satisfies Record<BrandFeature, string>;

const brandFeatureSchema = z.enum(['paidAds', 'tournaments', 'managementImport']);

export async function setBrandFeature(
  accountId: string,
  feature: BrandFeature,
  enabled: boolean,
): Promise<ActionResult> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };
  const parsedFeature = brandFeatureSchema.safeParse(feature);
  if (!parsedFeature.success || typeof enabled !== 'boolean') return { error: 'Invalid feature.' };

  const { data, error } = await ctx.supabase
    .from('accounts')
    .update({ [FEATURE_COLUMNS[parsedFeature.data]]: enabled })
    .eq('id', accountId)
    .select('id')
    .single<{ id: string }>();
  if (error || !data) return { error: 'Could not update the feature.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'set_brand_feature',
    targetAccountId: accountId,
    detail: { feature: parsedFeature.data, enabled },
  });
  revalidatePath('/', 'layout');
  return { success: true };
}

// ---------------------------------------------------------------------------
// setBillingOverride -- operator billing state (spec §4.1, piece 2.11):
// comped (free), suspended (held) or none (Stripe decides). When the change
// leaves the brand able to publish, its future held posts are released;
// overdue ones stay held for the owner to review.
// ---------------------------------------------------------------------------

const billingOverrideSchema = z.enum(['comped', 'suspended']).nullable();

export async function setBillingOverride(
  accountId: string,
  override: 'comped' | 'suspended' | null,
): Promise<ActionResult & { released?: number; stillHeld?: number }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };
  const parsed = billingOverrideSchema.safeParse(override);
  if (!parsed.success) return { error: 'Invalid billing state.' };

  const { data, error } = await ctx.supabase
    .from('accounts')
    .update({ billing_override: parsed.data })
    .eq('id', accountId)
    .select('id')
    .single<{ id: string }>();
  if (error || !data) return { error: 'Could not update the billing state.' };

  await logAdminEvent({
    actorUserId: ctx.user.id,
    action: 'set_billing_override',
    targetAccountId: accountId,
    detail: { override: parsed.data },
  });

  let released: number | undefined;
  let stillHeld: number | undefined;
  try {
    const state = await getBrandEntitlement(ctx.supabase, accountId);
    if (can(state, 'publish')) {
      ({ released, stillHeld } = await releaseHeldPublishJobs(ctx.supabase, accountId));
    }
  } catch (releaseError) {
    logger.error('release held posts after billing change failed', releaseError instanceof Error ? releaseError : undefined, {
      accountId,
    });
    revalidatePath('/admin');
    return { error: 'Billing state saved, but held posts could not be released. Try again.' };
  }

  revalidatePath('/admin');
  return { success: true, released, stillHeld };
}

// ---------------------------------------------------------------------------
// Offboarding (spec §4.7, D5, piece 2.9). See docs/runbooks/customer-offboarding.md.
// Every step is super-admin only and confirmed by typing the brand's name.
// ---------------------------------------------------------------------------

async function confirmBrandName(
  ctx: AuthContext,
  accountId: string,
  typedName: string,
): Promise<{ error: string } | { name: string }> {
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };
  const { data, error } = await ctx.supabase
    .from('accounts')
    .select('business_name')
    .eq('id', accountId)
    .maybeSingle<{ business_name: string | null }>();
  if (error || !data) return { error: 'Brand not found.' };
  const name = (data.business_name ?? '').trim();
  if (!name || typedName.trim() !== name) return { error: 'Type the brand name exactly to confirm.' };
  return { name };
}

export async function offboardBrandAction(accountId: string, typedName: string): Promise<ActionResult & { purgeAfter?: string }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  const confirmed = await confirmBrandName(ctx, accountId, typedName);
  if ('error' in confirmed) return confirmed;

  try {
    const result = await offboardBrand(ctx.supabase, accountId);
    if ('error' in result) return { error: result.error };
    await logAdminEvent({
      actorUserId: ctx.user.id,
      action: 'offboard_brand',
      targetAccountId: accountId,
      detail: { name: confirmed.name, ...result },
    });
    revalidatePath('/admin');
    return { success: true, purgeAfter: result.purgeAfter };
  } catch (error) {
    logger.error('offboard brand failed', error instanceof Error ? error : undefined, { accountId });
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'offboard_brand', targetAccountId: accountId, result: 'failure' });
    return { error: 'Offboarding stopped part-way. Fix the cause and run it again; it is safe to repeat.' };
  }
}

export async function exportBrandDataAction(accountId: string): Promise<ActionResult & { json?: string; fileName?: string }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  if (!uuid.safeParse(accountId).success) return { error: 'Invalid brand.' };
  try {
    const data = await exportBrandData(ctx.supabase, accountId);
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'export_brand_data', targetAccountId: accountId });
    return { success: true, json: JSON.stringify(data, null, 2), fileName: `cheers-export-${accountId}.json` };
  } catch (error) {
    logger.error('export brand data failed', error instanceof Error ? error : undefined, { accountId });
    return { error: 'The export failed. Try again.' };
  }
}

export async function purgeBrandAction(accountId: string, typedName: string): Promise<ActionResult & { filesDeleted?: number; loginsDeleted?: number }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { error: 'Forbidden.' };
  const confirmed = await confirmBrandName(ctx, accountId, typedName);
  if ('error' in confirmed) return confirmed;

  try {
    const result = await purgeBrand(ctx.supabase, accountId);
    if ('error' in result) return { error: result.error };
    await logAdminEvent({
      actorUserId: ctx.user.id,
      action: 'purge_brand',
      targetAccountId: accountId,
      detail: { name: confirmed.name, ...result },
    });
    revalidatePath('/admin');
    return { success: true, ...result };
  } catch (error) {
    logger.error('purge brand failed', error instanceof Error ? error : undefined, { accountId });
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'purge_brand', targetAccountId: accountId, result: 'failure' });
    return { error: 'Deleting stopped part-way. Fix the cause and run it again; it is safe to repeat.' };
  }
}
