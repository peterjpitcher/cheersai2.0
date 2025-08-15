import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

// Create a simple in-memory rate limiter for development
// In production, use Upstash Redis
class InMemoryRateLimiter {
  private attempts: Map<string, { count: number; resetAt: number }> = new Map();

  async limit(identifier: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxAttempts = 10; // 10 requests per minute

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
let rateLimiter: Ratelimit | InMemoryRateLimiter;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Production: Use Upstash Redis
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  rateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 requests per minute
    analytics: true,
  });
} else {
  // Development: Use in-memory rate limiter
  rateLimiter = new InMemoryRateLimiter();
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
  
  if (rateLimiter instanceof InMemoryRateLimiter) {
    return rateLimiter.limit(identifier);
  }

  const { success, limit, remaining, reset } = await rateLimiter.limit(identifier);
  
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