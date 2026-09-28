'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { env } from '@/env';
import { logAdminEvent } from '@/lib/admin/audit';
import { reportAuthFailure } from '@/lib/auth/alerts';
import { buildAuthConfirmUrl, renderInviteEmail } from '@/lib/auth/email-links';
import { OwnerRequiredError, requireOwnerContext } from '@/lib/auth/roles';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext, BrandRole } from '@/lib/auth/types';
import { can, type EntitlementState } from '@/lib/billing/entitlement';
import { getBrandEntitlement } from '@/lib/billing/entitlement-server';
import { getSeatLimit } from '@/lib/billing/seats';
import { sendEmail } from '@/lib/email/resend';
import { createLogger } from '@/lib/logging';
import { renderTeamInvitationEmail } from '@/lib/team/invitation-email';
import {
  getInviteUsage,
  INVITATIONS_PATH,
  listSentInvitations,
  recordTeamInvitation,
  TEAM_INVITES_PER_DAY,
  type RecordInvitationOutcome,
  type SentInvitation,
} from '@/lib/team/invitations';

/**
 * Customer-run team management (decision D4): owners invite and remove people
 * and change roles in their own brand, within the plan's seats. Everything is
 * scoped to the caller's active brand; a user id or invitation id from the
 * browser is only ever matched against that brand's rows. Invites are guarded
 * because they email any address (SPEC-self-serve-signup §4.6).
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

const PLAN_CHECK_ERROR = 'Could not check your plan. Please try again.';
const SEND_ERROR = 'Could not send the invite. Please try again.';
const DAILY_LIMIT_ERROR = `You can send up to ${TEAM_INVITES_PER_DAY} invites in any 24 hours. Please try again later.`;

/** Why a brand that is not trialing, paying, in grace or comped cannot invite (P4). */
const INVITE_BLOCKED: Partial<Record<EntitlementState, string>> = {
  incomplete: 'Start your plan in Billing to invite your team.',
  lapsed: 'Restart your plan in Billing to invite your team.',
  suspended: 'This brand is on hold, so it cannot invite people. Contact Cheers support.',
  archived: 'This brand has been closed.',
};

function seatLimitError(seatLimit: number): string {
  if (seatLimit === 0) return 'This brand cannot add people while its account is on hold.';
  return `Your plan includes ${seatLimit} ${seatLimit === 1 ? 'person' : 'people'}, counting invitations not yet accepted. Remove someone, cancel an invitation or upgrade to add more.`;
}

/** Messages for the refusals record_team_invitation can return; null means it went through. */
function refusalMessage(outcome: RecordInvitationOutcome, seatLimit: number | null): string | null {
  switch (outcome) {
    case 'already_member':
      return 'That person already has access to this brand.';
    case 'already_invited':
      return 'That person already has an invitation to this brand waiting.';
    case 'daily_limit':
      return DAILY_LIMIT_ERROR;
    case 'seat_limit':
      return seatLimitError(seatLimit ?? 0);
    case 'granted':
    case 'invited':
      return null;
  }
}

/** A failed audit write must never turn a finished invite into an error for the owner. */
async function audit(params: Parameters<typeof logAdminEvent>[0]): Promise<void> {
  try {
    await logAdminEvent(params);
  } catch (error) {
    logger.error('team audit write failed', error instanceof Error ? error : undefined, { action: params.action });
  }
}

/**
 * Delete a login this invite created but did not use (the database refused
 * the invite at the last moment, or the write failed), so a race or an outage
 * never leaves a stray login behind. Only while it is still bare: never
 * signed in or confirmed, no brand and no invitation. That also covers the
 * case where the write did commit but its answer was lost, and the rare one
 * where Supabase handed back an existing unconfirmed login. Anything else is
 * left alone. A failed check or delete is logged and alerted, never thrown:
 * the owner still gets the invite's own error.
 */
async function removeUnusedLogin(
  supabase: AuthContext['supabase'],
  user: { id: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null },
  accountId: string,
): Promise<void> {
  if (user.email_confirmed_at || user.last_sign_in_at) {
    logger.warn('team invite login left in place: already used', { accountId, userId: user.id });
    return;
  }
  try {
    const [memberships, invitations] = await Promise.all([
      supabase.from('account_members').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('team_invitations').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);
    if (memberships.error || invitations.error) {
      throw new Error(`could not check the login before deleting it: ${(memberships.error ?? invitations.error)?.message}`);
    }
    if ((memberships.count ?? 0) > 0 || (invitations.count ?? 0) > 0) {
      logger.warn('team invite login left in place: it has access or an invitation', { accountId, userId: user.id });
      return;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser failed: ${error.message}`);
  } catch (error) {
    await reportAuthFailure('invite_login_cleanup', new Error(`${error instanceof Error ? error.message : String(error)} (user ${user.id})`));
  }
}

/**
 * Invite someone to the owner's active brand (SPEC-self-serve-signup §4.6, P4).
 *
 * Refused unless the brand is trialing, paying, in past-due grace or comped,
 * whether or not billing enforcement is on. At most TEAM_INVITES_PER_DAY
 * invites per brand in any 24 hours, within the plan's seats (an open
 * invitation holds a seat). Someone with a login gets a pending invitation
 * they must accept; a new address gets a login and access at once, as before,
 * and accepts by setting a password. A dependency failure refuses with an
 * error before anything is written or sent.
 */
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

  const now = new Date();

  // Gate (P4): fail closed if the brand's state cannot be read.
  let state: EntitlementState;
  try {
    state = await getBrandEntitlement(supabase, accountId, now);
  } catch (error) {
    logger.error('team invite entitlement lookup failed', error instanceof Error ? error : undefined, { accountId });
    return { error: PLAN_CHECK_ERROR };
  }
  if (!can(state, 'invite')) return { error: INVITE_BLOCKED[state] ?? 'This brand cannot invite people right now.' };

  // Seats and the rolling cap, checked before any login is created.
  // record_team_invitation checks both again under a per-brand lock.
  let seatLimit: number | null;
  let usage: { sentLastDay: number; openInvitations: number };
  try {
    [seatLimit, usage] = await Promise.all([getSeatLimit(supabase, accountId), getInviteUsage(supabase, accountId, now)]);
  } catch (error) {
    logger.error('team invite seat or cap lookup failed', error instanceof Error ? error : undefined, { accountId });
    return { error: PLAN_CHECK_ERROR };
  }
  const { count, error: countError } = await supabase
    .from('account_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (countError) return { error: PLAN_CHECK_ERROR };
  if (usage.sentLastDay >= TEAM_INVITES_PER_DAY) return { error: DAILY_LIMIT_ERROR };
  if (seatLimit !== null && (count ?? 0) + usage.openInvitations >= seatLimit) return { error: seatLimitError(seatLimit) };

  const { data: brand, error: brandError } = await supabase
    .from('accounts')
    .select('business_name')
    .eq('id', accountId)
    .maybeSingle<{ business_name: string | null }>();
  if (brandError) return { error: SEND_ERROR };
  const brandName = brand?.business_name ?? 'your brand';

  const { data: existing, error: existingError } = await supabase
    .from('user_auth_snapshot')
    .select('user_id')
    .eq('email', email)
    .maybeSingle<{ user_id: string }>();
  if (existingError) return { error: SEND_ERROR };

  if (existing) {
    return inviteExistingLogin({ ctx, email, role, userId: existing.user_id, seatLimit, brandName, siteUrl });
  }

  // New login: create it without Supabase sending mail, save access and the
  // invite record in one step, then email our link.
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'invite', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !data?.user || !tokenHash) {
    if (data?.user) await removeUnusedLogin(supabase, data.user, accountId);
    return { error: 'Could not create the invite. Please try again.' };
  }
  const userId = data.user.id;

  let outcome: RecordInvitationOutcome;
  try {
    outcome = await recordTeamInvitation(supabase, { accountId, userId, role, invitedBy: ctx.user.id, seatLimit, grantAccess: true });
  } catch (recordError) {
    logger.error('team invite membership write failed', recordError instanceof Error ? recordError : undefined, { accountId });
    await removeUnusedLogin(supabase, data.user, accountId);
    return { error: 'Could not add them to the brand, so no email was sent. Please try again.' };
  }
  const refusal = refusalMessage(outcome, seatLimit);
  if (refusal) {
    // Another invite took the last seat or daily slot between the early check
    // and the locked one: the login made for this invite is not needed.
    await removeUnusedLogin(supabase, data.user, accountId);
    return { error: refusal };
  }

  const message = renderInviteEmail({ link: buildAuthConfirmUrl({ siteUrl, tokenHash, type: 'invite' }), brandNames: [brandName] });
  try {
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
  } catch (sendError) {
    logger.error('team invite email failed', sendError instanceof Error ? sendError : undefined, { accountId });
    await audit({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role }, result: 'failure' });
    revalidatePath('/settings');
    return { error: 'They were added, but the email failed to send. Ask them to use "Forgot password" on the sign-in page.' };
  }

  await audit({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role } });
  revalidatePath('/settings');
  return { success: true };
}

/**
 * Someone who already has a login: a pending invitation, never a membership.
 * If the email cannot be sent the invitation is withdrawn, so the owner can
 * simply try again and nobody holds an invitation they were not told about.
 */
async function inviteExistingLogin(options: {
  ctx: AuthContext;
  email: string;
  role: BrandRole;
  userId: string;
  seatLimit: number | null;
  brandName: string;
  siteUrl: string;
}): Promise<ActionResult> {
  const { ctx, email, role, userId, seatLimit, brandName, siteUrl } = options;
  const { supabase, accountId } = ctx;

  let outcome: RecordInvitationOutcome;
  try {
    outcome = await recordTeamInvitation(supabase, { accountId, userId, role, invitedBy: ctx.user.id, seatLimit, grantAccess: false });
  } catch (error) {
    logger.error('team invitation write failed', error instanceof Error ? error : undefined, { accountId });
    return { error: 'Could not save the invitation, so no email was sent. Please try again.' };
  }
  const refusal = refusalMessage(outcome, seatLimit);
  if (refusal) return { error: refusal };

  const message = renderTeamInvitationEmail({ acceptUrl: new URL(INVITATIONS_PATH, siteUrl).toString(), brandName });
  try {
    await sendEmail({ to: email, subject: message.subject, html: message.html, required: true });
  } catch (sendError) {
    logger.error('team invitation email failed', sendError instanceof Error ? sendError : undefined, { accountId });
    await audit({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role, pending: true }, result: 'failure' });
    // One open invitation per person per brand, so this removes exactly the one just written.
    const { error: withdrawError } = await supabase
      .from('team_invitations')
      .delete()
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .is('accepted_at', null)
      .is('declined_at', null)
      .is('cancelled_at', null);
    revalidatePath('/settings');
    if (withdrawError) {
      logger.error('team invitation withdraw failed', undefined, { accountId, reason: withdrawError.message });
      return { error: 'The invitation was saved, but the email failed to send. Cancel it below and try again, or ask them to sign in to Cheers to accept it.' };
    }
    return { error: 'The email failed to send, so no invitation was made. Please try again.' };
  }

  await audit({ actorUserId: ctx.user.id, action: 'team_invite', targetUserId: userId, targetAccountId: accountId, detail: { role, pending: true } });
  revalidatePath('/settings');
  return { success: true };
}

/**
 * Open invitations the active brand has sent. Owners only: the invited email
 * addresses are not shown to members until those people accept.
 */
export async function listTeamInvitations(): Promise<SentInvitation[]> {
  const ctx = await requireOwnerContext();
  return listSentInvitations(ctx.supabase, ctx.accountId);
}

/** An owner withdraws an open invitation. The row stays (cancelled), so it still counts towards the daily cap. */
export async function cancelTeamInvitation(invitationId: string): Promise<ActionResult> {
  let ctx;
  try {
    ctx = await requireOwnerContext();
  } catch (error) {
    const result = ownerError(error);
    if (result) return result;
    throw error;
  }
  if (!uuid.safeParse(invitationId).success) return { error: 'Invalid invitation.' };

  const { data, error } = await ctx.supabase
    .from('team_invitations')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('account_id', ctx.accountId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('cancelled_at', null)
    .select('user_id');
  if (error) return { error: 'Could not cancel the invitation. Please try again.' };
  const rows = (data ?? []) as Array<{ user_id: string }>;
  if (rows.length === 0) return { error: 'That invitation is no longer open.' };

  await audit({ actorUserId: ctx.user.id, action: 'team_invitation_cancel', targetUserId: rows[0].user_id, targetAccountId: ctx.accountId });
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
