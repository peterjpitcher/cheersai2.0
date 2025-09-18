import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import type { User } from '@supabase/supabase-js';
import { getAuthWithCache } from '@/lib/supabase/auth-cache';
import { logger } from '@/lib/observability/logger';

// Error response helper
export function validationError(error: ZodError) {
  const formattedErrors = error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));

  return NextResponse.json(
    {
      error: 'Validation failed',
      message: 'Please check your input and try again',
      errors: formattedErrors,
    },
    { status: 400 }
  );
}

// Auth error response
export function authError(message: string = 'Authentication required') {
  return NextResponse.json(
    {
      error: 'Unauthorized',
      message,
    },
    { status: 401 }
  );
}

// Permission error response
export function permissionError(message: string = 'Insufficient permissions') {
  return NextResponse.json(
    {
      error: 'Forbidden',
      message,
    },
    { status: 403 }
  );
}

// Generic error response
export function errorResponse(
  message: string,
  status: number = 500,
  details?: unknown
) {
  return NextResponse.json(
    {
      error: status >= 500 ? 'Internal server error' : 'Request failed',
      message,
      ...(details !== undefined && { details }),
    },
    { status }
  );
}

// Success response helper
export function successResponse<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}

// Validation wrapper for API routes
export async function withValidation<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>,
  handler: (data: T, request: NextRequest) => Promise<Response>
): Promise<Response> {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = schema.parse(body);
    
    // Call the handler with validated data
    return await handler(validatedData, request);
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }
    
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }
    
    logger.error('validation_middleware_error', {
      area: 'api',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return errorResponse('An unexpected error occurred', 500);
  }
}

// Auth + Validation wrapper
export async function withAuthValidation<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>,
  handler: (data: T, auth: { user: User; tenantId: string }, request: NextRequest) => Promise<Response>
): Promise<Response> {
  // Check authentication first
  const { user, tenantId } = await getAuthWithCache();
  
  if (!user || !tenantId) {
    return authError();
  }
  
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = schema.parse(body);
    
    // Call the handler with validated data and auth context
    return await handler(validatedData, { user, tenantId }, request);
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }
    
    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }
    
    logger.error('auth_validation_middleware_error', {
      area: 'api',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return errorResponse('An unexpected error occurred', 500);
  }
}

// Query params validation
export function validateQueryParams<T>(
  searchParams: URLSearchParams,
  schema: z.ZodSchema<T>
): { data?: T; error?: ZodError } {
  try {
    // Convert URLSearchParams to object
    const params: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      // Handle array params (e.g., ?filter=a&filter=b)
      const current = params[key];
      if (Array.isArray(current)) {
        current.push(value);
      } else if (typeof current !== 'undefined') {
        params[key] = [current, value];
      } else {
        params[key] = value;
      }
    });
    
    // Parse numbers where appropriate
    Object.keys(params).forEach(key => {
      const current = params[key];
      if (typeof current === 'string') {
        const numericValue = Number(current);
        if (!Number.isNaN(numericValue)) {
          params[key] = numericValue;
        }
      }
    });
    
    const data = schema.parse(params);
    return { data };
  } catch (error) {
    if (error instanceof ZodError) {
      return { error };
    }
    throw error;
  }
}

// Sanitize output to prevent XSS
export function sanitizeOutput<T>(data: T): T {
  if (typeof data === 'string') {
    return (data
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
    ) as T;
  }
  
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeOutput(item)) as T;
  }
  
  if (data && typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeOutput(value);
    }
    return sanitized as T;
  }
  
  return data;
}

// SQL injection prevention helper
export function sanitizeSQLIdentifier(identifier: string): string {
  // Remove any characters that aren't alphanumeric or underscore
  return identifier.replace(/[^a-zA-Z0-9_]/g, '');
}

// Check if request has valid CSRF token (for state-changing operations)
export function validateCSRF(request: NextRequest): boolean {
  const token = request.headers.get('x-csrf-token');
  const cookieToken = request.cookies.get('csrf-token')?.value;
  
  if (!token || !cookieToken) {
    return false;
  }
  
  return token === cookieToken;
}

// Tenant isolation helper
export async function validateTenantAccess(
  resourceTenantId: string,
  userTenantId: string
): Promise<boolean> {
  return resourceTenantId === userTenantId;
}

// Rate limit check (integrates with our rate limiting)
export function checkRateLimit(request: NextRequest): {
  limited: boolean;
  remaining: number;
  reset: number;
} {
  // Get rate limit headers from request
  const remaining = parseInt(request.headers.get('x-ratelimit-remaining') || '0');
  const reset = parseInt(request.headers.get('x-ratelimit-reset') || '0');
  
  return {
    limited: remaining <= 0,
    remaining,
    reset,
  };
}
