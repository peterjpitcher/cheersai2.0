import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyOtp = vi.fn();
const mockCreateServerClient = vi.fn(async () => ({ auth: { verifyOtp: mockVerifyOtp } }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => mockCreateServerClient() }));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const mockReport = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/auth/alerts', () => ({ reportAuthFailure: (...args: unknown[]) => mockReport(...args) }));

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});

const { default: ConfirmPage, metadata } = await import('@/app/auth/confirm/page');
const { confirmEmailLink } = await import('@/app/auth/confirm/actions');
const { buildAuthConfirmUrl } = await import('@/lib/auth/email-links');

const TOKEN = 'a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2';

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error('expected a redirect');
}

function linkSearchParams(type: 'invite' | 'recovery'): Record<string, string> {
  const url = new URL(buildAuthConfirmUrl({ siteUrl: 'https://cheers.orangejelly.co.uk', tokenHash: TOKEN, type }));
  return Object.fromEntries(url.searchParams.entries());
}

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

describe('GET /auth/confirm (the page)', () => {
  it('keeps the Origin header on a form post made before JavaScript loads', () => {
    // 'no-referrer' makes browsers send `Origin: null` on the native form POST,
    // which Next.js rejects (500). 'same-origin' still keeps the token off other sites.
    expect(metadata.referrer).toBe('same-origin');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('never uses the token: opening the link, as a scanner would, only shows the button', async () => {
    const html = renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(linkSearchParams('invite')) }));

    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(html).toContain('Accept your invite');
    expect(html).toContain('Confirm and continue');
    expect(html).toContain(`name="token_hash" value="${TOKEN}"`);
    expect(html).toContain('name="type" value="invite"');
    expect(html).toContain('name="next" value="/auth/set-password"');
  });

  it('shows the reset wording for a password reset link', async () => {
    const html = renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(linkSearchParams('recovery')) }));
    expect(html).toContain('Reset your password');
    expect(html).toContain('name="type" value="recovery"');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('sends an incomplete link to the login page with the link error', async () => {
    expect(await redirectOf(ConfirmPage({ searchParams: Promise.resolve({ type: 'invite' }) }))).toBe(
      '/login?error=invalid_confirmation',
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('never puts an off-site next into the form', async () => {
    const html = renderToStaticMarkup(
      await ConfirmPage({ searchParams: Promise.resolve({ token_hash: TOKEN, type: 'recovery', next: 'https://evil.example' }) }),
    );
    expect(html).toContain('name="next" value="/dashboard"');
    expect(html).not.toContain('evil.example');
  });
});

describe('POST /auth/confirm (the button)', () => {
  it('verifies the token and goes to the safe next path', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    const url = await redirectOf(confirmEmailLink(form(linkSearchParams('invite'))));

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type: 'invite' });
    expect(url).toBe('/auth/set-password');
  });

  it('verifies a password reset link the same way', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    expect(await redirectOf(confirmEmailLink(form(linkSearchParams('recovery'))))).toBe('/auth/set-password');
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type: 'recovery' });
  });

  it('refuses to redirect off-site even if the form was tampered with', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    expect(await redirectOf(confirmEmailLink(form({ token_hash: TOKEN, type: 'invite', next: '//evil.example' })))).toBe('/dashboard');
  });

  it('sends a used or expired link to the login page, where "Send it again" is offered', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { status: 403, code: 'otp_expired', message: 'Email link is invalid or has expired' } });
    expect(await redirectOf(confirmEmailLink(form(linkSearchParams('invite'))))).toBe('/login?error=confirmation_failed');
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('fails closed and tells us when Supabase cannot check the link', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { status: 503, message: 'Service Unavailable' } });
    expect(await redirectOf(confirmEmailLink(form(linkSearchParams('recovery'))))).toBe('/login?error=confirmation_unavailable');
    expect(mockReport).toHaveBeenCalledWith('email_link', expect.any(Error));
  });

  it('fails closed and tells us when the client throws', async () => {
    mockVerifyOtp.mockRejectedValue(new Error('fetch failed'));
    expect(await redirectOf(confirmEmailLink(form(linkSearchParams('invite'))))).toBe('/login?error=confirmation_unavailable');
    expect(mockReport).toHaveBeenCalledWith('email_link', expect.any(Error));
  });

  it('refuses a malformed form without calling Supabase', async () => {
    expect(await redirectOf(confirmEmailLink(form({ token_hash: TOKEN, type: 'email_change' })))).toBe(
      '/login?error=invalid_confirmation',
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('refuses a magic-link token: only invite and recovery links come here', async () => {
    expect(await redirectOf(confirmEmailLink(form({ token_hash: TOKEN, type: 'magiclink' })))).toBe(
      '/login?error=invalid_confirmation',
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });
});
