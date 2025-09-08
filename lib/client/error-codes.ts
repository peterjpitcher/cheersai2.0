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
  | 'UNKNOWN'

const MESSAGES: Record<ErrorCode, string> = {
  TOKEN_EXPIRED: 'Your connection has expired. Please reconnect and try again.',
  MISSING_SCOPE: 'This account is missing required permissions for publishing.',
  IG_IMAGE_REQUIRED: 'Instagram posts require at least one image.',
  RATE_LIMITED: 'Rate limited by the platform. Please retry later.',
  FORBIDDEN: 'Action not allowed for this account.',
  UNAUTHORIZED: 'Please re-authenticate your connection and try again.',
  NOT_FOUND: 'The target resource was not found.',
  INVALID_INPUT: 'Invalid input for this action.',
  PROVIDER_ERROR: 'The platform returned an error.',
  NETWORK_ERROR: 'Network error. Please check your connection and retry.',
  SERVER_ERROR: 'Upstream service error. Please retry shortly.',
  UNKNOWN: 'An unknown error occurred.',
}

export function messageForCode(code?: string, fallback?: string) {
  if (!code) return fallback || 'Request failed.'
  const k = code as ErrorCode
  return MESSAGES[k] || fallback || 'Request failed.'
}

