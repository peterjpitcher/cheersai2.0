import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/admin/signups serves the admin Sign-ups card. The super-admin
// check runs on the server before any sign-up read: signed out 401, anyone
// else 403, a failed sign-in check 503, and none of them get any data.

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  loadSignupsOverview: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/signup/admin-overview', () => ({ loadSignupsOverview: mocks.loadSignupsOverview }));
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.logError }),
}));

import { GET } from '@/app/api/admin/signups/route';

const READY = {
  status: 'ready',
  signupSwitch: 'closed',
  readAt: '2026-09-28T09:30:00.000Z',
  funnel: { windows: [] },
  digest: { alerts: [], verifiedWithoutVenue: [], noCheckout: [], trialWithoutConnection: [], neverStarted: [] },
};

describe('GET /api/admin/signups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSignupsOverview.mockResolvedValue(READY);
  });

  it('refuses a signed-out visitor before reading anything', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.loadSignupsOverview).not.toHaveBeenCalled();
  });

  it('refuses an ordinary owner before reading anything', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', isSuperAdmin: false, activeAccountId: 'a1' });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only administrators can see the sign-up figures.' });
    expect(mocks.loadSignupsOverview).not.toHaveBeenCalled();
  });

  it('answers 503 and logs when the sign-in check itself fails', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('app_admins lookup failed'));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.loadSignupsOverview).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it('gives a super admin the figures, never cached', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', isSuperAdmin: true, activeAccountId: 'a1' });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(READY);
  });

  it('passes a failed read on as 503 with the error for the card to show', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', isSuperAdmin: true, activeAccountId: 'a1' });
    const failed = { status: 'error', message: 'self_serve_signups lookup failed: timeout', readAt: '2026-09-28T09:30:00.000Z' };
    mocks.loadSignupsOverview.mockResolvedValue(failed);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(failed);
  });
});
