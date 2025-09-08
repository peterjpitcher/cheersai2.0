import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest } from "next/server";

// Create a simple in-memory rate limiter for development
// In production, use Upstash Redis
class InMemoryRateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();

  async limit(
    identifier: string,
    options?: { max?: number; windowMs?: number }
  ): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
    const now = Date.now();
    const windowMs = options?.windowMs ?? 60 * 1000; // default 1 minute
    const maxAttempts = options?.max ?? 10; // default 10 req / window

    const current = this.attempts.get(identifier);

    if (!current || current.resetAt < now) {
      // Start new window
      const resetAt = now + windowMs;
      this.attempts.set(identifier, { count: 1, resetAt });
      return {
        success: true,
        limit: maxAttempts,
        remaining: maxAttempts - 1,
        reset: resetAt,
      };
    }

    if (current.count >= maxAttempts) {
      // Rate limit exceeded
      return {
        success: false,
        limit: maxAttempts,
        remaining: 0,
        reset: current.resetAt,
      };
    }

    // Increment count
    current.count++;
    this.attempts.set(identifier, current);

    return {
      success: true,
      limit: maxAttempts,
      remaining: maxAttempts - current.count,
      reset: current.resetAt,
    };
  }
}

// Create rate limiter instance
let defaultLimiter: Ratelimit | InMemoryRateLimiter;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Production: Use Upstash Redis
  // Lazy import to avoid ESM issues in Jest
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Redis } = require('@upstash/redis')
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  defaultLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m"), analytics: true })
} else {
  // Development: Use in-memory rate limiter
  defaultLimiter = new InMemoryRateLimiter();
}

// Rate limit configurations for different endpoints
export const rateLimitConfig = {
  // Auth endpoints - stricter limits
  auth: {
    requests: 5,
    window: "1 m",
  },
  // API endpoints - standard limits
  api: {
    requests: 30,
    window: "1 m",
  },
  // AI generation - limited due to cost
  ai: {
    requests: 10,
    window: "5 m",
  },
  // File upload - limited due to resource usage
  upload: {
    requests: 5,
    window: "1 m",
  },
};

// Get client identifier from request
export function getClientId(request: NextRequest): string {
  // Try to get user ID from auth header or session
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    return `auth:${authHeader}`;
  }

  // Fall back to IP address
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0] || realIp || "127.0.0.1";
  
  return `ip:${ip}`;
}

// Main rate limiting function
export async function rateLimit(
  request: NextRequest,
  type: keyof typeof rateLimitConfig = "api"
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const identifier = getClientId(request);
  
  if (defaultLimiter instanceof InMemoryRateLimiter) {
    return defaultLimiter.limit(identifier, { max: rateLimitConfig[type].requests, windowMs: toMs(rateLimitConfig[type].window) });
  }
  let custom: Ratelimit
  if ((defaultLimiter as any).redis) {
    custom = new Ratelimit({
      // @ts-expect-error runtime
      redis: (defaultLimiter as any).redis,
      limiter: Ratelimit.slidingWindow(rateLimitConfig[type].requests, rateLimitConfig[type].window as any),
      analytics: true,
    })
  } else {
    // Fallback to in-memory behavior for tests
    return (defaultLimiter as InMemoryRateLimiter).limit(identifier, { max: rateLimitConfig[type].requests, windowMs: toMs(rateLimitConfig[type].window) })
  }
  const { success, limit, remaining, reset } = await custom.limit(identifier);
  
  return {
    success,
    limit,
    remaining,
    reset: new Date(reset).getTime(),
  };
}

// Middleware helper for rate limiting
export async function withRateLimit(
  request: NextRequest,
  handler: () => Promise<Response>,
  type: keyof typeof rateLimitConfig = "api"
): Promise<Response> {
  const { success, limit, remaining, reset } = await rateLimit(request, type);

  if (!success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Please slow down and try again later",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": new Date(reset).toISOString(),
          "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  // Add rate limit headers to successful responses
  const response = await handler();
  response.headers.set("X-RateLimit-Limit", limit.toString());
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  response.headers.set("X-RateLimit-Reset", new Date(reset).toISOString());
  
  return response;
}

// Utility: perform sliding window limit for an arbitrary identifier and window
export async function limitSlidingWindow(
  identifier: string,
  requests: number,
  window: string
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  if (defaultLimiter instanceof InMemoryRateLimiter) {
    return defaultLimiter.limit(identifier, { max: requests, windowMs: toMs(window) });
  }

  if (!(defaultLimiter as any).redis) {
    return (defaultLimiter as InMemoryRateLimiter).limit(identifier, { max: requests, windowMs: toMs(window) })
  }
  const limiter = new Ratelimit({
    // @ts-expect-error use same redis
    redis: (defaultLimiter as any).redis,
    limiter: Ratelimit.slidingWindow(requests, window as any),
    analytics: true,
  })
  const { success, limit, remaining, reset } = await limiter.limit(identifier)
  return { success, limit, remaining, reset: new Date(reset).getTime() };
}

function toMs(window: string): number {
  // very small parser for forms like '1 m', '5 m', '10 s'
  const [nStr, unit] = window.trim().split(/\s+/);
  const n = Number(nStr);
  if (unit?.startsWith('s')) return n * 1000;
  if (unit?.startsWith('m')) return n * 60_000;
  if (unit?.startsWith('h')) return n * 60 * 60_000;
  return n;
}

export type RateLimitedResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export async function enforceUserAndTenantLimits(params: {
  userId?: string;
  tenantId?: string;
  userLimit?: { requests: number; window: string };
  tenantLimit?: { requests: number; window: string };
}): Promise<{ user: RateLimitedResult | null; tenant: RateLimitedResult | null }> {
  const { userId, tenantId, userLimit = { requests: 60, window: '1 m' }, tenantLimit = { requests: 300, window: '1 m' } } = params;
  const results: { user: RateLimitedResult | null; tenant: RateLimitedResult | null } = { user: null, tenant: null };
  if (userId) results.user = await limitSlidingWindow(`user:${userId}`, userLimit.requests, userLimit.window);
  if (tenantId) results.tenant = await limitSlidingWindow(`tenant:${tenantId}`, tenantLimit.requests, tenantLimit.window);
  return results;
}
