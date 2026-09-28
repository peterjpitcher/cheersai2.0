import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks: every dependency of requestSignup, so each can be made to fail.
// ---------------------------------------------------------------------------

const mockEnv = {
  server: { VERCEL_ENV: 'production' },
  client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' },
};
vi.mock('@/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));

type SwitchState = 'open' | 'closed' | 'unavailable';
const mockSwitch = vi.fn<() => Promise<SwitchState>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

type TurnstileResult = { status: 'passed' } | { status: 'failed'; reason: string } | { status: 'unavailable'; reason: string };
const mockVerifyTurnstile = vi.fn<(...args: unknown[]) => Promise<TurnstileResult>>(async () => ({ status: 'passed' }));
vi.mock('@/lib/signup/turnstile', () => ({
  TURNSTILE_RESPONSE_FIELD: 'cf-turnstile-response',
  turnstileRemoteIp: (headers: Headers) => headers.get('x-forwarded-for'),
  verifyTurnstileToken: (...args: unknown[]) => mockVerifyTurnstile(...args),
}));

type LimitAnswer = { status: 'allowed' } | { status: 'limited'; retryAfterSeconds: number };
const mockConsume = vi.fn<(action: string, subject: { email: string; ip: string }) => Promise<LimitAnswer>>(async () => ({
  status: 'allowed',
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeAuthRateLimit: (action: string, subject: { email: string; ip: string }) => mockConsume(action, subject),
  clientIpFromHeaders: (headers: Headers) => headers.get('x-forwarded-for') ?? 'unknown',
}));

const mockReport = vi.fn<(kind: string, error: unknown) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (kind: string, error: unknown) => mockReport(kind, error) }));

const mockSendEmail = vi.fn<(message: { to: string; subject: string; html: string; required?: boolean }) => Promise<void>>(
  async () => {},
);
vi.mock('@/lib/email/resend', () => ({
  sendEmail: (message: { to: string; subject: string; html: string; required?: boolean }) => mockSendEmail(message),
}));

vi.mock('@/lib/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

// The service-role client: per-table answers, plus rpc and the Auth admin API.
type Answer = { data: unknown; error: { message: string; code?: string; status?: number } | null };
const db: Record<string, Answer> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const mockRpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<Answer>>(async () => ({ data: 'row-id', error: null }));
const mockGetUserById = vi.fn();
const mockGenerateLink = vi.fn();

function table(name: string) {
  const answer = () => db[name] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table: name, method, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => answer();
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(answer()).then(resolve, reject);
  return chain;
}

const mockCreateService = vi.fn(() => ({
  from: (name: string) => table(name),
  rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
  auth: { admin: { getUserById: mockGetUserById, generateLink: mockGenerateLink } },
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => mockCreateService() }));

const { requestSignup } = await import('@/app/signup/actions');
const { SIGNUP_MESSAGES } = await import('@/lib/signup/messages');

// ---------------------------------------------------------------------------
// Fixtures: the four kinds of email address in spec §4.2.
// ---------------------------------------------------------------------------

const TOKEN_HASH = 'b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1';
const NEW_USER_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_USER_ID = '22222222-2222-4222-8222-222222222222';

function noLogin() {
  db.user_auth_snapshot = { data: null, error: null };
}

function existingLogin(options: { confirmed: boolean; brands: string[] }) {
  db.user_auth_snapshot = { data: { user_id: EXISTING_USER_ID }, error: null };
  mockGetUserById.mockResolvedValue({
    data: { user: { id: EXISTING_USER_ID, email_confirmed_at: options.confirmed ? '2026-09-01T10:00:00Z' : null } },
    error: null,
  });
  db.account_members = {
    data: options.brands.map((_, index) => ({ account_id: `acc-${index}` })),
    error: null,
  };
  db.accounts = { data: options.brands.map((name) => ({ business_name: name })), error: null };
}

function linkWorks(userId = NEW_USER_ID) {
  mockGenerateLink.mockResolvedValue({ data: { user: { id: userId }, properties: { hashed_token: TOKEN_HASH } }, error: null });
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const REQUEST = () => form({ email: ' Owner@Venue.test ', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' });

function sentEmail(): { to: string; subject: string; html: string } {
  expect(mockSendEmail).toHaveBeenCalledTimes(1);
  return mockSendEmail.mock.calls[0]![0];
}

function linkIn(html: string): URL {
  const href = /href="([^"]+\/auth\/confirm[^"]*)"/.exec(html)?.[1];
  expect(href).toBeTruthy();
  return new URL(href!.replace(/&amp;/g, '&'));
}

function recordCalls() {
  return mockRpc.mock.calls.filter(([fn]) => fn === 'record_self_serve_signup_request');
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(db)) delete db[key];
  calls.length = 0;
  mockEnv.server.VERCEL_ENV = 'production';
  mockSwitch.mockResolvedValue('open');
  mockVerifyTurnstile.mockResolvedValue({ status: 'passed' });
  mockConsume.mockResolvedValue({ status: 'allowed' });
  mockRpc.mockResolvedValue({ data: 'row-id', error: null });
  mockSendEmail.mockResolvedValue(undefined);
  noLogin();
  linkWorks();
});

// ---------------------------------------------------------------------------

describe('requestSignup: the same screen for every email (spec §4.2)', () => {
  it('new address: creates the login with generateLink, records one sign-up row, emails the confirmation link', async () => {
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: 'owner@venue.test' });
    expect(recordCalls()).toEqual([['record_self_serve_signup_request', { p_user_id: NEW_USER_ID }]]);
    const email = sentEmail();
    expect(email.to).toBe('owner@venue.test');
    expect(email.subject).toBe('Confirm your email to start your Cheers trial');
    const link = linkIn(email.html);
    expect(link.origin).toBe('https://cheers.orangejelly.co.uk');
    expect(link.searchParams.get('type')).toBe('signup');
    expect(link.searchParams.get('token_hash')).toBe(TOKEN_HASH);
    expect(link.searchParams.get('next')).toBe('/signup/venue');
    expect(email.html).not.toMatch(/undefined|NaN|Invalid Date|href=""/);
  });

  it('earlier sign-up never confirmed: a new link, and the same sign-up row is moved on (never missing)', async () => {
    existingLogin({ confirmed: false, brands: [] });
    linkWorks(EXISTING_USER_ID);
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(recordCalls()).toEqual([['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }]]);
    expect(linkIn(sentEmail().html).searchParams.get('type')).toBe('signup');
  });

  it('invited member who never accepted: their member invite again, with their brands, and no sign-up row', async () => {
    existingLogin({ confirmed: false, brands: ['The Anchor'] });
    linkWorks(EXISTING_USER_ID);
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: 'owner@venue.test' });
    expect(recordCalls()).toEqual([]);
    const email = sentEmail();
    expect(email.subject).toBe("You're invited to Cheers by Orange Jelly");
    expect(email.html).toContain('The Anchor');
    const link = linkIn(email.html);
    expect(link.searchParams.get('type')).toBe('invite');
    expect(link.searchParams.get('next')).toBe('/auth/set-password');
  });

  it('confirmed login: creates nothing and sends "You already have a Cheers login"', async () => {
    existingLogin({ confirmed: true, brands: ['The Anchor'] });
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(recordCalls()).toEqual([]);
    const email = sentEmail();
    expect(email.subject).toBe('You already have a Cheers login');
    expect(email.html).toContain('https://cheers.orangejelly.co.uk/login');
    expect(email.html).toContain('https://cheers.orangejelly.co.uk/forgot-password');
    expect(email.html).toContain('peter@orangejelly.co.uk');
    expect(email.html).not.toContain('/auth/confirm');
    expect(email.html).not.toMatch(/undefined|NaN|Invalid Date|href=""/);
  });

  it('over the per-email or per-IP limit: the same answer, and nothing is sent or created', async () => {
    mockConsume.mockResolvedValueOnce({ status: 'limited', retryAfterSeconds: 1200 });
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(mockConsume).toHaveBeenCalledWith('signup_request', { email: 'owner@venue.test', ip: '203.0.113.7' });
    expect(mockConsume).not.toHaveBeenCalledWith('signup_email_site', expect.anything());
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('re-requesting always leaves exactly one row per login: every request records against the same user id', async () => {
    existingLogin({ confirmed: false, brands: [] });
    linkWorks(EXISTING_USER_ID);
    await requestSignup(REQUEST());
    await requestSignup(REQUEST());
    expect(recordCalls()).toEqual([
      ['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }],
      ['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }],
    ]);
  });
});

describe('requestSignup: refuses unless it may run', () => {
  it('always refuses on Vercel Preview, before reading anything', async () => {
    mockEnv.server.VERCEL_ENV = 'preview';
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.preview });
    expect(mockSwitch).not.toHaveBeenCalled();
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('refuses while the switch is off, without an alert', async () => {
    mockSwitch.mockResolvedValue('closed');
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.notOpen });
    expect(SIGNUP_MESSAGES.notOpen).toMatch(/not open yet.*peter@orangejelly\.co\.uk/i);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('treats a switch it cannot read as off, and alerts', async () => {
    mockSwitch.mockResolvedValue('unavailable');
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.notOpen });
    expect(mockReport).toHaveBeenCalledWith('switch', expect.any(Error));
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('refuses a bad email without checking Turnstile', async () => {
    expect(await requestSignup(form({ email: 'not-an-email', 'cf-turnstile-response': 'tok' }))).toEqual({
      error: SIGNUP_MESSAGES.invalidEmail,
    });
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });

  it('refuses a failed bot check without an alert', async () => {
    mockVerifyTurnstile.mockResolvedValue({ status: 'failed', reason: 'invalid-input-response' });
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.botCheckFailed });
    expect(mockVerifyTurnstile).toHaveBeenCalledWith({ token: 'XXXX.DUMMY.TOKEN.XXXX', remoteIp: '203.0.113.7' });
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });
});

describe('requestSignup: every failing dependency shows the error and alerts (spec §4.9, §4.12)', () => {
  const COULD_NOT_FINISH = /could not finish this.*peter@orangejelly\.co\.uk/i;

  it('Turnstile down', async () => {
    mockVerifyTurnstile.mockResolvedValue({ status: 'unavailable', reason: 'siteverify request failed (TimeoutError)' });
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('turnstile', expect.any(Error));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rate limiter error', async () => {
    mockConsume.mockRejectedValue(new Error('consume_rate_limit failed: connection refused'));
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('rate_limiter', expect.any(Error));
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('site-wide email ceiling reached', async () => {
    mockConsume.mockImplementation(async (action) =>
      action === 'signup_email_site' ? { status: 'limited', retryAfterSeconds: 600 } : { status: 'allowed' },
    );
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('site_limit', expect.any(Error));
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('login lookup error', async () => {
    db.user_auth_snapshot = { data: null, error: { message: 'connection terminated' } };
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('lookup', expect.any(Error));
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('Auth admin lookup error', async () => {
    existingLogin({ confirmed: false, brands: [] });
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: { status: 500, message: 'Database error' } });
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('lookup', expect.any(Error));
  });

  it('generateLink error', async () => {
    mockGenerateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { status: 500, message: 'Database error' } });
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('generate_link', expect.any(Error));
    expect(recordCalls()).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('database error recording the sign-up', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied for table self_serve_signups' } });
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('database', expect.any(Error));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('Resend error', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend API error: rate limited'));
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('email', expect.any(Error));
  });

  it('Resend error on the member invite and the existing-login email too', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    existingLogin({ confirmed: true, brands: [] });
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    existingLogin({ confirmed: false, brands: ['The Anchor'] });
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledTimes(2);
    expect(mockReport.mock.calls.every(([kind]) => kind === 'email')).toBe(true);
  });

  it('service client cannot be created', async () => {
    mockCreateService.mockImplementationOnce(() => {
      throw new Error('Supabase credentials are not configured');
    });
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('unexpected', expect.any(Error));
  });
});
