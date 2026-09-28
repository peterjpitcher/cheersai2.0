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
type Subject = { email: string; ip: string };
const mockConsume = vi.fn<(action: string, subject: Subject) => Promise<LimitAnswer>>(async () => ({ status: 'allowed' }));
const mockPeek = vi.fn<(action: string, subject: Subject) => Promise<LimitAnswer>>(async () => ({ status: 'allowed' }));
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeAuthRateLimit: (action: string, subject: Subject) => mockConsume(action, subject),
  peekAuthRateLimit: (action: string, subject: Subject) => mockPeek(action, subject),
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
const tablesRead: string[] = [];
const mockRpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<Answer>>(async () => ({ data: 'row-id', error: null }));
const mockGenerateLink = vi.fn();
const mockGetUserById = vi.fn();

function table(name: string) {
  tablesRead.push(name);
  const answer = () => db[name] ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'is', 'gt']) chain[method] = () => chain;
  chain.maybeSingle = async () => answer();
  chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(answer()).then(resolve, reject);
  return chain;
}

const mockCreateService = vi.fn(() => ({
  from: (name: string) => table(name),
  rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
  auth: { admin: { generateLink: mockGenerateLink, getUserById: mockGetUserById } },
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => mockCreateService() }));

const { requestSignup, reportTurnstileWidgetFailure } = await import('@/app/signup/actions');
const { SIGNUP_MESSAGES } = await import('@/lib/signup/messages');

// ---------------------------------------------------------------------------
// Fixtures: the kinds of email address in spec §4.2, as Supabase answers them.
// ---------------------------------------------------------------------------

const TOKEN_HASH = 'b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1';
const NEW_USER_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_USER_ID = '22222222-2222-4222-8222-222222222222';

/** No login, or an unconfirmed one: generateLink returns the login and a token. */
function linkFor(userId: string, brands: string[] = [], invitedTo: string[] = []) {
  mockGenerateLink.mockResolvedValue({ data: { user: { id: userId }, properties: { hashed_token: TOKEN_HASH } }, error: null });
  db.account_members = { data: brands.map((_, index) => ({ account_id: `acc-${index}` })), error: null };
  db.team_invitations = { data: invitedTo.map((_, index) => ({ account_id: `inv-${index}` })), error: null };
  db.accounts = { data: [...brands, ...invitedTo].map((name) => ({ business_name: name })), error: null };
}

/** A confirmed login: Supabase refuses the invite and changes nothing (checked on the local stack). */
function confirmedLogin() {
  mockGenerateLink.mockResolvedValue({
    data: { user: null, properties: null },
    error: { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' },
  });
}

/** Supabase refuses the address itself, before it looks for a login (checked on the local stack). */
function refusedAddress(code: 'validation_failed' | 'email_address_invalid' = 'validation_failed', status = 400) {
  mockGenerateLink.mockResolvedValue({
    data: { user: null, properties: null },
    error: { status, code, message: 'Unable to validate email address: invalid format' },
  });
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

function siteCounted(): number {
  return mockConsume.mock.calls.filter(([action]) => action === 'signup_email_site').length;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(db)) delete db[key];
  tablesRead.length = 0;
  mockEnv.server.VERCEL_ENV = 'production';
  mockSwitch.mockResolvedValue('open');
  mockVerifyTurnstile.mockResolvedValue({ status: 'passed' });
  mockConsume.mockResolvedValue({ status: 'allowed' });
  mockPeek.mockResolvedValue({ status: 'allowed' });
  mockRpc.mockResolvedValue({ data: 'row-id', error: null });
  mockSendEmail.mockResolvedValue(undefined);
  linkFor(NEW_USER_ID);
});

// ---------------------------------------------------------------------------

describe('requestSignup: the same screen for every email (spec §4.2)', () => {
  it('new address: generateLink makes the login, one sign-up row is recorded, the confirmation link is emailed', async () => {
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'invite', email: 'owner@venue.test' });
    expect(recordCalls()).toEqual([['record_self_serve_signup_request', { p_user_id: NEW_USER_ID }]]);
    expect(siteCounted()).toBe(1);
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
    linkFor(EXISTING_USER_ID);
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(recordCalls()).toEqual([['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }]]);
    expect(linkIn(sentEmail().html).searchParams.get('type')).toBe('signup');
  });

  it('invited member who never accepted: their member invite again, with their brands, and no sign-up row', async () => {
    linkFor(EXISTING_USER_ID, ['The Anchor']);
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

  it('a login whose only link to a brand is a pending team invitation: that invite again, naming the brand, no sign-up row', async () => {
    linkFor(EXISTING_USER_ID, [], ['The Old Bell']);
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(recordCalls()).toEqual([]);
    expect(tablesRead).toContain('team_invitations');
    const email = sentEmail();
    expect(email.subject).toBe("You're invited to Cheers by Orange Jelly");
    expect(email.html).toContain('The Old Bell');
    const link = linkIn(email.html);
    expect(link.searchParams.get('type')).toBe('invite');
    expect(link.searchParams.get('next')).toBe('/auth/set-password');
    expect(email.html).not.toContain('/signup/venue');
    expect(email.html).not.toContain('Confirm your email to start');
  });

  it('confirmed login: Supabase refuses the invite, nothing is created, "You already have a Cheers login" is sent', async () => {
    confirmedLogin();
    expect(await requestSignup(REQUEST())).toEqual({ success: true });

    expect(recordCalls()).toEqual([]);
    expect(mockReport).not.toHaveBeenCalled();
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
    expect(siteCounted()).toBe(0);
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('re-requesting always leaves exactly one row per login: every request records against the same user id', async () => {
    linkFor(EXISTING_USER_ID);
    await requestSignup(REQUEST());
    await requestSignup(REQUEST());
    expect(recordCalls()).toEqual([
      ['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }],
      ['record_self_serve_signup_request', { p_user_id: EXISTING_USER_ID }],
    ]);
  });

  it('never looks a login up before Supabase has checked the address, so the answer cannot depend on who has one', async () => {
    await requestSignup(REQUEST());
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(tablesRead).not.toContain('user_auth_snapshot');
    const linkOrder = mockGenerateLink.mock.invocationCallOrder[0]!;
    expect(linkOrder).toBeGreaterThan(mockPeek.mock.invocationCallOrder[0]!);
  });
});

describe('requestSignup: an address Supabase will not accept (review of #144)', () => {
  it('asks for a valid address, with no alert and no admin_audit row, and uses none of the site-wide ceiling', async () => {
    refusedAddress();
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.invalidEmail });

    expect(mockReport).not.toHaveBeenCalled();
    expect(siteCounted()).toBe(0);
    expect(recordCalls()).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('treats email_address_invalid (400 or 422) the same way', async () => {
    refusedAddress('email_address_invalid', 422);
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.invalidEmail });
    refusedAddress('email_address_invalid', 400);
    expect(await requestSignup(REQUEST())).toEqual({ error: SIGNUP_MESSAGES.invalidEmail });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('gives the same answer whether or not a legacy login has that address: Supabase checks the address first', async () => {
    // Supabase validates before it looks for the login, so a refused address
    // answers the same for everyone; nothing else is read first.
    refusedAddress();
    const first = await requestSignup(REQUEST());
    refusedAddress();
    const second = await requestSignup(form({ email: 'legacy@venue.test', 'cf-turnstile-response': 'tok' }));
    expect(first).toEqual(second);
    expect(tablesRead).toEqual([]);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('keeps a real outage (a 5xx twice) a generate_link failure with an alert', async () => {
    mockGenerateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { status: 500, code: 'unexpected_failure', message: 'Database error' } });
    expect((await requestSignup(REQUEST())).error).toMatch(/could not finish this/i);
    expect(mockGenerateLink).toHaveBeenCalledTimes(2);
    expect(mockReport).toHaveBeenCalledWith('generate_link', expect.any(Error));
  });

  it('tries generateLink once more after a 5xx (two requests racing for a new address), then carries on with no alert', async () => {
    mockGenerateLink
      .mockResolvedValueOnce({
        data: { user: null, properties: null },
        error: { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' },
      })
      .mockResolvedValueOnce({ data: { user: { id: NEW_USER_ID }, properties: { hashed_token: TOKEN_HASH } }, error: null });
    expect(await requestSignup(REQUEST())).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledTimes(2);
    expect(mockReport).not.toHaveBeenCalled();
    expect(recordCalls()).toEqual([['record_self_serve_signup_request', { p_user_id: NEW_USER_ID }]]);
  });

  it('does not retry a refused address or a confirmed login', async () => {
    refusedAddress();
    await requestSignup(REQUEST());
    confirmedLogin();
    await requestSignup(REQUEST());
    expect(mockGenerateLink).toHaveBeenCalledTimes(2);
  });

  it('keeps a network failure or timeout a generate_link failure with an alert', async () => {
    mockGenerateLink.mockRejectedValue(new Error('fetch failed'));
    expect((await requestSignup(REQUEST())).error).toMatch(/could not finish this/i);
    expect(mockReport).toHaveBeenCalledWith('generate_link', expect.any(Error));

    mockReport.mockClear();
    mockGenerateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { status: 0, message: 'The operation was aborted' } });
    expect((await requestSignup(REQUEST())).error).toMatch(/could not finish this/i);
    expect(mockReport).toHaveBeenCalledWith('generate_link', expect.any(Error));
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

  it('site-wide ceiling unreadable', async () => {
    mockPeek.mockRejectedValue(new Error('auth_rate_limits read failed: timeout'));
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('rate_limiter', expect.any(Error));
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('site-wide email ceiling reached: refused before anything is created', async () => {
    mockPeek.mockResolvedValue({ status: 'limited', retryAfterSeconds: 600 });
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('site_limit', expect.any(Error));
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('site-wide email ceiling reached by requests arriving together: refused before the email', async () => {
    mockConsume.mockImplementation(async (action) =>
      action === 'signup_email_site' ? { status: 'limited', retryAfterSeconds: 600 } : { status: 'allowed' },
    );
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('site_limit', expect.any(Error));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('team invitation lookup error', async () => {
    db.team_invitations = { data: null, error: { message: 'connection terminated' } };
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('lookup', expect.any(Error));
    expect(recordCalls()).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('membership lookup error', async () => {
    db.account_members = { data: null, error: { message: 'connection terminated' } };
    const result = await requestSignup(REQUEST());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('lookup', expect.any(Error));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('generateLink error', async () => {
    mockGenerateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { status: 503, message: 'Service Unavailable' } });
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
    confirmedLogin();
    expect((await requestSignup(REQUEST())).error).toMatch(COULD_NOT_FINISH);
    linkFor(EXISTING_USER_ID, ['The Anchor']);
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

describe('reportTurnstileWidgetFailure: a broken widget is never silent on our side (review of #144)', () => {
  it('raises a turnstile_widget alert with the reason and Cloudflare code, and nothing about the visitor', async () => {
    await reportTurnstileWidgetFailure({ reason: 'widget_error', code: '110200' });

    expect(mockConsume).toHaveBeenCalledWith('signup_widget_report', { email: '', ip: '203.0.113.7' });
    expect(mockReport).toHaveBeenCalledTimes(1);
    const [kind, error] = mockReport.mock.calls[0] as [string, Error];
    expect(kind).toBe('turnstile_widget');
    expect(error.message).toContain('widget_error');
    expect(error.message).toContain('110200');
    expect(error.message).not.toContain('203.0.113.7');
  });

  it('reports a script that never loaded or a widget that refused our parameters', async () => {
    await reportTurnstileWidgetFailure({ reason: 'script_timeout' });
    await reportTurnstileWidgetFailure({ reason: 'script_load_failed' });
    await reportTurnstileWidgetFailure({ reason: 'render_failed' });
    expect(mockReport).toHaveBeenCalledTimes(3);
  });

  it('reports every Cloudflare site key, domain or configuration code', async () => {
    for (const code of ['110100', '110110', '110200', '400020', '400021', '400070']) {
      await reportTurnstileWidgetFailure({ reason: 'widget_error', code });
    }
    expect(mockReport).toHaveBeenCalledTimes(6);
  });

  it("never reports the visitor's own failures: timeouts, clock, blocked iframe, failed challenges, or no code", async () => {
    for (const code of ['110600', '110620', '200100', '200500', '300010', '300030', '600010', '600020']) {
      await reportTurnstileWidgetFailure({ reason: 'widget_error', code });
    }
    await reportTurnstileWidgetFailure({ reason: 'widget_error' });
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('does nothing while the switch is off, or on Vercel Preview', async () => {
    mockSwitch.mockResolvedValue('closed');
    await reportTurnstileWidgetFailure({ reason: 'widget_error' });
    mockSwitch.mockResolvedValue('unavailable');
    await reportTurnstileWidgetFailure({ reason: 'widget_error' });
    mockSwitch.mockResolvedValue('open');
    mockEnv.server.VERCEL_ENV = 'preview';
    await reportTurnstileWidgetFailure({ reason: 'widget_error' });
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('is limited per IP, so it cannot be used to flood alerts', async () => {
    mockConsume.mockResolvedValue({ status: 'limited', retryAfterSeconds: 3000 });
    await reportTurnstileWidgetFailure({ reason: 'widget_error' });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('stays quiet when the limiter cannot answer', async () => {
    mockConsume.mockRejectedValue(new Error('connection refused'));
    await expect(reportTurnstileWidgetFailure({ reason: 'widget_error' })).resolves.toBeUndefined();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('ignores anything it did not expect: no free text reaches the alert', async () => {
    await reportTurnstileWidgetFailure({ reason: 'owner@venue.test' });
    await reportTurnstileWidgetFailure({ reason: 'widget_error', code: '<script>' });
    await reportTurnstileWidgetFailure('widget_error');
    await reportTurnstileWidgetFailure(null);
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });
});
