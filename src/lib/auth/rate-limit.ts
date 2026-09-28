import 'server-only';

import crypto from 'node:crypto';
import net from 'node:net';

import { env } from '@/env';
import { reportAuthFailure } from '@/lib/auth/alerts';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Auth rate limits, kept in our own database (tasks/SPEC-self-serve-signup.md
// §4.11, decision P8). Every attempt is counted by public.consume_rate_limit
// (migration 20260928120000) through the service-role client.
//
// Fails closed: if the limiter cannot answer, the caller refuses the action with
// a visible error and the operator is told. The migration must therefore be
// applied before this code deploys.
// ---------------------------------------------------------------------------

export type AuthRateLimitAction = 'password_sign_in' | 'magic_link' | 'password_reset';

type LimitScope = 'email_ip' | 'email' | 'ip';

interface LimitRule {
  scope: LimitScope;
  limit: number;
  windowSeconds: number;
}

/**
 * Spec §4.11. Password sign-in is keyed on the email and IP pair, so nobody can
 * lock a venue out of its login by failing to sign in as it from somewhere
 * else. Magic links and resets are keyed on the email alone as well, because
 * each one sends an email to that address.
 */
export const AUTH_RATE_LIMIT_RULES: Record<AuthRateLimitAction, readonly LimitRule[]> = {
  password_sign_in: [
    { scope: 'email_ip', limit: 5, windowSeconds: 60 },
    { scope: 'ip', limit: 20, windowSeconds: 60 },
  ],
  magic_link: [
    { scope: 'email', limit: 3, windowSeconds: 60 * 60 },
    { scope: 'ip', limit: 10, windowSeconds: 60 * 60 },
  ],
  password_reset: [
    { scope: 'email', limit: 3, windowSeconds: 60 * 60 },
    { scope: 'ip', limit: 10, windowSeconds: 60 * 60 },
  ],
};

export type AuthRateLimitDecision =
  | { status: 'allowed' }
  | { status: 'limited'; retryAfterSeconds: number }
  | { status: 'unavailable' };

// ---------------------------------------------------------------------------
// Keys
//
// The HMAC key is derived from TOKEN_VAULT_KEY with HKDF-SHA256 and a fixed
// label, so there is no new environment variable to set in Vercel.
// Why TOKEN_VAULT_KEY: it is 32 random bytes, server-only, and already required
// (and checked as 64 hex characters) by src/env.ts in every production-mode
// build, Production and Preview alike. It is not stored in the database, so
// someone who can read auth_rate_limits still cannot test email or IP guesses
// against the keys. (The service role key would not give that: it opens the
// database itself.) HKDF with its own label keeps the two uses apart: the
// derived key reveals nothing about the vault key. Rotating TOKEN_VAULT_KEY
// only restarts the counters, which is harmless.
// ---------------------------------------------------------------------------

const HMAC_KEY_LABEL = 'cheersai/auth-rate-limit/hmac-sha256/v1';
const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

let cachedHmacKey: { source: string; key: Buffer } | null = null;

function rateLimitHmacKey(): Buffer {
  const source = env.server.TOKEN_VAULT_KEY;
  if (!source || !HEX_KEY_PATTERN.test(source)) {
    throw new Error('TOKEN_VAULT_KEY is missing or not 64 hex characters, so rate-limit keys cannot be made.');
  }
  if (cachedHmacKey?.source === source) return cachedHmacKey.key;
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(source, 'hex'), Buffer.alloc(0), HMAC_KEY_LABEL, 32));
  cachedHmacKey = { source, key };
  return key;
}

/** The stored key: purpose and scope in clear, the email and IP only as an HMAC. */
export function rateLimitKey(
  hmacKey: Buffer,
  action: AuthRateLimitAction,
  scope: LimitScope,
  subject: { email: string; ip: string },
): string {
  const input =
    scope === 'email_ip' ? `email_ip\n${subject.email}\n${subject.ip}` : scope === 'email' ? `email\n${subject.email}` : `ip\n${subject.ip}`;
  const digest = crypto.createHmac('sha256', hmacKey).update(input).digest('hex');
  return `${action}:${scope}:${digest}`;
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/**
 * The visitor's IP: the first x-forwarded-for entry, which Vercel sets and
 * overwrites so a client cannot choose it. `unknown` when there is none (never
 * on Vercel).
 */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded || headers.get('x-real-ip')?.trim() || '';
  return normaliseIp(candidate);
}

/**
 * IPv4 as is. IPv6 counts per /64, because one home or server usually holds a
 * whole /64 and could otherwise pick a fresh address for every attempt.
 * Anything unparseable is used as given.
 */
export function normaliseIp(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').split('%')[0] ?? '';
  if (!ip) return 'unknown';
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return ip;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1] && net.isIPv4(mapped[1])) return mapped[1];

  const groups = expandIpv6(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  let address = ip;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (embedded?.[1]) {
    const [a, b, c, d] = embedded[1].split('.').map(Number) as [number, number, number, number];
    address = `${address.slice(0, -embedded[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

interface ConsumeRow {
  allowed: boolean;
  resetsAt: string;
}

function parseConsumeRow(data: unknown): ConsumeRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const { allowed, resets_at: resetsAt } = row as { allowed?: unknown; resets_at?: unknown };
  if (typeof allowed !== 'boolean' || typeof resetsAt !== 'string') return null;
  return { allowed, resetsAt };
}

/**
 * Count one attempt at an auth action and say whether it may go ahead.
 * Every rule for the action is counted, and all must allow it. Any error
 * (no key, no database, no function, a malformed answer) returns
 * `unavailable` after telling the operator; callers must then refuse.
 */
export async function checkAuthRateLimit(
  action: AuthRateLimitAction,
  subject: { email: string; ip: string },
): Promise<AuthRateLimitDecision> {
  const rules = AUTH_RATE_LIMIT_RULES[action];
  try {
    const hmacKey = rateLimitHmacKey();
    const service = createServiceSupabaseClient();
    const results = await Promise.all(
      rules.map(async (rule) => {
        const { data, error } = await service.rpc('consume_rate_limit', {
          p_key: rateLimitKey(hmacKey, action, rule.scope, subject),
          p_limit: rule.limit,
          p_window_seconds: rule.windowSeconds,
        });
        if (error) throw new Error(`consume_rate_limit failed: ${error.message}`);
        const row = parseConsumeRow(data);
        if (!row) throw new Error('consume_rate_limit returned no usable row');
        return { rule, row };
      }),
    );

    const blocked = results.filter(({ row }) => !row.allowed);
    if (blocked.length === 0) return { status: 'allowed' };

    const now = Date.now();
    const waits = blocked.map(({ rule, row }) => {
      const seconds = Math.ceil((Date.parse(row.resetsAt) - now) / 1000);
      return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), rule.windowSeconds) : rule.windowSeconds;
    });
    return { status: 'limited', retryAfterSeconds: Math.max(...waits) };
  } catch (error) {
    await reportAuthFailure('rate_limiter', error);
    return { status: 'unavailable' };
  }
}

// ---------------------------------------------------------------------------
// In-memory helpers for two non-auth API routes (the tournament feed and the
// event-artwork import). Per server instance only; not used for sign-in.
// ---------------------------------------------------------------------------

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function extractIp(request: Request): string | null {
  const candidates = [
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-vercel-forwarded-for'),
    request.headers.get('x-client-ip'),
  ];

  for (const entry of candidates) {
    if (!entry) continue;
    const [first] = entry.split(',');
    const trimmed = first?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

export function getRateLimitKey(request: Request, prefix: string): string {
  const ip = extractIp(request);
  const base = ip
    ? `ip:${ip}`
    : `ua:${hashValue(request.headers.get('user-agent') ?? 'unknown')}`;
  return `${prefix}:${base}`;
}

const fallbackStore = new Map<string, { count: number; resetAt: number }>();

export async function isRateLimited(params: {
  key: string;
  maxAttempts: number;
  windowMs: number;
}): Promise<boolean> {
  const { key, maxAttempts, windowMs } = params;
  const now = Date.now();
  const record = fallbackStore.get(key);

  if (!record || record.resetAt < now) {
    fallbackStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  record.count += 1;
  fallbackStore.set(key, record);
  return record.count > maxAttempts;
}
