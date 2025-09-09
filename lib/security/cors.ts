/**
 * CORS security utilities
 * Provides secure CORS handling with proper credential management
 */

export interface CorsOptions {
  allowedOrigins?: string[] | string;
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

const DEFAULT_ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL || 'https://cheersai.orangejelly.co.uk',
  'http://localhost:3000',
  'http://localhost:3001',
];

const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const DEFAULT_ALLOWED_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Origin',
  'X-Requested-With',
  'X-CSRF-Token',
];

const DEFAULT_EXPOSED_HEADERS = [
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'X-RateLimit-Limit',
];

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string | undefined, allowedOrigins: string[] | string): boolean {
  if (!origin) {
    // Allow requests with no origin (mobile apps, server-to-server)
    return true;
  }

  if (typeof allowedOrigins === 'string') {
    if (allowedOrigins === '*') {
      return true;
    }
    return origin === allowedOrigins;
  }

  if (Array.isArray(allowedOrigins)) {
    return allowedOrigins.includes(origin) || allowedOrigins.includes('*');
  }

  return false;
}

/**
 * Apply CORS headers to a Response
 */
export function applyCorsHeaders(
  response: Response,
  request: Request,
  options: CorsOptions = {}
): Response {
  const {
    allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
    allowedMethods = DEFAULT_ALLOWED_METHODS,
    allowedHeaders = DEFAULT_ALLOWED_HEADERS,
    exposedHeaders = DEFAULT_EXPOSED_HEADERS,
    credentials = true,
    maxAge = 86400, // 24 hours
    optionsSuccessStatus = 204,
  } = options;

  const origin = request.headers.get('origin') ?? undefined;
  
  // Clone the response to avoid modifying the original
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });

  // Set origin
  if (isOriginAllowed(origin, allowedOrigins)) {
    if (origin) {
      newResponse.headers.set('Access-Control-Allow-Origin', origin);
    } else if (typeof allowedOrigins === 'string' && allowedOrigins === '*') {
      newResponse.headers.set('Access-Control-Allow-Origin', '*');
    }
  }

  // Set credentials
  if (credentials && origin && isOriginAllowed(origin, allowedOrigins)) {
    newResponse.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  // Set allowed methods
  newResponse.headers.set('Access-Control-Allow-Methods', allowedMethods.join(', '));

  // Set allowed headers
  newResponse.headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '));

  // Set exposed headers
  if (exposedHeaders.length > 0) {
    newResponse.headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '));
  }

  // Set max age for preflight requests
  newResponse.headers.set('Access-Control-Max-Age', maxAge.toString());

  // Add security headers
  newResponse.headers.set('X-Content-Type-Options', 'nosniff');
  newResponse.headers.set('X-Frame-Options', 'DENY');
  newResponse.headers.set('X-XSS-Protection', '1; mode=block');
  newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy for API responses
  newResponse.headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none';"
  );

  return newResponse;
}

/**
 * Create a preflight OPTIONS response
 */
export function createPreflightResponse(request: Request, options: CorsOptions = {}): Response {
  const response = new Response(null, {
    status: options.optionsSuccessStatus || 204,
    statusText: 'No Content',
  });

  return applyCorsHeaders(response, request, options);
}

/**
 * Validate CORS request
 */
export function validateCorsRequest(request: Request, options: CorsOptions = {}): boolean {
  const { allowedOrigins = DEFAULT_ALLOWED_ORIGINS } = options;
  const origin = request.headers.get('origin');
  
  // For same-origin requests (no origin header), allow
  if (!origin) {
    return true;
  }
  
  return isOriginAllowed(origin, allowedOrigins);
}

/**
 * CORS middleware for API routes
 */
export function withCors(
  handler: (request: Request) => Promise<Response>,
  options: CorsOptions = {}
) {
  return async (request: Request): Promise<Response> => {
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return createPreflightResponse(request, options);
    }

    // Validate CORS
    if (!validateCorsRequest(request, options)) {
      return new Response('CORS policy violation', {
        status: 403,
        statusText: 'Forbidden',
      });
    }

    // Call the actual handler
    const response = await handler(request);
    
    // Apply CORS headers to the response
    return applyCorsHeaders(response, request, options);
  };
}

/**
 * Production CORS options (restrictive)
 */
export const PRODUCTION_CORS_OPTIONS: CorsOptions = {
  allowedOrigins: [
    'https://cheersai.orangejelly.co.uk',
    'https://www.cheersai.orangejelly.co.uk',
  ],
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
  maxAge: 86400,
};

/**
 * Development CORS options (more permissive)
 */
export const DEVELOPMENT_CORS_OPTIONS: CorsOptions = {
  allowedOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ],
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 3600,
};

/**
 * Get appropriate CORS options based on environment
 */
export function getCorsOptions(): CorsOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? PRODUCTION_CORS_OPTIONS : DEVELOPMENT_CORS_OPTIONS;
}
