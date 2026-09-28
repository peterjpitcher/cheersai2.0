import crypto from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const VAULT_KEY = 'ab'.repeat(32);
const mockEnv = { server: { TOKEN_VAULT_KEY: VAULT_KEY }, client: {} };
vi.mock('@/env', () => ({ env: mockEnv }));

const mockRpc = vi.fn();
const mockCreateService = vi.fn(() => ({ rpc: mockRpc }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => mockCreateService() }));

const mockReport = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/auth/alerts', () => ({ reportAuthFailure: (...args: unknown[]) => mockReport(...args) }));

const { checkAuthRateLimit, clientIpFromHeaders, normaliseIp, rateLimitKey, AUTH_RATE_LIMIT_RULES } = await import(
  '@/lib/auth/rate-limit'
);

type RpcArgs = { p_key: string; p_limit: number; p_window_seconds: number };

/** A tiny in-memory stand-in for public.consume_rate_limit (fixed windows). */
function fakeLimiter() {
  const rows = new Map<string, { count: number; resetAt: number }>();
  let now = Date.parse('2026-09-28T09:00:00Z');
  mockRpc.mockImplementation(async (_fn: string, args: RpcArgs) => {
    const row = rows.get(args.p_key);
    if (!row || row.resetAt <= now) {
      rows.set(args.p_key, { count: 1, resetAt: now + args.p_window_seconds * 1000 });
    } else {
      row.count += 1;
    }
    const current = rows.get(args.p_key)!;
    return {
      data: [{ allowed: current.count <= args.p_limit, hits: current.count, resets_at: new Date(current.resetAt).toISOString() }],
      error: null,
    };
  });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    rows,
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

const PETER = { email: 'owner@venue.test', ip: '203.0.113.7' };

beforeEach(() => {
  vi.restoreAllMocks();
  mockRpc.mockReset();
  mockReport.mockClear();
  mockCreateService.mockClear();
  mockEnv.server.TOKEN_VAULT_KEY = VAULT_KEY;
});

// ---------------------------------------------------------------------------

describe('checkAuthRateLimit: allow, block, reset', () => {
  it('allows five password sign-ins a minute for one email and IP, then blocks the sixth', async () => {
    fakeLimiter();
    for (let i = 0; i < 5; i += 1) {
      expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'allowed' });
    }
    const sixth = await checkAuthRateLimit('password_sign_in', PETER);
    expect(sixth.status).toBe('limited');
    expect(sixth.status === 'limited' && sixth.retryAfterSeconds).toBe(60);
  });

  it('lets the same email in again once the window has passed', async () => {
    const limiter = fakeLimiter();
    for (let i = 0; i < 6; i += 1) await checkAuthRateLimit('password_sign_in', PETER);
    limiter.advance(61);
    expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'allowed' });
  });

  it('keys sign-in on the email and IP pair: failures from elsewhere do not lock the venue out', async () => {
    fakeLimiter();
    const attacker = { email: PETER.email, ip: '198.51.100.9' };
    for (let i = 0; i < 10; i += 1) await checkAuthRateLimit('password_sign_in', attacker);
    expect((await checkAuthRateLimit('password_sign_in', attacker)).status).toBe('limited');
    expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'allowed' });
  });

  it('caps one IP at 20 sign-ins a minute across different emails', async () => {
    fakeLimiter();
    for (let i = 0; i < 20; i += 1) {
      expect((await checkAuthRateLimit('password_sign_in', { email: `user${i}@venue.test`, ip: PETER.ip })).status).toBe(
        'allowed',
      );
    }
    expect((await checkAuthRateLimit('password_sign_in', { email: 'another@venue.test', ip: PETER.ip })).status).toBe('limited');
  });

  it('allows three magic links an hour per email, from any IP', async () => {
    fakeLimiter();
    for (let i = 0; i < 3; i += 1) {
      expect((await checkAuthRateLimit('magic_link', { email: PETER.email, ip: `203.0.113.${i + 10}` })).status).toBe('allowed');
    }
    const fourth = await checkAuthRateLimit('magic_link', { email: PETER.email, ip: '203.0.113.99' });
    expect(fourth.status).toBe('limited');
    expect(fourth.status === 'limited' && fourth.retryAfterSeconds).toBe(3600);
  });

  it('counts magic links and password resets separately', async () => {
    fakeLimiter();
    for (let i = 0; i < 3; i += 1) await checkAuthRateLimit('magic_link', PETER);
    expect((await checkAuthRateLimit('magic_link', PETER)).status).toBe('limited');
    expect(await checkAuthRateLimit('password_reset', PETER)).toEqual({ status: 'allowed' });
  });

  it('uses the limits in the spec', () => {
    expect(AUTH_RATE_LIMIT_RULES).toEqual({
      password_sign_in: [
        { scope: 'email_ip', limit: 5, windowSeconds: 60 },
        { scope: 'ip', limit: 20, windowSeconds: 60 },
      ],
      magic_link: [
        { scope: 'email', limit: 3, windowSeconds: 3600 },
        { scope: 'ip', limit: 10, windowSeconds: 3600 },
      ],
      password_reset: [
        { scope: 'email', limit: 3, windowSeconds: 3600 },
        { scope: 'ip', limit: 10, windowSeconds: 3600 },
      ],
    });
  });
});

describe('checkAuthRateLimit: keys hold nothing reversible', () => {
  it('sends only HMACs to the database, never the email or IP', async () => {
    fakeLimiter();
    await checkAuthRateLimit('password_sign_in', PETER);
    const keys = mockRpc.mock.calls.map((call) => (call[1] as RpcArgs).p_key);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^password_sign_in:(email_ip|ip):[0-9a-f]{64}$/);
      expect(key).not.toContain('owner');
      expect(key).not.toContain('venue.test');
      expect(key).not.toContain('203.0.113.7');
    }
  });

  it('is a keyed HMAC (HKDF from TOKEN_VAULT_KEY), not a plain SHA-256 of the email', async () => {
    fakeLimiter();
    await checkAuthRateLimit('magic_link', PETER);
    const emailKey = mockRpc.mock.calls.map((call) => (call[1] as RpcArgs).p_key).find((key) => key.includes(':email:'))!;
    const digest = emailKey.split(':')[2];
    expect(digest).not.toBe(crypto.createHash('sha256').update(PETER.email).digest('hex'));
    expect(digest).not.toBe(crypto.createHash('sha256').update(`email\n${PETER.email}`).digest('hex'));

    const derived = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(VAULT_KEY, 'hex'), Buffer.alloc(0), 'cheersai/auth-rate-limit/hmac-sha256/v1', 32),
    );
    expect(emailKey).toBe(rateLimitKey(derived, 'magic_link', 'email', PETER));
  });

  it('makes different keys when the vault key differs', () => {
    const a = rateLimitKey(Buffer.alloc(32, 1), 'password_reset', 'email', PETER);
    const b = rateLimitKey(Buffer.alloc(32, 2), 'password_reset', 'email', PETER);
    expect(a).not.toBe(b);
  });
});

describe('checkAuthRateLimit: fails closed and tells us', () => {
  it('returns unavailable and reports when the database call errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function public.consume_rate_limit does not exist' } });
    expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'unavailable' });
    expect(mockReport).toHaveBeenCalledWith('rate_limiter', expect.any(Error));
  });

  it('returns unavailable when the database cannot be reached at all', async () => {
    mockRpc.mockRejectedValue(new Error('fetch failed'));
    expect(await checkAuthRateLimit('magic_link', PETER)).toEqual({ status: 'unavailable' });
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when the service client cannot be created', async () => {
    mockCreateService.mockImplementationOnce(() => {
      throw new Error('Supabase credentials are not configured');
    });
    expect(await checkAuthRateLimit('password_reset', PETER)).toEqual({ status: 'unavailable' });
    expect(mockReport).toHaveBeenCalled();
  });

  it('returns unavailable for a malformed answer instead of guessing', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable without calling the database when TOKEN_VAULT_KEY is missing', async () => {
    mockEnv.server.TOKEN_VAULT_KEY = '';
    expect(await checkAuthRateLimit('password_sign_in', PETER)).toEqual({ status: 'unavailable' });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledWith('rate_limiter', expect.any(Error));
  });
});

describe('client IP', () => {
  it('takes the first x-forwarded-for entry', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to unknown', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });

  it('counts IPv6 per /64 so one network cannot rotate addresses', () => {
    expect(normaliseIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(normaliseIp('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(normaliseIp('[2001:db8::1]')).toBe('2001:db8:0:0::/64');
    expect(normaliseIp('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });

  it('treats IPv4-mapped IPv6 as the IPv4 address', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keeps anything it cannot parse as given', () => {
    expect(normaliseIp('not-an-ip')).toBe('not-an-ip');
  });
});
