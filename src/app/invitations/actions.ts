'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logAdminEvent } from '@/lib/admin/audit';
import { can, type EntitlementState } from '@/lib/billing/entitlement';
import { getBrandEntitlement } from '@/lib/billing/entitlement-server';
import { createLogger } from '@/lib/logging';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { acceptTeamInvitationForUser, type AcceptInvitationOutcome } from '@/lib/team/invitations';

/**
 * The invited person accepts or declines a team invitation (spec §4.6). The
 * user id always comes from the verified session (getUser, which checks the
 * token with Supabase Auth), never from the browser; an invitation id from the
 * browser only ever matches that person's own rows. Neither action changes
 * the active brand: the default stays the brand the person joined first.
 *
 * Accepting also needs the brand to still be one that may invite (trialing,
 * paying, past-due grace or comped: the same entitlement check as sending an
 * invite), so a brand that lapsed or was put on hold after inviting cannot
 * gain members. The invitation stays open, so it can still be accepted if the
 * brand's plan restarts before it expires.
 */

type ActionResult = { success?: boolean; error?: string };

const logger = createLogger('team-invitations');
const uuid = z.string().uuid();

const FAILED = 'We could not finish this. Please try again.';

const ACCEPT_ERRORS: Record<Exclude<AcceptInvitationOutcome, 'accepted' | 'already_accepted'>, string> = {
  expired: 'This invitation has expired. Ask the brand owner to send a new one.',
  closed: 'This invitation is no longer open.',
  not_found: 'We could not find that invitation.',
};

/** Why an invitation cannot be accepted while its brand may not add people. */
const BRAND_HELD: Partial<Record<EntitlementState, string>> = {
  incomplete:
    'This brand has not started its plan, so it cannot add people yet. Ask the brand owner, then try again before the invitation expires.',
  lapsed:
    "This brand's plan has lapsed, so it cannot add people right now. Ask the brand owner to restart it, then try again before the invitation expires.",
  suspended:
    'This brand is on hold, so it cannot add people right now. Ask the brand owner, then try again before the invitation expires.',
  archived: ACCEPT_ERRORS.closed,
};

async function sessionUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

async function audit(params: Parameters<typeof logAdminEvent>[0]): Promise<void> {
  try {
    await logAdminEvent(params);
  } catch (error) {
    logger.error('invitation audit write failed', error instanceof Error ? error : undefined, { action: params.action });
  }
}

export async function acceptInvitation(invitationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invitationId).success) return { error: ACCEPT_ERRORS.not_found };

  let userId: string | null;
  try {
    userId = await sessionUserId();
  } catch (error) {
    logger.error('invitation accept: session check failed', error instanceof Error ? error : undefined);
    return { error: FAILED };
  }
  if (!userId) return { error: 'Please sign in again to accept this invitation.' };

  const service = createServiceSupabaseClient();

  // Which brand, scoped to this person: someone else's invitation looks missing.
  const { data: invitation, error: lookupError } = await service
    .from('team_invitations')
    .select('account_id')
    .eq('id', invitationId)
    .eq('user_id', userId)
    .maybeSingle<{ account_id: string }>();
  if (lookupError) {
    logger.error('invitation accept: lookup failed', undefined, { reason: lookupError.message });
    return { error: FAILED };
  }
  if (!invitation) return { error: ACCEPT_ERRORS.not_found };

  // The brand must still be allowed to add people; fail closed if unreadable.
  let state: EntitlementState;
  try {
    state = await getBrandEntitlement(service, invitation.account_id);
  } catch (error) {
    logger.error('invitation accept: entitlement lookup failed', error instanceof Error ? error : undefined);
    return { error: FAILED };
  }
  if (!can(state, 'invite')) return { error: BRAND_HELD[state] ?? ACCEPT_ERRORS.closed };

  let outcome: AcceptInvitationOutcome;
  try {
    outcome = await acceptTeamInvitationForUser(service, invitationId, userId);
  } catch (error) {
    logger.error('invitation accept failed', error instanceof Error ? error : undefined);
    return { error: FAILED };
  }

  if (outcome === 'accepted') {
    await audit({ actorUserId: userId, action: 'team_invitation_accept', targetUserId: userId, targetAccountId: invitation.account_id, detail: { invitationId } });
    revalidatePath('/', 'layout');
    return { success: true };
  }
  if (outcome === 'already_accepted') return { success: true };
  return { error: ACCEPT_ERRORS[outcome] };
}

export async function declineInvitation(invitationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invitationId).success) return { error: ACCEPT_ERRORS.not_found };

  let userId: string | null;
  try {
    userId = await sessionUserId();
  } catch (error) {
    logger.error('invitation decline: session check failed', error instanceof Error ? error : undefined);
    return { error: FAILED };
  }
  if (!userId) return { error: 'Please sign in again to decline this invitation.' };

  const { data, error } = await createServiceSupabaseClient()
    .from('team_invitations')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('user_id', userId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('cancelled_at', null)
    .select('account_id');
  if (error) {
    logger.error('invitation decline failed', undefined, { reason: error.message });
    return { error: FAILED };
  }
  const rows = (data ?? []) as Array<{ account_id: string }>;
  if (rows.length === 0) return { error: ACCEPT_ERRORS.closed };

  await audit({ actorUserId: userId, action: 'team_invitation_decline', targetUserId: userId, targetAccountId: rows[0].account_id, detail: { invitationId } });
  revalidatePath('/', 'layout');
  return { success: true };
}
