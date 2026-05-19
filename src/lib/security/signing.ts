/**
 * Timing-safe secret validation for webhook/cron secrets.
 * Prevents timing attacks by using constant-time comparison.
 *
 * @see AUTH-06 in REQUIREMENTS.md
 */
import crypto from 'node:crypto';

/** Timing-safe comparison for webhook/cron secrets. Prevents timing attacks. */
export function validateSecret(
  provided: string | null,
  expected: string,
): boolean {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // Reject early if lengths differ -- timingSafeEqual requires equal-length buffers
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
