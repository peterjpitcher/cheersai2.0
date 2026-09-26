import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSignInWithOtp = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { signInWithOtp: mockSignInWithOtp, getUser: mockGetUser, updateUser: mockUpdateUser },
  })),
}));

const mockGenerateLink = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({ auth: { admin: { generateLink: mockGenerateLink } } })),
}));

const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }));

vi.mock('@/lib/auth/rate-limit', () => ({ checkAuthRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: vi.fn() }));
const mockDestination = vi.fn(async () => '/planner');
vi.mock('@/lib/billing/setup-redirect', () => ({ destinationAfterPasswordSet: () => mockDestination() }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' }, server: {} } }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { sendMagicLink, setPassword, requestPasswordReset } = await import('@/lib/auth/actions');

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it('shows an error for any other failure', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'rate limited' } });
    expect((await sendMagicLink(form({ email: 'owner@venue.test' }))).error).toBeDefined();
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
    mockGenerateLink.mockResolvedValue({ data: null, error: { message: 'User not found' } });
    expect(await requestPasswordReset(form({ email: 'stranger@example.test' }))).toEqual({ success: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed with a visible error when the email cannot be sent', async () => {
    mockGenerateLink.mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null });
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    const result = await requestPasswordReset(form({ email: 'owner@venue.test' }));
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/could not send/i);
  });
});
