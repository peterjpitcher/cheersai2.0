import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = { server: { TURNSTILE_SECRET_KEY: 'real-secret', VERCEL_ENV: 'production' }, client: {} };
vi.mock('@/env', () => ({ env: mockEnv }));

const { verifyTurnstileToken, turnstileRemoteIp, TURNSTILE_VERIFY_URL } = await import('@/lib/signup/turnstile');

const mockFetch = vi.fn();

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const REAL_PASS = { success: true, 'error-codes': [], hostname: 'cheers.orangejelly.co.uk', action: 'signup' };
// What Cloudflare's always-pass test secret really answers (checked 28 September 2026).
const TEST_KEY_PASS = { success: true, 'error-codes': [], hostname: 'example.com', metadata: { result_with_testing_key: true } };

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  mockEnv.server.TURNSTILE_SECRET_KEY = 'real-secret';
  mockEnv.server.VERCEL_ENV = 'production';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyTurnstileToken', () => {
  it('sends the secret, the token and the visitor IP to siteverify with a timeout', async () => {
    answer(REAL_PASS);
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: '203.0.113.7' })).toEqual({ status: 'passed' });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('real-secret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.7');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails the visitor, without calling Cloudflare, when there is no token', async () => {
    expect(await verifyTurnstileToken({ token: null, remoteIp: null })).toMatchObject({ status: 'failed' });
    expect(await verifyTurnstileToken({ token: '  ', remoteIp: null })).toMatchObject({ status: 'failed' });
    expect(await verifyTurnstileToken({ token: 'x'.repeat(2049), remoteIp: null })).toMatchObject({ status: 'failed' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails the visitor for a bad, spent or expired token', async () => {
    answer({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'failed' });
    answer({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'failed' });
  });

  it('fails a token made for another action or another site', async () => {
    answer({ ...REAL_PASS, action: 'login' });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toEqual({ status: 'failed', reason: 'wrong action' });
    answer({ ...REAL_PASS, hostname: 'evil.example' });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toEqual({ status: 'failed', reason: 'wrong hostname' });
  });

  it('is unavailable (refuse and alert) when the secret is missing', async () => {
    mockEnv.server.TURNSTILE_SECRET_KEY = '';
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is unavailable when Cloudflare rejects our secret or has an internal error', async () => {
    answer({ success: false, 'error-codes': ['invalid-input-secret'] });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
    answer({ success: false, 'error-codes': ['internal-error'] });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
    answer({ success: false });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
  });

  it('is unavailable when Cloudflare is down, slow or answers nonsense', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
    answer({ error: 'bad gateway' }, 502);
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
    mockFetch.mockResolvedValue(new Response('not json', { status: 200 }));
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'unavailable' });
  });

  it('refuses Cloudflare test keys in Production, even though they "pass"', async () => {
    answer(TEST_KEY_PASS);
    expect(await verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX', remoteIp: null })).toMatchObject({
      status: 'unavailable',
    });
  });

  it('accepts Cloudflare test keys outside Production (local development)', async () => {
    mockEnv.server.VERCEL_ENV = '';
    answer(TEST_KEY_PASS);
    expect(await verifyTurnstileToken({ token: 'XXXX.DUMMY.TOKEN.XXXX', remoteIp: null })).toEqual({ status: 'passed' });
  });

  it('checks the hostname only in Production, but the action everywhere', async () => {
    mockEnv.server.VERCEL_ENV = '';
    answer({ ...REAL_PASS, hostname: 'localhost' });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toEqual({ status: 'passed' });
    answer({ ...REAL_PASS, hostname: 'localhost', action: 'other' });
    expect(await verifyTurnstileToken({ token: 'tok', remoteIp: null })).toMatchObject({ status: 'failed' });
  });
});

describe('turnstileRemoteIp', () => {
  it('uses the first x-forwarded-for entry as given', () => {
    expect(turnstileRemoteIp(new Headers({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' }))).toBe('2001:db8::1');
    expect(turnstileRemoteIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('leaves it out when it is missing or not an IP', () => {
    expect(turnstileRemoteIp(new Headers())).toBeNull();
    expect(turnstileRemoteIp(new Headers({ 'x-forwarded-for': 'unknown' }))).toBeNull();
  });
});
