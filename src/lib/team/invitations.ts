import type { SupabaseClient } from '@supabase/supabase-js';

import type { BrandRole } from '@/lib/auth/types';

/**
 * Team invitations (SPEC-self-serve-signup §4.6, decision P4).
 *
 * public.team_invitations is service role only: every query here runs through
 * the service-role client, so each one is scoped by the verified user id (the
 * invited person) or the active brand's id (the owner). The atomic writes are
 * the SQL functions record_team_invitation and accept_team_invitation
 * (migration 20260928161500_team_invitations.sql). Lookup errors throw, so a
 * caller fails closed.
 */

/** Invites a brand may send in any rolling 24 hours (P4). */
export const TEAM_INVITES_PER_DAY = 5;

/** Where the invited person accepts or declines. */
export const INVITATIONS_PATH = '/invitations';

export type RecordInvitationOutcome =
  | 'granted'
  | 'invited'
  | 'already_member'
  | 'already_invited'
  | 'daily_limit'
  | 'seat_limit';

export type AcceptInvitationOutcome = 'accepted' | 'already_accepted' | 'not_found' | 'closed' | 'expired';

const RECORD_OUTCOMES: ReadonlySet<string> = new Set<RecordInvitationOutcome>([
  'granted',
  'invited',
  'already_member',
  'already_invited',
  'daily_limit',
  'seat_limit',
]);

const ACCEPT_OUTCOMES: ReadonlySet<string> = new Set<AcceptInvitationOutcome>([
  'accepted',
  'already_accepted',
  'not_found',
  'closed',
  'expired',
]);

/** An open invitation waiting for the signed-in person. */
export interface PendingInvitation {
  id: string;
  accountId: string;
  brandName: string;
  role: BrandRole;
  expiresAt: string;
}

/** An open invitation a brand has sent, for its owners. */
export interface SentInvitation {
  id: string;
  email: string | null;
  role: BrandRole;
  expiresAt: string;
}

function toRole(value: string | null): BrandRole {
  return value === 'owner' ? 'owner' : 'member';
}

/**
 * Invites the brand sent in the last 24 hours (whatever became of them) and
 * its open, unexpired invitations (which hold seats). A pre-check only:
 * record_team_invitation re-checks both under a per-brand lock.
 */
export async function getInviteUsage(
  service: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<{ sentLastDay: number; openInvitations: number }> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [sent, open] = await Promise.all([
    service
      .from('team_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gt('created_at', dayAgo),
    service
      .from('team_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .is('accepted_at', null)
      .is('declined_at', null)
      .is('cancelled_at', null)
      .gt('expires_at', now.toISOString()),
  ]);
  if (sent.error) throw new Error(`team_invitations lookup failed: ${sent.error.message}`);
  if (open.error) throw new Error(`team_invitations lookup failed: ${open.error.message}`);
  return { sentLastDay: sent.count ?? 0, openInvitations: open.count ?? 0 };
}

export async function recordTeamInvitation(
  service: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    role: BrandRole;
    invitedBy: string;
    seatLimit: number | null;
    grantAccess: boolean;
  },
): Promise<RecordInvitationOutcome> {
  const { data, error } = await service.rpc('record_team_invitation', {
    p_account_id: params.accountId,
    p_user_id: params.userId,
    p_role: params.role,
    p_invited_by: params.invitedBy,
    p_seat_limit: params.seatLimit,
    p_daily_limit: TEAM_INVITES_PER_DAY,
    p_grant_access: params.grantAccess,
  });
  if (error) throw new Error(`record_team_invitation failed: ${error.message}`);
  if (typeof data !== 'string' || !RECORD_OUTCOMES.has(data)) {
    throw new Error(`record_team_invitation returned an unexpected result: ${String(data)}`);
  }
  return data as RecordInvitationOutcome;
}

export async function acceptTeamInvitationForUser(
  service: SupabaseClient,
  invitationId: string,
  userId: string,
): Promise<AcceptInvitationOutcome> {
  const { data, error } = await service.rpc('accept_team_invitation', {
    p_invitation_id: invitationId,
    p_user_id: userId,
  });
  if (error) throw new Error(`accept_team_invitation failed: ${error.message}`);
  if (typeof data !== 'string' || !ACCEPT_OUTCOMES.has(data)) {
    throw new Error(`accept_team_invitation returned an unexpected result: ${String(data)}`);
  }
  return data as AcceptInvitationOutcome;
}

/** Open, unexpired invitations for this person, oldest first, for live brands only. */
export async function listPendingInvitationsForUser(
  service: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  const { data, error } = await service
    .from('team_invitations')
    .select('id, account_id, role, expires_at')
    .eq('user_id', userId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw new Error(`team_invitations lookup failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; account_id: string; role: string | null; expires_at: string }>;
  if (rows.length === 0) return [];

  const { data: accounts, error: accountsError } = await service
    .from('accounts')
    .select('id, business_name')
    .in('id', [...new Set(rows.map((row) => row.account_id))])
    .is('archived_at', null);
  if (accountsError) throw new Error(`accounts lookup failed: ${accountsError.message}`);
  const nameById = new Map(
    ((accounts ?? []) as Array<{ id: string; business_name: string | null }>).map((a) => [a.id, a.business_name]),
  );

  return rows
    .filter((row) => nameById.has(row.account_id))
    .map((row) => ({
      id: row.id,
      accountId: row.account_id,
      brandName: nameById.get(row.account_id)?.trim() || 'A brand',
      role: toRole(row.role),
      expiresAt: row.expires_at,
    }));
}

/** Open, unexpired invitations the brand has sent, newest first, with the invited email. */
export async function listSentInvitations(
  service: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<SentInvitation[]> {
  const { data, error } = await service
    .from('team_invitations')
    .select('id, user_id, role, expires_at')
    .eq('account_id', accountId)
    .is('accepted_at', null)
    .is('declined_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(`team_invitations lookup failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; user_id: string; role: string | null; expires_at: string }>;
  if (rows.length === 0) return [];

  const { data: snapshots, error: snapshotError } = await service
    .from('user_auth_snapshot')
    .select('user_id, email')
    .in('user_id', rows.map((row) => row.user_id));
  if (snapshotError) throw new Error(`user_auth_snapshot lookup failed: ${snapshotError.message}`);
  const emailById = new Map(
    ((snapshots ?? []) as Array<{ user_id: string; email: string | null }>).map((s) => [s.user_id, s.email]),
  );

  return rows.map((row) => ({
    id: row.id,
    email: emailById.get(row.user_id) ?? null,
    role: toRole(row.role),
    expiresAt: row.expires_at,
  }));
}
