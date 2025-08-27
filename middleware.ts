import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { rateLimit } from '@/lib/rate-limit';

// Determine rate limit type based on pathname
function getRateLimitType(pathname: string): 'auth' | 'ai' | 'api' | 'upload' {
  if (pathname.startsWith('/api/auth')) return 'auth';
  if (pathname.startsWith('/api/generate')) return 'ai';
  if (pathname.startsWith('/api/media')) return 'upload';
  return 'api';
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // First, handle Supabase session refresh for all routes
  // This MUST run before any other logic to ensure sessions are fresh
  let response = await updateSession(request);
  
  // Skip additional middleware for static assets and non-API routes
  if (!pathname.startsWith('/api')) {
    return response;
  }
  
  // Handle OPTIONS requests early (CORS preflight)
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('origin');
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'https://cheersai.orangejelly.co.uk',
      'https://www.cheersai.orangejelly.co.uk'
    ].filter(Boolean);
    
    const headers = new Headers();
    if (origin && allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      headers.set('Access-Control-Max-Age', '86400'); // 24 hours
      headers.set('Vary', 'Origin');
    }
    
    return new NextResponse(null, { status: 200, headers });
  }
  
  // Skip rate limiting for health checks
  if (pathname === '/api/health') {
    return response;
  }
  
  // Apply distributed rate limiting using Upstash Redis (or in-memory fallback)
  const rateLimitType = getRateLimitType(pathname);
  const { success, limit, remaining, reset } = await rateLimit(request, rateLimitType);
  
  if (!success) {
    return NextResponse.json(
      { 
        error: 'Too many requests',
        message: 'Please slow down and try again later',
        retryAfter: Math.ceil((reset - Date.now()) / 1000)
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': new Date(reset).toISOString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
          'Content-Type': 'application/json',
        },
      }
    );
  }
  
  // Add rate limit headers to successful response
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(reset).toISOString());
  
  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Add CORS headers for API routes
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'https://cheersai.orangejelly.co.uk',
    'https://www.cheersai.orangejelly.co.uk'
  ].filter(Boolean);
  
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Vary', 'Origin');
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