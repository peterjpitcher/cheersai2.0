/**
 * With `shouldCreateUser: false`, Supabase rejects a magic-link request for an
 * email that has no login ("Signups not allowed for otp", code `otp_disabled`).
 * Callers treat that as success so the login form does not reveal which email
 * addresses have accounts.
 */
const UNKNOWN_USER_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found']);

export function isUnknownUserOtpError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && UNKNOWN_USER_CODES.has(error.code)) return true;
  return /signups not allowed/i.test(error.message ?? '');
}
