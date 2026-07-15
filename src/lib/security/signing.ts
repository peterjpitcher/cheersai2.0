/**
 * Timing-safe secret validation for webhook/cron secrets.
 * Prevents timing attacks by using constant-time comparison.
 *
 * @see AUTH-06 in REQUIREMENTS.md
 */
import crypto from 'node:crypto';

/**
 * Generate a high-entropy, URL-safe ingest secret for per-brand webhooks.
 * 256 bits of entropy; the `bce_` prefix identifies it as a booking-conversion
 * ingest key. Stored plaintext in a service-role-only column and matched by the
 * webhook as a routing key (like an API key), so it must be shown to the owner
 * once at creation and never logged.
 */
export function generateIngestSecret(): string {
  return `bce_${crypto.randomBytes(32).toString('base64url')}`;
}

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
