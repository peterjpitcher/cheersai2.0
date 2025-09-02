/**
 * Standardized cookie options for Supabase auth cookies
 * Ensures consistent security settings across all client implementations
 */

export const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 7, // 7 days
} as const;

export const COOKIE_OPTIONS_REMOVE = {
  ...COOKIE_OPTIONS,
  maxAge: 0,
} as const;

/**
 * Get standardized cookie options
 * @param remove - Whether this is for removing a cookie
 */
export function getCookieOptions(remove = false) {
  return remove ? COOKIE_OPTIONS_REMOVE : COOKIE_OPTIONS;
}