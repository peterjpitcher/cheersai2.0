/**
 * Data for the admin Sign-ups card: reuses the digest and the funnel, and
 * never throws. A failed, missing or slow read comes back as an error for the
 * card to show, and is logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findSignupDigest: vi.fn(),
  findSignupFunnel: vi.fn(),
  getSelfServeSignupSwitch: vi.fn(),
  tryCreateServiceSupabaseClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/signup/digest', () => ({ findSignupDigest: mocks.findSignupDigest }));
vi.mock('@/lib/signup/funnel', () => ({ findSignupFunnel: mocks.findSignupFunnel }));
vi.mock('@/lib/signup/switch', () => ({ getSelfServeSignupSwitch: mocks.getSelfServeSignupSwitch }));
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: mocks.tryCreateServiceSupabaseClient }));
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.logError }),
}));

import { loadSignupsOverview } from './admin-overview';

const NOW = new Date('2026-09-28T10:00:00.000Z');
const SERVICE = { from: vi.fn() };
const DIGEST = { alerts: [], verifiedWithoutVenue: [], noCheckout: [], trialWithoutConnection: [], neverStarted: [] };
const FUNNEL = { windows: [] };

describe('loadSignupsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryCreateServiceSupabaseClient.mockReturnValue(SERVICE);
    mocks.getSelfServeSignupSwitch.mockResolvedValue('closed');
    mocks.findSignupDigest.mockResolvedValue(DIGEST);
    mocks.findSignupFunnel.mockResolvedValue(FUNNEL);
  });

  it('returns the switch, the funnel and the digest lists, read with the service client at one instant', async () => {
    const overview = await loadSignupsOverview({ now: NOW });

    expect(overview).toEqual({ status: 'ready', signupSwitch: 'closed', funnel: FUNNEL, digest: DIGEST, readAt: NOW.toISOString() });
    expect(mocks.findSignupDigest).toHaveBeenCalledWith(SERVICE, NOW);
    expect(mocks.findSignupFunnel).toHaveBeenCalledWith(SERVICE, NOW);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('returns an error and logs it when a read fails', async () => {
    mocks.findSignupDigest.mockRejectedValue(new Error('self_serve_signups lookup failed: connection refused'));

    const overview = await loadSignupsOverview({ now: NOW });

    expect(overview).toEqual({
      status: 'error',
      message: 'self_serve_signups lookup failed: connection refused',
      readAt: NOW.toISOString(),
    });
    expect(mocks.logError).toHaveBeenCalledWith('admin sign-ups card could not be read', expect.any(Error));
  });

  it('returns an error when the service key is not configured', async () => {
    mocks.tryCreateServiceSupabaseClient.mockReturnValue(null);

    const overview = await loadSignupsOverview({ now: NOW });

    expect(overview).toMatchObject({ status: 'error', message: 'the Supabase service key is not configured' });
    expect(mocks.findSignupDigest).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it('gives up on a slow read and returns an error instead of holding the page', async () => {
    vi.useFakeTimers();
    try {
      mocks.findSignupFunnel.mockReturnValue(new Promise(() => undefined));
      const pending = loadSignupsOverview({ now: NOW, timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(8000);

      await expect(pending).resolves.toMatchObject({
        status: 'error',
        message: 'the sign-up figures took longer than 8 seconds',
      });
      expect(mocks.logError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a long database message short on the card', async () => {
    mocks.findSignupFunnel.mockRejectedValue(new Error('x'.repeat(1000)));

    const overview = await loadSignupsOverview({ now: NOW });

    expect(overview.status === 'error' && overview.message.length).toBe(300);
  });
});
