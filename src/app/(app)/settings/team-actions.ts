'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { buildAuthConfirmUrl, renderAddedToBrandEmail, renderInviteEmail } from '@/lib/auth/email-links';
import { OwnerRequiredError, requireOwnerContext } from '@/lib/auth/roles';
import { requireAuthContext } from '@/lib/auth/server';
import type { BrandRole } from '@/lib/auth/types';
import { getSeatLimit } from '@/lib/billing/seats';
import { sendEmail } from '@/lib/email/resend';
import { createLogger } from '@/lib/logging';

/**
 * Customer-run team management (decision D4): owners invite and remove people
 * and change roles in their own brand, within the plan's seats. Everything is
 * scoped to the caller's active brand; a user id from the browser is only
 * ever matched against that brand's memberships.
 */

type ActionResult = { success?: boolean; error?: string };

export interface TeamMember {
  userId: string;
  email: string | null;
  role: BrandRole;
  isYou: boolean;
}

const logger = createLogger('team');
const roleSchema = z.enum(['owner', 'member']);
const uuid = z.string().uuid();

function ownerError(error: unknown): ActionResult | null {
  return error instanceof OwnerRequiredError ? { error: error.message } : null;
}

/** Postgres check_violation raised by the keep-an-owner trigger. */
function lastOwnerError(error: { code?: string; message?: string } | null): string | null {
  if (error?.code === '23514' && /at least one owner/i.test(error.message ?? '')) {
    return 'A brand must keep at least one owner. Make someone else an owner first.';
  }
  return null;
}

export async function listTeam(): Promise<TeamMember[]> {
  const ctx = await requireAuthContext();
  const { data: members, error } = await ctx.supabase
    .from('account_members')
    .select('user_id, role')
    .eq('account_id', ctx.accountId);
  if (error) throw new Error(`Could not load the team: ${error.message}`);

  const rows = (members ?? []) as Array<{ user_id: string; role: BrandRole }>;
  if (rows.length === 0) return [];

  const { data: snapshots, error: snapshotError } = await ctx.supabase
    .from('user_auth_snapshot')
    .select('user_id, email')
    .in('user_id', rows.map((row) => row.user_id));
  if (snapshotError) throw new Error(`Could not load the team: ${snapshotError.message}`);
  const emailById = new Map(((snapshots ?? []) as Array<{ user_id: string; email: string | null }>).map((s) => [s.user_id, s.email]));

  return rows
    .map((row) => ({ userId: row.user_id, email: emailById.get(row.user_id) ?? null, role: row.role, isYou: row.user_id === ctx.user.id }))
    .sort((a, b) => (a.role === b.role ? (a.email ?? '').localeCompare(b.email ?? '') : a.role === 'owner' ? -1 : 1));
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: roleSchema,
});

export async function inviteTeamMember(input: { email: string; role: BrandRole }): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireOwnerContext();
  } catch (error) {
    const result = ownerError(error);
    if (result) return result;
    throw error;
  }

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid invite.' };
  const { email, role } = parsed.data;
  const { supabase, accountId } = ctx;

  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return { error: 'Invites are unavailable right now. Please try again later.' };

  // Seats: fail closed if the limit cannot be read.
  let seatLimit: number | null;
  try {
    seatLimit = await getSeatLimit(supabase, accountId);
  } catch (error) {
    logger.error('seat limit lookup failed', error instanceof Error ? error : undefined, { accountId });
    return { error: 'Could not check your plan. Please try again.' };
  }
  const { count, error: countError } = await supabase
    .from('account_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (countError) return { error: 'Could not check your plan. Please try again.' };
  if (seatLimit !== null && (count ?? 0) >= seatLimit) {
    return {
      error:
        seatLimit === 0
          ? 'This brand cannot add people while its account is on hold.'
          : `Your plan includes ${seatLimit} ${seatLimit === 1 ? 'person' : 'people'}. Remove someone or upgrade to add more.`,
    };
  }

  const { data: brand } = await supabase.from('accounts').select('business_name').eq('id', accountId).maybeSingle<{ business_name: string | null }>();
  const brandName = brand?.business_name ?? 'your brand';

  const { data: existing, error: existingError } = await supabase
    .from('user_auth_snapshot')
    .select('user_id')
    .eq('email', email)
    .maybeSingle<{ user_id: string }>();
  if (existingError) return { error: 'Could not send the invite. Please try again.' };

  let userId: string;
  let message: { subject: string; html: string };

  if (existing) {
    const { data: already } = await supabase
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('user_id', existing.user_id)
      .maybeSingle();
    if (already) return { error: 'That person already has access to this brand.' };
    userId = existing.user_id;
    message = renderAddedToBrandEmail({ loginUrl: new URL('/login', siteUrl).toString(), brandName });
  } else {
    // New login: create it without Supabase sending mail, save access, then email our link.
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'invite', email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !data?.user || !tokenHash) return { error: 'Could not create the invite. Please try again.' };
    userId = data.user.id;
    message = renderInviteEmail({ link: buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'invite' }), brandNames: [brandName] });
  }

  const { error: memberError } = await supabase
    .from('account_members')
    .insert({ account_id: accountId, user_id: userId, role, created_by: ctx.user.id });
  if (memberError) {
    logger.error('team invite membership write failed', undefined, { accountId, reason: memberError.message });
    return { error: 'Could not add them to the brand, so no email was sent. Please try again.' };
  }

  try {
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
  } catch (error) {
    logger.error('team invite email failed', error instanceof Error ? error : undefined, { accountId });
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role }, result: 'failure' });
    revalidatePath('/settings');
    return { error: 'They were added, but the email failed to send. Ask them to use "Forgot password" on the sign-in page.' };
  }

  await logAdminEvent({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role } });
  revalidatePath('/settings');
  return { success: true };
}

export async function removeTeamMember(userId: string): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireOwnerContext();
  } catch (error) {
    const result = ownerError(error);
    if (result) return result;
    throw error;
  }
  if (!uuid.safeParse(userId).success) return { error: 'Invalid person.' };

  const { data, error } = await ctx.supabase
    .from('account_members')
    .delete()
    .eq('account_id', ctx.accountId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return { error: lastOwnerError(error) ?? 'Could not remove them. Please try again.' };
  if (!data?.length) return { error: 'That person is not part of this brand.' };

  await logAdminEvent({ actorUserId: ctx.user.id, action: 'team_remove', targetUserId: userId, targetAccountId: ctx.accountId });
  revalidatePath('/settings');
  return { success: true };
}

export async function setTeamMemberRole(userId: string, role: BrandRole): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireOwnerContext();
  } catch (error) {
    const result = ownerError(error);
    if (result) return result;
    throw error;
  }
  if (!uuid.safeParse(userId).success || !roleSchema.safeParse(role).success) return { error: 'Invalid change.' };

  const { data, error } = await ctx.supabase
    .from('account_members')
    .update({ role })
    .eq('account_id', ctx.accountId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return { error: lastOwnerError(error) ?? 'Could not change their role. Please try again.' };
  if (!data?.length) return { error: 'That person is not part of this brand.' };

  await logAdminEvent({ actorUserId: ctx.user.id, action: 'team_role_change', targetUserId: userId, targetAccountId: ctx.accountId, detail: { role } });
  revalidatePath('/settings');
  return { success: true };
}
