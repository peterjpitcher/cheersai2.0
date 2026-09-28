/**
 * Data for the admin Sign-ups card: reuses the digest and the funnel, and
 * never throws. A failed, missing or slow read comes back as an error for the
 * card to show, and is logged; at the deadline the reads are cancelled.
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
    expect(mocks.findSignupDigest).toHaveBeenCalledWith(SERVICE, NOW, { signal: expect.any(AbortSignal) });
    expect(mocks.findSignupFunnel).toHaveBeenCalledWith(SERVICE, NOW, { signal: expect.any(AbortSignal) });
    // Both share one deadline, which has not fired.
    const signal = mocks.findSignupFunnel.mock.calls[0][2].signal as AbortSignal;
    expect(mocks.findSignupDigest.mock.calls[0][2].signal).toBe(signal);
    expect(signal.aborted).toBe(false);
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

  it('gives up on a slow read, cancels every read in flight and returns an error', async () => {
    vi.useFakeTimers();
    try {
      // A read that only ends when its signal fires, as supabase-js does with .abortSignal().
      const cancelled: string[] = [];
      const hang = (name: string) => (_service: unknown, _now: Date, options: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            cancelled.push(name);
            reject(new Error(`${name} lookup failed: AbortError`));
          });
        });
      mocks.findSignupFunnel.mockImplementation(hang('funnel'));
      mocks.findSignupDigest.mockImplementation(hang('digest'));

      const pending = loadSignupsOverview({ now: NOW, timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(7999);
      expect(cancelled).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({
        status: 'error',
        message: 'the sign-up figures took longer than 8 seconds',
      });
      expect(cancelled.sort()).toEqual(['digest', 'funnel']);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its deadline once the reads finish', async () => {
    vi.useFakeTimers();
    try {
      await loadSignupsOverview({ now: NOW, timeoutMs: 8000 });
      expect(vi.getTimerCount()).toBe(0);
      const signal = mocks.findSignupFunnel.mock.calls[0][2].signal as AbortSignal;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(signal.aborted).toBe(false);
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
