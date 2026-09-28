import crypto from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const VAULT_KEY = 'ab'.repeat(32);
const mockEnv = { server: { TOKEN_VAULT_KEY: VAULT_KEY }, client: {} };
vi.mock('@/env', () => ({ env: mockEnv }));

const mockRpc = vi.fn();
const mockSelectIn = vi.fn();
const mockCreateService = vi.fn(() => ({
  rpc: mockRpc,
  from: () => ({ select: () => ({ in: (...args: unknown[]) => mockSelectIn(...args) }) }),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => mockCreateService() }));

const mockReport = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/auth/alerts', () => ({ reportAuthFailure: (...args: unknown[]) => mockReport(...args) }));

const {
  checkAuthRateLimit,
  consumeAuthRateLimit,
  peekAuthRateLimit,
  clientIpFromHeaders,
  normaliseIp,
  rateLimitKey,
  AUTH_RATE_LIMIT_RULES,
} = await import('@/lib/auth/rate-limit');

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
      signup_request: [
        { scope: 'email', limit: 3, windowSeconds: 3600 },
        { scope: 'ip', limit: 10, windowSeconds: 3600 },
      ],
      signup_email_site: [{ scope: 'site', limit: 60, windowSeconds: 3600 }],
      signup_widget_report: [{ scope: 'ip', limit: 3, windowSeconds: 3600 }],
      signup_venue: [{ scope: 'user', limit: 10, windowSeconds: 3600 }],
      owner_data_export: [{ scope: 'account', limit: 3, windowSeconds: 86400 }],
      owner_data_export_lock: [{ scope: 'account', limit: 1, windowSeconds: 60 }],
      owner_data_export_attempt: [{ scope: 'account', limit: 10, windowSeconds: 86400 }],
      venue_closure_lock: [{ scope: 'account', limit: 1, windowSeconds: 60 }],
      venue_closure_attempt: [{ scope: 'account', limit: 5, windowSeconds: 86400 }],
    });
  });
});

describe('owner data export limit (spec section 5, Later (P10))', () => {
  const BRAND = '55555555-5555-4555-8555-555555555555';

  it('allows three exports per brand per 24-hour window, whoever asks, then refuses until the window has passed', async () => {
    const limiter = fakeLimiter();
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId: BRAND })).status).toBe('allowed');
    }
    const fourth = await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId: BRAND });
    expect(fourth).toEqual({ status: 'limited', retryAfterSeconds: 86400 });
    expect(
      (await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId: '66666666-6666-4666-8666-666666666666' })).status,
    ).toBe('allowed');
    limiter.advance(86400);
    expect((await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId: BRAND })).status).toBe('allowed');
  });

  it('keys it on the brand id only as an HMAC', async () => {
    fakeLimiter();
    await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId: BRAND });
    const key = (mockRpc.mock.calls[0]?.[1] as RpcArgs).p_key;
    expect(key).toMatch(/^owner_data_export:account:[0-9a-f]{64}$/);
    expect(key).not.toContain(BRAND);
  });

  it('refuses to count a per-brand limit without a brand id (the caller fails closed)', async () => {
    fakeLimiter();
    await expect(consumeAuthRateLimit('owner_data_export', { email: '', ip: '' })).rejects.toThrow(/no brand id/);
  });
});

describe('venue creation limit (spec §4.4)', () => {
  const LOGIN = '33333333-3333-4333-8333-333333333333';

  it('allows ten venue attempts an hour per login, whatever the IP', async () => {
    fakeLimiter();
    for (let i = 0; i < 10; i += 1) {
      expect((await consumeAuthRateLimit('signup_venue', { email: '', ip: `198.51.100.${i}`, userId: LOGIN })).status).toBe(
        'allowed',
      );
    }
    expect((await consumeAuthRateLimit('signup_venue', { email: '', ip: '192.0.2.99', userId: LOGIN })).status).toBe('limited');
    expect(
      (await consumeAuthRateLimit('signup_venue', { email: '', ip: '192.0.2.99', userId: '44444444-4444-4444-8444-444444444444' }))
        .status,
    ).toBe('allowed');
  });

  it('keys it on the login id only as an HMAC', async () => {
    fakeLimiter();
    await consumeAuthRateLimit('signup_venue', { email: '', ip: PETER.ip, userId: LOGIN });
    const key = (mockRpc.mock.calls[0]?.[1] as RpcArgs).p_key;
    expect(key).toMatch(/^signup_venue:user:[0-9a-f]{64}$/);
    expect(key).not.toContain(LOGIN);
  });

  it('refuses to count a per-login limit without a login id (the caller fails closed)', async () => {
    fakeLimiter();
    await expect(consumeAuthRateLimit('signup_venue', { email: '', ip: PETER.ip })).rejects.toThrow(/no login id/);
  });
});

describe('sign-up limits (spec §4.2 step 4)', () => {
  it('allows three sign-up requests an hour per email and ten per IP', async () => {
    fakeLimiter();
    for (let i = 0; i < 3; i += 1) {
      expect((await consumeAuthRateLimit('signup_request', { email: PETER.email, ip: `198.51.100.${i}` })).status).toBe('allowed');
    }
    expect((await consumeAuthRateLimit('signup_request', { email: PETER.email, ip: '198.51.100.9' })).status).toBe('limited');
    for (let i = 0; i < 10; i += 1) {
      expect((await consumeAuthRateLimit('signup_request', { email: `venue${i}@venue.test`, ip: PETER.ip })).status).toBe(
        'allowed',
      );
    }
    expect((await consumeAuthRateLimit('signup_request', { email: 'eleventh@venue.test', ip: PETER.ip })).status).toBe('limited');
  });

  it('caps sign-up emails at 60 an hour across the whole site, whoever asks', async () => {
    fakeLimiter();
    for (let i = 0; i < 60; i += 1) {
      expect(
        (await consumeAuthRateLimit('signup_email_site', { email: `venue${i}@venue.test`, ip: `198.51.100.${i}` })).status,
      ).toBe('allowed');
    }
    expect((await consumeAuthRateLimit('signup_email_site', { email: 'new@venue.test', ip: '192.0.2.1' })).status).toBe('limited');
  });

  it('keys the site-wide cap on nothing personal', async () => {
    fakeLimiter();
    await consumeAuthRateLimit('signup_email_site', PETER);
    const key = (mockRpc.mock.calls[0]?.[1] as RpcArgs).p_key;
    expect(key).toMatch(/^signup_email_site:site:[0-9a-f]{64}$/);
    const other = rateLimitKey(Buffer.alloc(32, 1), 'signup_email_site', 'site', { email: 'a@b.test', ip: '192.0.2.1' });
    expect(other).toBe(rateLimitKey(Buffer.alloc(32, 1), 'signup_email_site', 'site', { email: 'c@d.test', ip: '192.0.2.2' }));
  });

  it('peeks at the site-wide ceiling without counting anything', async () => {
    const limiter = fakeLimiter();
    mockSelectIn.mockImplementation(async (_column: string, keys: string[]) => ({
      data: keys.flatMap((k) => {
        const row = limiter.rows.get(k);
        return row ? [{ key: k, count: row.count, reset_at: new Date(row.resetAt).toISOString() }] : [];
      }),
      error: null,
    }));

    expect(await peekAuthRateLimit('signup_email_site', PETER)).toEqual({ status: 'allowed' });
    for (let i = 0; i < 60; i += 1) await consumeAuthRateLimit('signup_email_site', PETER);
    const rpcCalls = mockRpc.mock.calls.length;
    const peeked = await peekAuthRateLimit('signup_email_site', PETER);
    expect(peeked.status).toBe('limited');
    expect(mockRpc.mock.calls.length).toBe(rpcCalls);

    limiter.advance(3601);
    expect(await peekAuthRateLimit('signup_email_site', PETER)).toEqual({ status: 'allowed' });
  });

  it('peek throws when the counters cannot be read, so the caller refuses', async () => {
    mockSelectIn.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    await expect(peekAuthRateLimit('signup_email_site', PETER)).rejects.toThrow(/auth_rate_limits read failed/);
  });

  it('throws instead of reporting, so the sign-up can raise its own alert', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function public.consume_rate_limit does not exist' } });
    await expect(consumeAuthRateLimit('signup_request', PETER)).rejects.toThrow(/consume_rate_limit failed/);
    expect(mockReport).not.toHaveBeenCalled();
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
