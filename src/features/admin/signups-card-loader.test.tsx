// @vitest-environment jsdom
/**
 * The admin Sign-ups card loads its own data after the page has loaded, and
 * every failure (refused, network, bad answer, too slow) becomes the card's
 * error state rather than a broken page.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSignupsOverview, SIGNUPS_CLIENT_TIMEOUT_MS, SIGNUPS_ENDPOINT, SignupsCardLoader } from './signups-card-loader';

const READY = {
  status: 'ready',
  signupSwitch: 'open',
  readAt: '2026-09-28T09:30:00.000Z',
  funnel: {
    windows: [
      {
        days: 7,
        since: '2026-09-21T23:00:00.000Z',
        counts: { requested: 3, verified: 2, venueCreated: 1, checkoutConfirmed: 1, channelConnected: 0, firstPost: 0 },
      },
    ],
  },
  digest: {
    alerts: [],
    verifiedWithoutVenue: [],
    noCheckout: [{ accountId: 'a1', name: 'No Checkout Arms', since: '2026-09-24T09:10:00Z', days: 4 }],
    trialWithoutConnection: [],
    neverStarted: [],
  },
};

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchSignupsOverview', () => {
  const signal = new AbortController().signal;

  it('asks the super-admin route, uncached, and returns its figures', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer(READY));

    expect(await fetchSignupsOverview(signal, fetcher)).toEqual(READY);
    expect(fetcher).toHaveBeenCalledWith(SIGNUPS_ENDPOINT, expect.objectContaining({ cache: 'no-store', signal }));
  });

  it('passes on the server error state as it is', async () => {
    const failed = { status: 'error', message: 'self_serve_signups lookup failed: x', readAt: '2026-09-28T09:30:00.000Z' };
    expect(await fetchSignupsOverview(signal, vi.fn().mockResolvedValue(answer(failed, 503)))).toEqual(failed);
  });

  it('shows the refusal for someone who is not an administrator', async () => {
    const result = await fetchSignupsOverview(
      signal,
      vi.fn().mockResolvedValue(answer({ error: 'Only administrators can see the sign-up figures.' }, 403)),
    );
    expect(result).toMatchObject({ status: 'error', message: 'Only administrators can see the sign-up figures.' });
  });

  it('turns a network failure or an unreadable answer into an error', async () => {
    expect(await fetchSignupsOverview(signal, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toMatchObject({
      status: 'error',
      message: 'the sign-up figures could not be fetched (network error)',
    });
    expect(
      await fetchSignupsOverview(signal, vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }))),
    ).toMatchObject({ status: 'error', message: 'the server answered 502' });
  });

  it('says it took too long when the request was stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await fetchSignupsOverview(controller.signal, vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    expect(result).toMatchObject({ status: 'error', message: 'the sign-up figures took too long to arrive' });
  });
});

describe('SignupsCardLoader', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the loading card, then the figures', async () => {
    vi.mocked(fetch).mockResolvedValue(answer(READY));

    render(<SignupsCardLoader />);

    expect(screen.getByText('Loading the sign-up figures…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No Checkout Arms')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when the route fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      answer({ status: 'error', message: 'self_serve_signups lookup failed: injected', readAt: '2026-09-28T09:30:00.000Z' }, 503),
    );

    render(<SignupsCardLoader />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('self_serve_signups lookup failed: injected'));
  });

  it('gives up with an error when the route never answers', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    render(<SignupsCardLoader />);
    await vi.advanceTimersByTimeAsync(SIGNUPS_CLIENT_TIMEOUT_MS);
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('took too long'));
  });
});
