import 'server-only';

import net from 'node:net';

import { env } from '@/env';
import { COMPANY } from '@/lib/legal/company';

// ---------------------------------------------------------------------------
// Cloudflare Turnstile, checked by our server (tasks/SPEC-self-serve-signup.md
// §4.2 step 3, decision P9). Only the sign-up form uses it.
// ---------------------------------------------------------------------------

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The action the widget on /signup sends; siteverify echoes it back. */
export const TURNSTILE_SIGNUP_ACTION = 'signup';

/** The form field the widget fills in. */
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';

const VERIFY_TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 2048;

/**
 * - passed: the visitor passed the check.
 * - failed: the visitor did not (no token, a spent or expired token, a token
 *   from another page or site). Their problem, so no operator alert.
 * - unavailable: we could not check (no secret, Cloudflare down or slow, a
 *   secret Cloudflare rejects, test keys in Production). Refuse and alert.
 */
export type TurnstileResult =
  | { status: 'passed' }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable'; reason: string };

/** Error codes that mean the visitor's token is no good. Anything else is on our side or Cloudflare's. */
const VISITOR_ERROR_CODES = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);

/**
 * The visitor's IP as Cloudflare wants it: the first x-forwarded-for entry,
 * which Vercel sets and overwrites. Not the /64-grouped form the rate limiter
 * uses. Null when it is not a plain IP address (it is optional for siteverify).
 */
export function turnstileRemoteIp(headers: Pick<Headers, 'get'>): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return net.isIP(first) ? first : null;
}

interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: unknown;
  hostname?: unknown;
  action?: unknown;
  metadata?: { result_with_testing_key?: unknown } | null;
}

/**
 * Check a Turnstile token with siteverify. Never throws.
 *
 * In Production (VERCEL_ENV=production) the answer must come from the real
 * secret, for the action `signup`, on cheers.orangejelly.co.uk. Elsewhere
 * Cloudflare's test keys are expected: their answers carry
 * `metadata.result_with_testing_key` and no action or real hostname, so those
 * two checks apply only to real keys and the hostname only in Production.
 */
export async function verifyTurnstileToken(options: {
  token: string | null;
  remoteIp: string | null;
}): Promise<TurnstileResult> {
  const secret = env.server.TURNSTILE_SECRET_KEY;
  if (!secret) return { status: 'unavailable', reason: 'TURNSTILE_SECRET_KEY is not set' };

  const token = options.token?.trim() ?? '';
  if (!token) return { status: 'failed', reason: 'no token' };
  if (token.length > MAX_TOKEN_LENGTH) return { status: 'failed', reason: 'token too long' };

  const body = new URLSearchParams({ secret, response: token });
  if (options.remoteIp) body.set('remoteip', options.remoteIp);

  let answer: SiteverifyResponse;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return { status: 'unavailable', reason: `siteverify answered HTTP ${response.status}` };
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') return { status: 'unavailable', reason: 'siteverify answer was not an object' };
    answer = parsed as SiteverifyResponse;
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { status: 'unavailable', reason: `siteverify request failed (${message})` };
  }

  const production = env.server.VERCEL_ENV === 'production';
  const testingKey = answer.metadata?.result_with_testing_key === true;

  if (answer.success !== true) {
    const codes = Array.isArray(answer['error-codes'])
      ? answer['error-codes'].filter((code): code is string => typeof code === 'string')
      : [];
    if (codes.length > 0 && codes.every((code) => VISITOR_ERROR_CODES.has(code))) {
      return { status: 'failed', reason: codes.join(',') };
    }
    return { status: 'unavailable', reason: `siteverify refused: ${codes.join(',') || 'no error code'}` };
  }

  if (testingKey) {
    if (production) return { status: 'unavailable', reason: 'Cloudflare test keys are in use in Production' };
    return { status: 'passed' };
  }

  if (answer.action !== TURNSTILE_SIGNUP_ACTION) return { status: 'failed', reason: 'wrong action' };
  if (production && answer.hostname !== COMPANY.siteHost) return { status: 'failed', reason: 'wrong hostname' };
  return { status: 'passed' };
}
