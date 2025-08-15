import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMITS = {
  '/api/generate': { max: 10, window: RATE_LIMIT_WINDOW }, // 10 AI requests per minute
  '/api/social': { max: 30, window: RATE_LIMIT_WINDOW }, // 30 social API calls per minute
  '/api/auth': { max: 5, window: RATE_LIMIT_WINDOW }, // 5 auth attempts per minute
  '/api': { max: 100, window: RATE_LIMIT_WINDOW }, // 100 general API calls per minute
};

function getRateLimit(pathname: string) {
  // Find the most specific rate limit rule
  for (const [path, limit] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(path)) {
      return limit;
    }
  }
  return RATE_LIMITS['/api']; // Default API rate limit
}

function checkRateLimit(identifier: string, pathname: string): { allowed: boolean; remaining: number } {
  const limit = getRateLimit(pathname);
  const key = `${identifier}:${pathname}`;
  const now = Date.now();
  
  const record = rateLimitStore.get(key);
  
  if (!record || now > record.resetTime) {
    // Create new record
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + limit.window
    });
    return { allowed: true, remaining: limit.max - 1 };
  }
  
  if (record.count >= limit.max) {
    return { allowed: false, remaining: 0 };
  }
  
  record.count++;
  return { allowed: true, remaining: limit.max - record.count };
}

// Clean up old rate limit records periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // First, handle Supabase session refresh for all routes
  // This MUST run before any other logic to ensure sessions are fresh
  let response = await updateSession(request);
  
  // Skip additional middleware for static assets and non-API routes
  if (!pathname.startsWith('/api')) {
    return response;
  }
  
  // Skip rate limiting for health checks
  if (pathname === '/api/health') {
    return NextResponse.next();
  }
  
  // Get client identifier (IP address or user ID)
  const identifier = request.ip || request.headers.get('x-forwarded-for') || 'anonymous';
  
  // Check rate limit
  const { allowed, remaining } = checkRateLimit(identifier, pathname);
  
  if (!allowed) {
    return NextResponse.json(
      { 
        error: 'Too many requests', 
        message: 'Please slow down and try again later'
      },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(getRateLimit(pathname).max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Date.now() + RATE_LIMIT_WINDOW),
          'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW / 1000))
        }
      }
    );
  }
  
  // Add rate limit headers to response
  // Use the response from updateSession instead of creating a new one
  response.headers.set('X-RateLimit-Limit', String(getRateLimit(pathname).max));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset', String(Date.now() + RATE_LIMIT_WINDOW));
  
  // Add CORS headers for API routes
  if (pathname.startsWith('/api')) {
    const origin = request.headers.get('origin');
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'https://cheersai.orangejelly.co.uk',
      'https://www.cheersai.orangejelly.co.uk'
    ].filter(Boolean);
    
    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200, headers: response.headers });
    }
  }
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};