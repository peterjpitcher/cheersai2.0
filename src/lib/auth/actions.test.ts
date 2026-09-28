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
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({ auth: { admin: { generateLink: mockGenerateLink } } })),
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
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' }, server: {} } }));
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
  mockCheckRateLimit.mockResolvedValue({ status: 'allowed' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------

describe('sendMagicLink', () => {
  it('never creates a login', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await sendMagicLink(form({ email: 'owner@venue.test' }));
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) }),
    );
  });

  it('answers an unknown email exactly like a known one', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { code: 'otp_disabled', message: 'Signups not allowed for otp' } });
    expect(await sendMagicLink(form({ email: 'stranger@example.test' }))).toEqual({ success: true });
  });

  it('fails closed and tells us for any other Supabase failure', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate limited' } });
    const result = await sendMagicLink(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockReport).toHaveBeenCalledWith('magic_link', expect.any(Error));
  });

  it('counts the request against the email and the visitor IP', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await sendMagicLink(form({ email: 'Owner@Venue.test' }));
    expect(mockCheckRateLimit).toHaveBeenCalledWith('magic_link', { email: 'owner@venue.test', ip: '203.0.113.7' });
  });

  it('refuses, without sending, when the limit is reached', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'limited', retryAfterSeconds: 1500 });
    const result = await sendMagicLink(form({ email: 'owner@venue.test' }));
    expect(result.error).toBe('Too many requests. Please try again in 25 minutes.');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('fails closed, without sending, when the rate limiter is unavailable', async () => {
    mockCheckRateLimit.mockResolvedValue({ status: 'unavailable' });
    const result = await sendMagicLink(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(COULD_NOT_FINISH);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
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
