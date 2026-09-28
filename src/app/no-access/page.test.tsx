import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// /no-access: the "Start a free trial for your venue" entry (spec §4.4) shows
// only while the sign-up switch is on, and the page is otherwise unchanged.

const mockEnv = { server: { VERCEL_ENV: 'production' }, client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' } };
vi.mock('@/env', () => ({ env: mockEnv }));

const mockSwitch = vi.fn<() => Promise<'open' | 'closed' | 'unavailable'>>(async () => 'open');
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: () => mockSwitch() }));

const mockUser = vi.fn(async () => ({ id: 'u1', activeAccountId: null as string | null }));
vi.mock('@/lib/auth/server', () => ({ getCurrentUser: () => mockUser() }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({}) }));
const mockInvitations = vi.fn(async () => [] as unknown[]);
vi.mock('@/lib/team/invitations', () => ({
  INVITATIONS_PATH: '/invitations',
  listPendingInvitationsForUser: () => mockInvitations(),
}));

// Who the login is; decideVenueAccess stays real.
type VenueState = import('@/lib/signup/venue').VenueSignupState;
const NO_BRAND: VenueState = { memberships: [], isAdmin: false, hasOpenInvitation: false, signup: null };
const mockReadState = vi.fn<(service: unknown, userId: string) => Promise<VenueState>>(async () => NO_BRAND);
vi.mock('@/lib/signup/venue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/signup/venue')>()),
  readVenueSignupState: (service: unknown, userId: string) => mockReadState(service, userId),
}));
vi.mock('@/lib/billing/setup-redirect', () => ({ destinationAfterPasswordSet: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

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

const { default: NoAccessPage } = await import('@/app/no-access/page');

async function render(): Promise<string> {
  return renderToStaticMarkup(await NoAccessPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.server.VERCEL_ENV = 'production';
  mockSwitch.mockResolvedValue('open');
  mockUser.mockResolvedValue({ id: 'u1', activeAccountId: null });
  mockInvitations.mockResolvedValue([]);
  mockReadState.mockResolvedValue(NO_BRAND);
});

describe('/no-access', () => {
  it('offers a free trial for a venue, linking to /signup/venue, while the switch is on', async () => {
    const html = await render();
    expect(html).toContain('Start a free trial for your venue');
    expect(html).toContain('href="/signup/venue"');
    expect(html).toContain('No brands assigned yet');
  });

  it('is exactly as before while the switch is off or cannot be read, or on a Preview', async () => {
    for (const state of ['closed', 'unavailable'] as const) {
      mockSwitch.mockResolvedValue(state);
      const html = await render();
      expect(html, state).not.toContain('Start a free trial');
      expect(html, state).toContain('Ask your administrator');
    }
    mockSwitch.mockResolvedValue('open');
    mockEnv.server.VERCEL_ENV = 'preview';
    expect(await render()).not.toContain('Start a free trial');
  });

  it('someone with an open invitation is pointed at accepting it, and is not offered a trial', async () => {
    mockInvitations.mockResolvedValue([{ id: 'i1' }]);
    mockReadState.mockResolvedValue({ ...NO_BRAND, hasOpenInvitation: true });
    const html = await render();
    expect(html).toContain('You have an invitation waiting');
    expect(html).toContain('Accept it to join that venue on Cheers.');
    expect(html).not.toContain('Start a free trial');
  });

  it('a member of only archived brands sees the member notice, not the trial button (which would loop)', async () => {
    mockReadState.mockResolvedValue({ ...NO_BRAND, memberships: [{ accountId: 'a1', usable: false }] });
    const html = await render();
    expect(html).toContain('belongs to a venue on Cheers that has been closed');
    expect(html).not.toContain('Start a free trial');
  });

  it('someone removed from the venue they set up is told so, with no trial button', async () => {
    mockReadState.mockResolvedValue({ ...NO_BRAND, signup: { accountId: 'a1', verifiedAt: 'v', venueCreatedAt: 'c' } });
    const html = await render();
    expect(html).toContain('You no longer have access to the venue you set up');
    expect(html).not.toContain('Start a free trial');
  });

  it('an admin is not offered a trial', async () => {
    mockReadState.mockResolvedValue({ ...NO_BRAND, isAdmin: true });
    expect(await render()).not.toContain('Start a free trial');
  });

  it('a failed lookup offers nothing (fails closed) and the page still works', async () => {
    mockReadState.mockRejectedValue(new Error('app_admins: connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await render();
    expect(html).not.toContain('Start a free trial');
    expect(html).toContain('No brands assigned yet');
    consoleError.mockRestore();
  });

  it('while the switch is off it reads nothing new', async () => {
    mockSwitch.mockResolvedValue('closed');
    await render();
    expect(mockReadState).not.toHaveBeenCalled();
  });

  it('someone with a brand goes back into the app, and never reads the switch', async () => {
    mockUser.mockResolvedValue({ id: 'u1', activeAccountId: 'a1' });
    await expect(render()).rejects.toMatchObject({ url: '/' });
    expect(mockSwitch).not.toHaveBeenCalled();
  });
});
