import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { getAuthWithCache } from '@/lib/supabase/auth-cache';

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
  details?: any
) {
  return NextResponse.json(
    {
      error: status >= 500 ? 'Internal server error' : 'Request failed',
      message,
      ...(details && { details }),
    },
    { status }
  );
}

// Success response helper
export function successResponse(data: any, status: number = 200) {
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
    
    console.error('Validation middleware error:', error);
    return errorResponse('An unexpected error occurred', 500);
  }
}

// Auth + Validation wrapper
export async function withAuthValidation<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>,
  handler: (data: T, auth: { user: any; tenantId: string }, request: NextRequest) => Promise<Response>
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
    
    console.error('Auth validation middleware error:', error);
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
    const params: any = {};
    searchParams.forEach((value, key) => {
      // Handle array params (e.g., ?filter=a&filter=b)
      if (params[key]) {
        if (Array.isArray(params[key])) {
          params[key].push(value);
        } else {
          params[key] = [params[key], value];
        }
      } else {
        params[key] = value;
      }
    });
    
    // Parse numbers where appropriate
    Object.keys(params).forEach(key => {
      if (!Array.isArray(params[key]) && !isNaN(Number(params[key]))) {
        params[key] = Number(params[key]);
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
export function sanitizeOutput(data: any): any {
  if (typeof data === 'string') {
    return data
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeOutput);
  }
  
  if (data && typeof data === 'object') {
    const sanitized: any = {};
    for (const key in data) {
      sanitized[key] = sanitizeOutput(data[key]);
    }
    return sanitized;
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