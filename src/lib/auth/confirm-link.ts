import { DEFAULT_SIGNED_IN_PATH, safeNextPath, SIGNUP_VENUE_PATH, type AuthEmailLinkType } from '@/lib/auth/email-links';

/**
 * The query string of an email link to /auth/confirm (built by
 * buildAuthConfirmUrl for invites, resets, magic links and self-serve
 * sign-ups, all sent through Resend). Read by the page, which only shows the
 * button, and again by the button's server action, which verifies. Safe to
 * import anywhere (no server imports).
 *
 * Magic links used to go out through Supabase's own mailer and template
 * (Supabase verified them, then /auth/callback). Those links, if any are still
 * unexpired, keep working through /auth/callback, which is unchanged.
 */
export const CONFIRM_LINK_TYPES = ['invite', 'recovery', 'signup', 'magiclink'] as const satisfies readonly AuthEmailLinkType[];

export type ConfirmLinkType = (typeof CONFIRM_LINK_TYPES)[number];

/**
 * The Supabase OTP type each link is verified as. A sign-up link's token comes
 * from generateLink type 'invite' (spec §4.2: no password is chosen before the
 * email is proved), so it is verified as an invite. Supabase's own 'signup'
 * type is never used: that flow needs a password up front.
 *
 * A magic link is verified as 'magiclink', not the generic 'email': on the
 * local stack (GoTrue 2.191, 28 September 2026) 'magiclink' accepts only a
 * magic-link or recovery token, while 'email' also accepts an invite or
 * sign-up token, which would confirm a login nobody has set up yet.
 */
export const SUPABASE_OTP_TYPE: Record<ConfirmLinkType, 'invite' | 'recovery' | 'magiclink'> = {
  invite: 'invite',
  recovery: 'recovery',
  signup: 'invite',
  magiclink: 'magiclink',
};

export interface ConfirmLinkParams {
  tokenHash: string;
  type: ConfirmLinkType;
  next: string;
}

/** Supabase token hashes are hex (optionally `pkce_`-prefixed); anything else is not ours. */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

export const CONFIRM_LINK_FALLBACK_NEXT = DEFAULT_SIGNED_IN_PATH;

/** Where a link goes when its `next` is missing or unsafe. */
function fallbackNext(type: ConfirmLinkType): string {
  return type === 'signup' ? SIGNUP_VENUE_PATH : CONFIRM_LINK_FALLBACK_NEXT;
}

function single(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isConfirmLinkType(value: string): value is ConfirmLinkType {
  return (CONFIRM_LINK_TYPES as readonly string[]).includes(value);
}

export function parseConfirmLinkParams(input: {
  token_hash?: unknown;
  type?: unknown;
  next?: unknown;
}): ConfirmLinkParams | null {
  const tokenHash = single(input.token_hash);
  const type = single(input.type);
  if (!tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  if (!type || !isConfirmLinkType(type)) return null;
  return { tokenHash, type, next: safeNextPath(single(input.next), fallbackNext(type)) };
}
