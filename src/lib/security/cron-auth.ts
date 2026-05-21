/**
 * Centralised cron route authentication (B5).
 * Validates CRON_SECRET from request headers using timing-safe comparison.
 *
 * Accepted header formats:
 * - Authorization: Bearer <secret>  (Vercel cron format)
 * - x-cron-secret: <secret>         (custom header)
 *
 * URL query string secrets are explicitly rejected -- header-only auth
 * prevents secrets from leaking into access logs and referrer headers.
 */

import { validateSecret } from '@/lib/security/signing';

interface CronAuthResult {
  authorised: boolean;
  errorStatus?: number;
  errorMessage?: string;
}

/**
 * Verify that a cron request is properly authenticated.
 *
 * @param request - Incoming HTTP request.
 * @returns Auth result with status code and message on failure.
 */
export function verifyCronAuth(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      authorised: false,
      errorStatus: 500,
      errorMessage: 'CRON_SECRET not configured',
    };
  }

  // Extract secret from headers (two supported formats)
  const xCronSecret = request.headers.get('x-cron-secret')?.trim() ?? null;
  const authHeader = normaliseAuthHeader(request.headers.get('authorization'));
  const headerSecret = xCronSecret || authHeader || null;

  // Reject if no header secret provided
  if (!headerSecret) {
    return {
      authorised: false,
      errorStatus: 401,
      errorMessage: 'Unauthorized',
    };
  }

  // Timing-safe comparison via shared signing utility
  if (!validateSecret(headerSecret, cronSecret)) {
    return {
      authorised: false,
      errorStatus: 401,
      errorMessage: 'Unauthorized',
    };
  }

  return { authorised: true };
}

/**
 * Strip "Bearer " prefix from Authorization header value.
 * Returns empty string if header is null or empty.
 */
function normaliseAuthHeader(value: string | null): string {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}
