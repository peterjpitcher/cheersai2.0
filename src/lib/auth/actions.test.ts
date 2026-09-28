import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSignInWithOtp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
  })),
}));

const mockGenerateLink = vi.fn();
const mockGetUserById = vi.fn();
/** The service client's `from(table).select(columns).eq(column, value).maybeSingle()` answer. */
const mockSnapshotLookup = vi.fn<(query: { table: string; columns: string; column: string; value: string }) => unknown>();
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    auth: { admin: { generateLink: mockGenerateLink, getUserById: mockGetUserById } },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => mockSnapshotLookup({ table, columns, column, value }),
        }),
      }),
    }),
  })),
}));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

type Decision = { status: 'allowed' } | { status: 'limited'; retryAfterSeconds: number } | { status: 'unavailable' };
const mockCheckRateLimit = vi.fn<(...args: unknown[]) => Promise<Decision>>(async () => ({ status: 'allowed' }));
vi.mock('@/lib/auth/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  clientIpFromHeaders: (headers: Headers) => headers.get('x-forwarded-for') ?? 'unknown',
}));
const mockReport = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/auth/alerts', () => ({ reportAuthFailure: (...args: unknown[]) => mockReport(...args) }));

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: vi.fn() }));
const mockDestination = vi.fn(async () => '/planner');
vi.mock('@/lib/billing/setup-redirect', () => ({ destinationAfterPasswordSet: () => mockDestination() }));
const mockEnv = vi.hoisted(() => ({
  client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' as string | undefined },
  server: {},
}));
vi.mock('@/env', () => ({ env: mockEnv }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { sendMagicLink, signInWithPassword, setPassword, requestPasswordReset } = await import('@/lib/auth/actions');

const COULD_NOT_FINISH = /could not finish this.*peter@orangejelly\.co\.uk/i;

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.client.NEXT_PUBLIC_SITE_URL = 'https://cheers.orangejelly.co.uk';
  mockCheckRateLimit.mockResolvedValue({ status: 'allowed' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------

describe('sendMagicLink', () => {
  const OWNER = 'owner@venue.test';
  const LOGIN_ID = '5b0c1f7e-3d2a-4c8b-9e61-2f4a7d9c0e13';

  /** A confirmed login for OWNER, and every dependency answering. */
  function knownConfirmedLogin(): void {
    mockSnapshotLookup.mockResolvedValue({ data: { user_id: LOGIN_ID }, error: null });
    mockGetUserById.mockResolvedValue({
      data: { user: { id: LOGIN_ID, email: OWNER, email_confirmed_at: '2026-09-01T09:00:00Z' } },
      error: null,
    });
    mockGenerateLink.mockResolvedValue({
      data: { user: { id: LOGIN_ID }, properties: { hashed_token: 'tok', verification_type: 'magiclink' } },
      error: null,
    });
    mockSendEmail.mockResolvedValue(undefined);
  }

  /** The error passed to the operator alert, which must never carry the visitor's address. */
  function reportedError(): Error {
    expect(mockReport).toHaveBeenCalledWith('magic_link', expect.any(Error));
    const error = mockReport.mock.calls[0]?.[1] as Error;
    expect(error.message).not.toContain(OWNER);
    return error;
  }

  function expectNothingSent(): void {
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  }

  it('sends our own email through Resend with a link to /auth/confirm and the safe next path', async () => {
    knownConfirmedLogin();
    expect(await sendMagicLink(form({ email: 'Owner@Venue.test', next: '/planner' }))).toEqual({ success: true });

    expect(mockSnapshotLookup).toHaveBeenCalledWith({ table: 'user_auth_snapshot', columns: 'user_id', column: 'email', value: OWNER });
    expect(mockGetUserById).toHaveBeenCalledWith(LOGIN_ID);
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'magiclink', email: OWNER });
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; subject: string; html: string; required: boolean };
    expect(sent.to).toBe(OWNER);
    expect(sent.required).toBe(true);
    expect(sent.subject).toBe('Your Cheers sign-in link');
    expect(sent.html).toContain(
      'https://cheers.orangejelly.co.uk/auth/confirm?token_hash=tok&amp;type=magiclink&amp;next=%2Fplanner',
    );
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('never puts an off-site next into the link', async () => {
    knownConfirmedLogin();
    await sendMagicLink(form({ email: OWNER, next: 'https://evil.example/steal' }));
    const sent = mockSendEmail.mock.calls[0]?.[0] as { html: string };
    expect(sent.html).toContain('type=magiclink&amp;next=%2Fdashboard');
    expect(sent.html).not.toContain('evil.example');
  });

  it('goes to the dashboard when the form names no next', async () => {
    knownConfirmedLogin();
    await sendMagicLink(form({ email: OWNER }));
    expect((mockSendEmail.mock.calls[0]?.[0] as { html: string }).html).toContain('next=%2Fdashboard');
  });

  it('never creates a login: an unknown address gets the same answer and nothing is made or sent', async () => {
    mockSnapshotLookup.mockResolvedValue({ data: null, error: null });
    expect(await sendMagicLink(form({ email: 'stranger@example.test' }))).toEqual({ success: true });
    expect(mockGetUserById).not.toHaveBeenCalled();
    expectNothingSent();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('sends nothing to an unconfirmed login (a pending invite or sign-up), with the same answer', async () => {
    knownConfirmedLogin();
    mockGetUserById.mockResolvedValue({ data: { user: { id: LOGIN_ID, email: OWNER, email_confirmed_at: null } }, error: null });
    expect(await sendMagicLink(form({ email: OWNER }))).toEqual({ success: true });
    expectNothingSent();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('sends nothing when the snapshot row outlived its login, with the same answer', async () => {
    knownConfirmedLogin();
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } });
    expect(await sendMagicLink(form({ email: OWNER }))).toEqual({ success: true });
    expectNothingSent();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('sends nothing when the login now has a different email, with the same answer', async () => {
    knownConfirmedLogin();
    mockGetUserById.mockResolvedValue({
      data: { user: { id: LOGIN_ID, email: 'moved@venue.test', email_confirmed_at: '2026-09-01T09:00:00Z' } },
      error: null,
    });
    expect(await sendMagicLink(form({ email: OWNER }))).toEqual({ success: true });
    expectNothingSent();
  });

  it('counts the request against the email and the visitor IP', async () => {
    knownConfirmedLogin();
    await sendMagicLink(form({ email: 'Owner@Venue.test' }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith('magic_link', { email: OWNER, ip: '203.0.113.7' });
  });

  it('refuses, without looking anything up or sending, when the limit is reached', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'limited', retryAfterSeconds: 1500 });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result.error).toBe('Too many requests. Please try again in 25 minutes.');
    expect(mockSnapshotLookup).not.toHaveBeenCalled();
    expectNothingSent();
  });

  // One test per failing dependency: the user sees the error with our contact
  // email, and the operator alert is raised (for the limiter, by
  // checkAuthRateLimit itself).

  it('fails closed, without looking anything up or sending, when the rate limiter is unavailable', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'unavailable' });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockSnapshotLookup).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it('fails closed and tells us when the site address is not configured', async () => {
    knownConfirmedLogin();
    mockEnv.client.NEXT_PUBLIC_SITE_URL = undefined;
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    expect(reportedError().message).toContain('NEXT_PUBLIC_SITE_URL');
    expectNothingSent();
  });

  it('fails closed and tells us when the address lookup fails', async () => {
    knownConfirmedLogin();
    mockSnapshotLookup.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    expect(reportedError().message).toContain('user_auth_snapshot lookup failed');
    expectNothingSent();
  });

  it('fails closed and tells us when Supabase Auth cannot say whether the login is confirmed', async () => {
    knownConfirmedLogin();
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: { status: 500, message: 'Database error' } });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    expect(reportedError().message).toContain('getUserById');
    expectNothingSent();
  });

  it('fails closed and tells us when Supabase cannot make the link', async () => {
    knownConfirmedLogin();
    mockGenerateLink.mockResolvedValue({ data: null, error: { status: 500, message: 'Database error' } });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    expect(reportedError().message).toContain('generateLink');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('never emails a link made for another login, and tells us', async () => {
    knownConfirmedLogin();
    mockGenerateLink.mockResolvedValue({
      data: { user: { id: 'a-new-login' }, properties: { hashed_token: 'tok', verification_type: 'signup' } },
      error: null,
    });
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    reportedError();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed with a visible error, and tells us, when Resend cannot send the email', async () => {
    knownConfirmedLogin();
    mockSendEmail.mockRejectedValue(new Error('Resend API error: service unavailable'));
    const result = await sendMagicLink(form({ email: OWNER }));
    expect(result).toEqual({ error: expect.stringMatching(COULD_NOT_FINISH) });
    expect(reportedError().message).toContain('Resend');
  });

  it('gives a known, an unknown and an unconfirmed address the identical answer', async () => {
    knownConfirmedLogin();
    const known = await sendMagicLink(form({ email: OWNER }));
    mockSnapshotLookup.mockResolvedValue({ data: null, error: null });
    const unknown = await sendMagicLink(form({ email: 'stranger@example.test' }));
    knownConfirmedLogin();
    mockGetUserById.mockResolvedValue({ data: { user: { id: LOGIN_ID, email: OWNER, email_confirmed_at: null } }, error: null });
    const unconfirmed = await sendMagicLink(form({ email: OWNER }));
    expect(unknown).toEqual(known);
    expect(unconfirmed).toEqual(known);
  });
});

describe('signInWithPassword', () => {
  const valid = () => form({ email: 'Owner@Venue.test', password: 'correct-horse-battery' });

  it('signs in and counts the attempt against the email and IP pair', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    expect(await signInWithPassword(valid())).toEqual({ success: true });
    expect(mockCheckRateLimit).toHaveBeenCalledWith('password_sign_in', { email: 'owner@venue.test', ip: '203.0.113.7' });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'owner@venue.test', password: 'correct-horse-battery' });
  });

  it('says "Invalid email or password" for wrong credentials, without alerting', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    expect(await signInWithPassword(valid())).toEqual({ error: 'Invalid email or password.' });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('fails closed and tells us when Supabase Auth cannot be reached', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { status: 0, message: 'fetch failed' } });
    const result = await signInWithPassword(valid());
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('sign_in', expect.any(Error));
  });

  it('fails closed and tells us when the client throws', async () => {
    mockSignInWithPassword.mockRejectedValue(new Error('boom'));
    const result = await signInWithPassword(valid());
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('sign_in', expect.any(Error));
  });

  it('refuses, without trying the password, when the limit is reached', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'limited', retryAfterSeconds: 42 });
    expect(await signInWithPassword(valid())).toEqual({
      error: 'Too many sign-in attempts. Please wait a minute and try again.',
    });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('fails closed, without trying the password, when the rate limiter is unavailable', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'unavailable' });
    const result = await signInWithPassword(valid());
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('validates before counting an attempt', async () => {
    expect((await signInWithPassword(form({ email: 'not-an-email', password: 'x' }))).error).toBeDefined();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe('setPassword', () => {
  it('rejects short passwords without calling Supabase', async () => {
    const result = await setPassword(form({ password: 'short', confirm: 'short' }));
    expect(result.error).toMatch(/12 characters/);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    const result = await setPassword(form({ password: 'a-long-password-1', confirm: 'a-long-password-2' }));
    expect(result.error).toMatch(/do not match/);
  });

  it('tells the user when the session has gone', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await setPassword(form({ password: 'a-long-password-1', confirm: 'a-long-password-1' }));
    expect(result.error).toMatch(/expired/);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('shows an error when Supabase fails to save', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpdateUser.mockResolvedValue({ error: { message: 'boom' } });
    const result = await setPassword(form({ password: 'a-long-password-1', confirm: 'a-long-password-1' }));
    expect(result.error).toBeDefined();
    expect(result.success).toBeUndefined();
  });

  it('saves a valid password', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpdateUser.mockResolvedValue({ error: null });
    const result = await setPassword(form({ password: 'a-long-password-1', confirm: 'a-long-password-1' }));
    expect(result).toEqual({ success: true, next: '/planner' });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'a-long-password-1' });
  });

  it('sends an owner whose brand has not set up billing to the Billing section', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpdateUser.mockResolvedValue({ error: null });
    mockDestination.mockResolvedValueOnce('/settings#billing');
    const result = await setPassword(form({ password: 'a-long-password-1', confirm: 'a-long-password-1' }));
    expect(result).toEqual({ success: true, next: '/settings#billing' });
  });
});

describe('requestPasswordReset', () => {
  it('sends a recovery link through Resend for a known email', async () => {
    mockGenerateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
    mockSendEmail.mockResolvedValue(undefined);

    expect(await requestPasswordReset(form({ email: 'Owner@Venue.test' }))).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'owner@venue.test' });
    const sent = mockSendEmail.mock.calls[0]?.[0] as { to: string; html: string; required: boolean };
    expect(sent.to).toBe('owner@venue.test');
    expect(sent.required).toBe(true);
    expect(sent.html).toContain('https://cheers.orangejelly.co.uk/auth/confirm?token_hash=tok&amp;type=recovery');
  });

  it('gives the same answer for an unknown email and sends nothing', async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { status: 404, code: 'user_not_found', message: 'User with this email not found' },
    });
    expect(await requestPasswordReset(form({ email: 'stranger@example.test' }))).toEqual({ success: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('fails closed and tells us when Supabase cannot make the link', async () => {
    mockGenerateLink.mockResolvedValue({ data: null, error: { status: 500, message: 'Database error' } });
    const result = await requestPasswordReset(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledWith('password_reset', expect.any(Error));
  });

  it('fails closed with a visible error, and tells us, when the email cannot be sent', async () => {
    mockGenerateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    const result = await requestPasswordReset(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('password_reset', expect.any(Error));
  });

  it('counts the request against the email and the visitor IP', async () => {
    mockGenerateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
    await requestPasswordReset(form({ email: 'Owner@Venue.test' }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith('password_reset', { email: 'owner@venue.test', ip: '203.0.113.7' });
  });

  it('refuses, without making a link, when the limit is reached', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'limited', retryAfterSeconds: 30 });
    expect(await requestPasswordReset(form({ email: 'owner@venue.test' }))).toEqual({
      error: 'Too many requests. Please try again in 1 minute.',
    });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('fails closed, without making a link, when the rate limiter is unavailable', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'unavailable' });
    const result = await requestPasswordReset(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockGenerateLink).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
