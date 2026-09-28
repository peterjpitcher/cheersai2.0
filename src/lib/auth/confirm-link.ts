import { safeNextPath } from '@/lib/auth/email-links';

/**
 * The query string of an email link to /auth/confirm (built by
 * buildAuthConfirmUrl for invites and resets). Read by the page, which only
 * shows the button, and again by the button's server action, which verifies.
 * Safe to import anywhere (no server imports).
 */
export const CONFIRM_LINK_TYPES = ['invite', 'recovery', 'magiclink', 'email', 'signup'] as const;

export type ConfirmLinkType = (typeof CONFIRM_LINK_TYPES)[number];

export interface ConfirmLinkParams {
  tokenHash: string;
  type: ConfirmLinkType;
  next: string;
}

/** Supabase token hashes are hex (optionally `pkce_`-prefixed); anything else is not ours. */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

export const CONFIRM_LINK_FALLBACK_NEXT = '/dashboard';

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
  return { tokenHash, type, next: safeNextPath(single(input.next), CONFIRM_LINK_FALLBACK_NEXT) };
}
