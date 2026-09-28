import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SET_PASSWORD_PATH } from '@/lib/auth/email-links';
import { destinationAfterPasswordSet } from '@/lib/billing/setup-redirect';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Venue creation at /signup/venue (tasks/SPEC-self-serve-signup.md §4.4):
// the reads and writes the page and createSelfServeVenue share. Every
// service-role query is scoped by the verified session's user id.
// ---------------------------------------------------------------------------

export interface SignedInUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  /** The session was opened by an invite or sign-up link (Supabase AMR "invite"). */
  cameFromInviteLink: boolean;
}

export type SignedInLogin =
  | { status: 'signed_in'; user: SignedInUser }
  | { status: 'signed_out' }
  | { status: 'unavailable'; error: string };

type AuthErrorLike = { name?: string; status?: number; code?: string; message?: string };

/**
 * No session, an expired one, or a login that no longer exists: the person is
 * signed out. Anything else (network, 5xx, Supabase's own rate limit) means we
 * could not tell, which is a dependency failure.
 */
function isSignedOutError(error: AuthErrorLike): boolean {
  if (error.name === 'AuthSessionMissingError') return true;
  if (['session_not_found', 'refresh_token_not_found', 'user_not_found', 'bad_jwt', 'session_expired'].includes(error.code ?? '')) {
    return true;
  }
  return error.status === 401 || error.status === 403;
}

/**
 * The authentication methods in the session's access token (the "amr" claim).
 * Only used to choose a page to send someone to, never for access: the token
 * has already been checked by getUser() in the same request.
 */
export function amrMethods(accessToken: string | null | undefined): string[] {
  if (!accessToken) return [];
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return [];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { amr?: unknown };
    if (!Array.isArray(claims.amr)) return [];
    return claims.amr
      .map((entry) => (entry && typeof entry === 'object' ? (entry as { method?: unknown }).method : undefined))
      .filter((method): method is string => typeof method === 'string');
  } catch {
    return [];
  }
}

/** The signed-in login from the verified session (auth.getUser), never from the form. */
export async function readSignedInLogin(): Promise<SignedInLogin> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      if (isSignedOutError(error)) return { status: 'signed_out' };
      return { status: 'unavailable', error: `getUser: ${error.code ?? error.status ?? ''} ${error.message}`.trim() };
    }
    if (!user) return { status: 'signed_out' };

    let cameFromInviteLink = false;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      cameFromInviteLink = amrMethods(session?.access_token).includes('invite');
    } catch {
      cameFromInviteLink = false;
    }

    return {
      status: 'signed_in',
      user: {
        id: user.id,
        email: (user.email ?? '').trim().toLowerCase(),
        emailConfirmed: Boolean(user.email_confirmed_at),
        cameFromInviteLink,
      },
    };
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
  }
}

export interface SelfServeSignupRow {
  accountId: string | null;
  verifiedAt: string | null;
  venueCreatedAt: string | null;
}

export interface VenueSignupState {
  /** Belongs to at least one brand (any role, archived or not). */
  isMember: boolean;
  /** The login's sign-up row, or null (a login starting from /no-access has none yet). */
  signup: SelfServeSignupRow | null;
}

/** Throws on any read error: the caller refuses and alerts. */
export async function readVenueSignupState(service: SupabaseClient, userId: string): Promise<VenueSignupState> {
  const [memberships, signups] = await Promise.all([
    service.from('account_members').select('account_id').eq('user_id', userId).limit(1),
    service
      .from('self_serve_signups')
      .select('account_id, verified_at, venue_created_at')
      .eq('user_id', userId)
      .maybeSingle<{ account_id: string | null; verified_at: string | null; venue_created_at: string | null }>(),
  ]);
  if (memberships.error) throw new Error(`account_members: ${memberships.error.message}`);
  if (signups.error) throw new Error(`self_serve_signups: ${signups.error.message}`);
  const row = signups.data;
  return {
    isMember: ((memberships.data ?? []) as unknown[]).length > 0,
    signup: row ? { accountId: row.account_id, verifiedAt: row.verified_at, venueCreatedAt: row.venue_created_at } : null,
  };
}

/**
 * Records when the person first opened /signup/venue with a confirmed email
 * (the funnel's "verified" step, spec §4.10). Only the first time counts.
 * Throws on error.
 */
export async function markSignupVerified(service: SupabaseClient, userId: string): Promise<void> {
  // An instant stored in the database, not a date shown to anyone.
  const { error } = await service
    .from('self_serve_signups')
    .update({ verified_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('verified_at', null);
  if (error) throw new Error(`self_serve_signups verified_at: ${error.message}`);
}

/**
 * Where a signed-in person who already belongs to a brand goes instead of the
 * venue form (spec §4.4): the owner of the venue this sign-up made goes to
 * Billing (if it has not started a plan) or the planner; someone brought in by
 * an invite link who has no venue from this sign-up chooses a password first;
 * everyone else goes to Billing or the planner. Navigation only.
 */
export async function destinationForMember(user: SignedInUser, signup: SelfServeSignupRow | null): Promise<string> {
  if (!signup?.accountId && user.cameFromInviteLink) return SET_PASSWORD_PATH;
  return destinationAfterPasswordSet();
}

export type ProvisionRefusal = { status: 'closed' | 'no_login' | 'venue_closed' | 'member' | 'email_mismatch' };

export type ProvisionOutcome = { status: 'created'; accountId: string } | { status: 'existing'; accountId: string } | ProvisionRefusal;

/** A brand exists for this sign-up: just made, or made by an earlier submit. */
export function isProvisioned(outcome: ProvisionOutcome): outcome is Exclude<ProvisionOutcome, ProvisionRefusal> {
  return outcome.status === 'created' || outcome.status === 'existing';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** public.provision_self_serve_brand's jsonb answer, checked. Null when it is not one the app knows. */
export function parseProvisionOutcome(data: unknown): ProvisionOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const { status, account_id: accountId } = data as { status?: unknown; account_id?: unknown };
  if (status === 'created' || status === 'existing') {
    if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) return null;
    return status === 'created' ? { status: 'created', accountId } : { status: 'existing', accountId };
  }
  if (status === 'closed' || status === 'no_login' || status === 'venue_closed' || status === 'member' || status === 'email_mismatch') {
    return { status };
  }
  return null;
}

/**
 * Creates the brand, the owner membership and the brand profile and fills the
 * sign-up row, in one database transaction that takes the sign-up row lock
 * (migration 20260928190000). Throws on a database error or an answer the app
 * does not know; the function has then undone its own writes.
 */
export async function provisionSelfServeBrand(
  service: SupabaseClient,
  args: { userId: string; venueName: string; businessType: string; email: string; legalVersion: string },
): Promise<ProvisionOutcome> {
  const { data, error } = await service.rpc('provision_self_serve_brand', {
    p_user_id: args.userId,
    p_venue_name: args.venueName,
    p_business_type: args.businessType,
    p_email: args.email,
    p_legal_version: args.legalVersion,
  });
  if (error) throw new Error(`provision_self_serve_brand: ${error.code ?? ''} ${error.message}`.trim());
  const outcome = parseProvisionOutcome(data);
  if (!outcome) throw new Error('provision_self_serve_brand returned an answer the app does not expect');
  return outcome;
}
