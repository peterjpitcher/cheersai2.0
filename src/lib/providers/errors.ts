/**
 * Provider error classification (PLAT-07).
 * Categorises API errors from Facebook, Instagram, and GBP into
 * actionable classifications that drive retry/alert behaviour.
 */

import type { ProviderPlatform } from '@/types/providers';

export enum ErrorClassification {
  AUTH = 'auth',
  RATE_LIMIT = 'rate_limit',
  CONTENT_REJECTED = 'content_rejected',
  TRANSIENT = 'transient',
  UNKNOWN = 'unknown',
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly platform: ProviderPlatform,
    public readonly classification: ErrorClassification,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Classify a Meta Graph API error (Facebook + Instagram).
 * Handles HTTP status codes and Meta-specific error subcodes
 * (190 = expired token, 463 = session expired, 467 = invalid token).
 */
export function classifyMetaError(statusCode: number, errorPayload: unknown): ErrorClassification {
  if (statusCode === 429) return ErrorClassification.RATE_LIMIT;
  if (statusCode === 401 || statusCode === 403) return ErrorClassification.AUTH;

  // Meta-specific subcodes indicating auth failures
  const subcode = (errorPayload as { error?: { error_subcode?: number } })?.error?.error_subcode;
  if (subcode && [190, 463, 467].includes(subcode)) return ErrorClassification.AUTH;

  if (statusCode >= 500) return ErrorClassification.TRANSIENT;
  if (statusCode === 400) return ErrorClassification.CONTENT_REJECTED;
  return ErrorClassification.UNKNOWN;
}

/**
 * Classify a Google Business Profile API error.
 */
export function classifyGoogleError(statusCode: number): ErrorClassification {
  if (statusCode === 401 || statusCode === 403) return ErrorClassification.AUTH;
  if (statusCode === 429) return ErrorClassification.RATE_LIMIT;
  if (statusCode >= 500) return ErrorClassification.TRANSIENT;
  if (statusCode === 400) return ErrorClassification.CONTENT_REJECTED;
  return ErrorClassification.UNKNOWN;
}
