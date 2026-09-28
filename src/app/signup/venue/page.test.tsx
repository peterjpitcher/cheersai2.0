import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// /signup/venue (spec §4.4, §4.3): the gate for confirmed sign-up links. Each
// failing dependency must show an error with our email address and alert.
// ---------------------------------------------------------------------------

const mockEnv = {
  server: { VERCEL_ENV: 'production' },
  client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' },
};
vi.mock('@/env', () => ({ env: mockEnv }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const mockReport = vi.fn<(kind: string, error: unknown) => Promise<void>>(async () => {});
vi.mock('@/lib/signup/alerts', () => ({ reportSignupFailure: (kind: string, error: unknown) => mockReport(kind, error) }));

const USER_ID = '11111111-1111-4111-8111-111111111111';
type Login =
  | { status: 'signed_in'; user: { id: string; email: string; emailConfirmed: boolean; cameFromEmailLink: boolean } }
  | { status: 'signed_out' }
  | { status: 'unavailable'; error: string };
const signedIn = (overrides: Partial<{ emailConfirmed: boolean; cameFromEmailLink: boolean }> = {}): Login => ({
  status: 'signed_in',
  user: { id: USER_ID, email: 'owner@venue.test', emailConfirmed: true, cameFromEmailLink: true, ...overrides },
});
type SignupRow = { accountId: string | null; verifiedAt: string | null; venueCreatedAt: string | null };
const mockReadLogin = vi.fn<() => Promise<Login>>(async () => signedIn());
const mockReadState = vi.fn<(service: unknown, userId: string) => Promise<{ isMember: boolean; signup: SignupRow | null }>>(async () => ({
  isMember: false,
  signup: { accountId: null, verifiedAt: null, venueCreatedAt: null },
}));
const mockMarkVerified = vi.fn<(service: unknown, userId: string) => Promise<void>>(async () => {});
const mockDestination = vi.fn<() => Promise<string>>(async () => '/planner');
vi.mock('@/lib/signup/venue', () => ({
  readSignedInLogin: () => mockReadLogin(),
  readVenueSignupState: (service: unknown, userId: string) => mockReadState(service, userId),
  markSignupVerified: (service: unknown, userId: string) => mockMarkVerified(service, userId),
  destinationForMember: () => mockDestination(),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({}) }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/app/signup/venue/actions', () => ({ createSelfServeVenue: vi.fn() }));
vi.mock('next/image', () => ({ default: () => null }));

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

const { default: SignupVenuePage, metadata } = await import('@/app/signup/venue/page');

async function render(): Promise<string> {
  return renderToStaticMarkup(await SignupVenuePage());
}

const CONTACT = 'mailto:peter@orangejelly.co.uk';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.server.VERCEL_ENV = 'production';
  mockSwitch.mockResolvedValue('open');
  mockReadLogin.mockResolvedValue(signedIn());
  mockReadState.mockResolvedValue({ isMember: false, signup: { accountId: null, verifiedAt: null, venueCreatedAt: null } });
  mockMarkVerified.mockResolvedValue(undefined);
});

describe('/signup/venue', () => {
  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('shows the venue form, the signed-in email and a way to sign out, and records the first visit', async () => {
    const html = await render();
    expect(html).toContain('Set up your venue');
    expect(html).toContain('Signed in as <strong>owner@venue.test</strong>');
    expect(html).toContain('Not you? Sign out');
    for (const field of ['email', 'fullName', 'password', 'confirm', 'venueName', 'venueType', 'business']) {
      expect(html).toContain(`name="${field}"`);
    }
    expect(html).toContain('I am signing up for a business, not as a consumer');
    expect(html).toContain('Other hospitality venue');
    expect(mockMarkVerified).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('records the first visit only once', async () => {
    mockReadState.mockResolvedValue({
      isMember: false,
      signup: { accountId: null, verifiedAt: '2026-09-28T09:00:00Z', venueCreatedAt: null },
    });
    await render();
    expect(mockMarkVerified).not.toHaveBeenCalled();
  });

  it('shows the form to a signed-in login with no brand and no sign-up row (the /no-access entry), writing nothing', async () => {
    mockReadState.mockResolvedValue({ isMember: false, signup: null });
    const html = await render();
    expect(html).toContain('name="venueName"');
    expect(mockMarkVerified).not.toHaveBeenCalled();
  });

  it('shows nothing and reads no session while the switch is off: a confirmed sign-up link leads only here', async () => {
    mockSwitch.mockResolvedValue('closed');
    const html = await render();
    expect(html).toContain('Sign-up is not open yet');
    expect(html).toContain(CONTACT);
    expect(html).not.toContain('name="venueName"');
    expect(mockReadLogin).not.toHaveBeenCalled();
    expect(mockMarkVerified).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('an unreadable switch shows an error with our email and alerts', async () => {
    mockSwitch.mockResolvedValue('unavailable');
    const html = await render();
    expect(html).toContain('We could not finish this');
    expect(html).toContain(CONTACT);
    expect(html).not.toContain('name="venueName"');
    expect(mockReport).toHaveBeenCalledWith('switch', expect.anything());
  });

  it('is off on a Vercel Preview (it shares the live database)', async () => {
    mockEnv.server.VERCEL_ENV = 'preview';
    const html = await render();
    expect(html).toContain('preview deployments');
    expect(html).not.toContain('name="venueName"');
    expect(mockSwitch).not.toHaveBeenCalled();
  });

  it('a session that cannot be read shows an error with our email and alerts', async () => {
    mockReadLogin.mockResolvedValue({ status: 'unavailable', error: 'getUser: 503' });
    const html = await render();
    expect(html).toContain('We could not finish this');
    expect(html).toContain(CONTACT);
    expect(mockReport).toHaveBeenCalledWith('session', expect.anything());
  });

  it('signed out: offers a new link and sign-in, no alert', async () => {
    mockReadLogin.mockResolvedValue({ status: 'signed_out' });
    const html = await render();
    expect(html).toContain('Your link has expired');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('an unconfirmed email is asked to confirm first', async () => {
    mockReadLogin.mockResolvedValue(signedIn({ emailConfirmed: false }));
    const html = await render();
    expect(html).toContain('Confirm your email first');
    expect(html).not.toContain('name="venueName"');
    expect(mockReadState).not.toHaveBeenCalled();
  });

  it('a lookup failure (database down mid-journey) shows an error with our email and alerts', async () => {
    mockReadState.mockRejectedValue(new Error('self_serve_signups: connection refused'));
    const html = await render();
    expect(html).toContain('We could not finish this');
    expect(html).toContain(CONTACT);
    expect(html).not.toContain('name="venueName"');
    expect(mockReport).toHaveBeenCalledWith('venue_lookup', expect.anything());
  });

  it('a failure recording the first visit shows an error with our email and alerts', async () => {
    mockMarkVerified.mockRejectedValue(new Error('self_serve_signups verified_at: timeout'));
    const html = await render();
    expect(html).toContain('We could not finish this');
    expect(mockReport).toHaveBeenCalledWith('venue_lookup', expect.anything());
  });

  it('someone who already belongs to a brand goes into the app instead', async () => {
    mockReadState.mockResolvedValue({ isMember: true, signup: null });
    mockDestination.mockResolvedValue('/auth/set-password');
    await expect(render()).rejects.toMatchObject({ url: '/auth/set-password' });
    mockDestination.mockResolvedValue('/planner');
    await expect(render()).rejects.toMatchObject({ url: '/planner' });
  });

  it('a venue made and since deleted is not replaced: contact us', async () => {
    mockReadState.mockResolvedValue({
      isMember: false,
      signup: { accountId: null, verifiedAt: '2026-08-01T09:00:00Z', venueCreatedAt: '2026-08-01T09:05:00Z' },
    });
    const html = await render();
    expect(html).toContain('This venue has been closed');
    expect(html).toContain('peter@orangejelly.co.uk');
    expect(html).not.toContain('name="venueName"');
  });
});
