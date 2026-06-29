/**
 * Provider error classification (PLAT-07).
 * Categorises API errors from Facebook and Instagram into
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

export interface MetaGraphErrorDetails {
  status: number;
  message: string;
  type: string | null;
  code: number | null;
  subcode: number | null;
  fbtrace_id: string | null;
}

export function parseMetaGraphError(statusCode: number, errorPayload: unknown): MetaGraphErrorDetails {
  const error = readObject(readObject(errorPayload)?.error);
  return {
    status: statusCode,
    message: readString(error?.message) ?? `Meta Graph API error: ${statusCode}`,
    type: readString(error?.type),
    code: readNumber(error?.code),
    subcode: readNumber(error?.error_subcode),
    fbtrace_id: readString(error?.fbtrace_id),
  };
}

export function isExplicitMetaConnectionFailure(details: MetaGraphErrorDetails): boolean {
  if (details.status === 401 || details.status === 403) return true;
  if (details.code === 190 || details.subcode === 190 || details.subcode === 463 || details.subcode === 467) {
    return true;
  }
  if (details.code === 10 || details.code === 200) return true;

  const message = details.message.toLowerCase();
  return (
    /permission(?:s)? (?:missing|denied|required|error)/i.test(message) ||
    /does not have (?:the )?permission/i.test(message) ||
    /requires .*permission/i.test(message) ||
    /not authorized to (?:perform|access|publish)/i.test(message)
  );
}

/**
 * Classify a Meta Graph API error (Facebook + Instagram).
 * Handles HTTP status codes and Meta-specific error subcodes
 * (190 = expired token, 463 = session expired, 467 = invalid token).
 */
export function classifyMetaError(statusCode: number, errorPayload: unknown): ErrorClassification {
  const details = parseMetaGraphError(statusCode, errorPayload);
  if (statusCode === 429) return ErrorClassification.RATE_LIMIT;
  if (isExplicitMetaConnectionFailure(details)) return ErrorClassification.AUTH;
  if (statusCode >= 500) return ErrorClassification.TRANSIENT;
  if (statusCode === 400) return ErrorClassification.CONTENT_REJECTED;
  return ErrorClassification.UNKNOWN;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
