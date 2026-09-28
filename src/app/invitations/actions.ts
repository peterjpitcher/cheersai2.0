'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logAdminEvent } from '@/lib/admin/audit';
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
  let outcome: AcceptInvitationOutcome;
  try {
    outcome = await acceptTeamInvitationForUser(service, invitationId, userId);
  } catch (error) {
    logger.error('invitation accept failed', error instanceof Error ? error : undefined);
    return { error: FAILED };
  }

  if (outcome === 'accepted') {
    // Best effort, for the audit trail only (the invitation row itself is deleted a day later).
    const { data: row } = await service
      .from('team_invitations')
      .select('account_id')
      .eq('id', invitationId)
      .eq('user_id', userId)
      .maybeSingle<{ account_id: string }>();
    await audit({ actorUserId: userId, action: 'team_invitation_accept', targetUserId: userId, targetAccountId: row?.account_id ?? null, detail: { invitationId } });
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
