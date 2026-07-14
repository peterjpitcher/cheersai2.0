import { cookies } from 'next/headers';

/**
 * Active-brand cookie (multi-brand). Holds the account id of the ONE brand the
 * user is currently operating. It is a trust boundary: its value is re-verified
 * against the user's membership set on every request (see server.ts), so a
 * tampered cookie can never grant access to a brand the user is not a member of.
 *
 * Written ONLY by the switchActiveBrand server action and cleared on sign-out.
 * Read (never written) during server-component render in getCurrentUser().
 */
export const ACTIVE_BRAND_COOKIE = 'cheersai_active_account';

// Loose UUID-shape check only: this is a format sanity gate to discard garbage.
// The real guard is membership verification against the user's brand set, so we
// must not reject a legitimately-stored account id on version/variant nibbles.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cookie options shared by every writer, so set/delete stay symmetric. */
export function activeBrandCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  };
}

/**
 * Read the active-brand cookie. Returns a validated UUID string, or null when
 * absent/malformed. A malformed value is treated as untrusted input (discarded)
 * rather than trusted or echoed.
 */
export async function readActiveBrandCookie(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_BRAND_COOKIE)?.value?.trim();
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}
