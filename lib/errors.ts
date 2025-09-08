// Centralized error codes and mapping helpers

export type ErrorCode =
  | 'TOKEN_EXPIRED'
  | 'MISSING_SCOPE'
  | 'IG_IMAGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export type Provider = 'facebook' | 'instagram' | 'twitter' | 'gbp' | 'generic';

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

function includes(msg: string, ...needles: string[]) {
  const lower = msg.toLowerCase();
  return needles.some(n => lower.includes(n));
}

export function mapProviderError(err: unknown, provider: Provider = 'generic'): AppError {
  const raw = normalizeError(err);
  const msg = raw.message || '';
  const status = raw.statusCode || raw.status || 0;

  // HTTP status mapping
  if (status === 401) return { code: 'UNAUTHORIZED', message: scrubMessage(msg, provider) };
  if (status === 403) return { code: 'FORBIDDEN', message: scrubMessage(msg, provider) };
  if (status === 404) return { code: 'NOT_FOUND', message: scrubMessage(msg, provider) };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'Rate limited. Please retry later.' };

  // Provider-specific patterns
  if (provider === 'instagram' || provider === 'facebook') {
    if (includes(msg, 'expired token', 'token expired', 'session has expired')) {
      return { code: 'TOKEN_EXPIRED', message: 'Please reconnect your account.' };
    }
    if (includes(msg, 'permissions error', 'missing permission', 'missing scope', 'insufficient permission')) {
      return { code: 'MISSING_SCOPE', message: 'Missing required permission for this action.' };
    }
    if (provider === 'instagram' && includes(msg, 'requires an image', 'image required', 'media_url is required')) {
      return { code: 'IG_IMAGE_REQUIRED', message: 'Instagram posts require at least one image.' };
    }
  }

  if (provider === 'twitter') {
    if (includes(msg, 'rate limit', 'too many requests', '429')) {
      return { code: 'RATE_LIMITED', message: 'Twitter rate limit hit. Please retry later.' };
    }
    if (includes(msg, 'token', 'invalid', 'expired')) {
      return { code: 'TOKEN_EXPIRED', message: 'Please reconnect your Twitter account.' };
    }
  }

  if (includes(msg, 'network', 'fetch failed', 'timeout', 'timed out')) {
    return { code: 'NETWORK_ERROR', message: 'Network error. Please try again.' };
  }

  // Generic fallbacks
  if (status >= 500) return { code: 'SERVER_ERROR', message: 'Upstream service error. Please retry.' };
  if (status >= 400) return { code: 'PROVIDER_ERROR', message: scrubMessage(msg, provider) };

  return { code: 'UNKNOWN', message: scrubMessage(msg, provider) };
}

export function normalizeError(err: unknown): { message: string; status?: number; statusCode?: number; name?: string; raw?: unknown } {
  if (!err) return { message: 'Unknown error' };
  if (typeof err === 'string') return { message: err };
  if (err instanceof Error) return { message: err.message, name: err.name, raw: err } as any;
  try {
    const anyErr: any = err as any;
    const msg = anyErr.message || JSON.stringify(anyErr);
    return { message: msg, status: anyErr.status, statusCode: anyErr.statusCode, raw: err };
  } catch {
    return { message: 'Unknown error' };
  }
}

// Ensure we do not bubble provider internals directly
function scrubMessage(message: string, provider: Provider): string {
  const m = message?.trim();
  if (!m) return 'Request failed';
  // Remove long JSON bodies and tokens
  return m.replace(/[A-Za-z0-9_\-]{16,}/g, '[redacted]')
          .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"[redacted]"')
          .slice(0, 500);
}

