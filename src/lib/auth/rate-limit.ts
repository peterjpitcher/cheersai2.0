import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Upstash rate limiter for auth endpoints (AUTH-08)
// Sliding window: 5 requests per 60 seconds per identifier (email or IP).
// Graceful fallback: if UPSTASH_REDIS_REST_URL is not configured, rate
// limiting is skipped (dev/local environments).
// ---------------------------------------------------------------------------

let authRateLimiterInstance: Ratelimit | null = null;

function getAuthRateLimiter(): Ratelimit | null {
  if (authRateLimiterInstance) return authRateLimiterInstance;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      '[auth] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured. ' +
      'Rate limiting is disabled. Set these env vars for production.',
    );
    return null;
  }

  const redis = new Redis({ url, token });

  authRateLimiterInstance = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '60 s'),
    prefix: 'ratelimit:auth',
  });

  return authRateLimiterInstance;
}

/** Re-export the limiter for direct use if needed */
export const authRateLimiter = {
  get instance(): Ratelimit | null {
    return getAuthRateLimiter();
  },
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * Check if an auth action is rate-limited for the given identifier.
 *
 * @param identifier - typically the email address or IP address
 * @returns Rate limit check result. If Upstash is not configured, always allows.
 */
export async function checkAuthRateLimit(
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getAuthRateLimiter();

  if (!limiter) {
    // Dev fallback: no rate limiting when Upstash is not configured
    return { allowed: true, limit: 5, remaining: 5, resetAt: 0 };
  }

  const { success, limit, remaining, reset } = await limiter.limit(identifier);
  return { allowed: success, limit, remaining, resetAt: reset };
}

// ---------------------------------------------------------------------------
// Backward-compatible exports for v1 API routes
// These will be removed once API routes are migrated to use server actions.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function extractIp(request: Request): string | null {
  const candidates = [
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-vercel-forwarded-for'),
    request.headers.get('x-client-ip'),
  ];

  for (const entry of candidates) {
    if (!entry) continue;
    const [first] = entry.split(',');
    const trimmed = first?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

/** @deprecated Use checkAuthRateLimit instead */
export function getRateLimitKey(request: Request, prefix: string): string {
  const ip = extractIp(request);
  const base = ip
    ? `ip:${ip}`
    : `ua:${hashValue(request.headers.get('user-agent') ?? 'unknown')}`;
  return `${prefix}:${base}`;
}

const fallbackStore = new Map<string, { count: number; resetAt: number }>();

/** @deprecated Use checkAuthRateLimit instead */
export async function isRateLimited(params: {
  key: string;
  maxAttempts: number;
  windowMs: number;
}): Promise<boolean> {
  const { key, maxAttempts, windowMs } = params;
  const now = Date.now();
  const record = fallbackStore.get(key);

  if (!record || record.resetAt < now) {
    fallbackStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  record.count += 1;
  fallbackStore.set(key, record);
  return record.count > maxAttempts;
}
