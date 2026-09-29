'use client';

import { useEffect, useState } from 'react';

import { SignupsCard, SignupsCardSkeleton } from '@/features/admin/signups-card';
import type { SignupsOverview } from '@/lib/signup/admin-overview';

// ---------------------------------------------------------------------------
// Loads the admin Sign-ups card's data from its own super-admin route after
// the page has loaded (src/app/api/admin/signups/route.ts). The admin page
// itself never reads sign-up data, so the refresh after an admin action
// (revalidatePath('/admin') plus router.refresh()) never waits for it; the
// card keeps what it showed until the page is reloaded.
// ---------------------------------------------------------------------------

export const SIGNUPS_ENDPOINT = '/api/admin/signups';

/** The server gives up after 8 seconds; this also covers its sign-in check and the network. */
export const SIGNUPS_CLIENT_TIMEOUT_MS = 15_000;

function failed(message: string): SignupsOverview {
  return { status: 'error', message, readAt: new Date().toISOString() };
}

function isOverview(value: unknown): value is SignupsOverview {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  if (typeof body.readAt !== 'string') return false;
  if (body.status === 'error') return typeof body.message === 'string';
  if (body.status !== 'ready') return false;
  const funnel = body.funnel as { windows?: unknown } | null | undefined;
  return Boolean(funnel && Array.isArray(funnel.windows) && body.digest && typeof body.digest === 'object');
}

const TOO_SLOW = 'the sign-up figures took too long to arrive';

/** Fetches the card's data; never throws, so every failure becomes the card's error state. */
export async function fetchSignupsOverview(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SignupsOverview> {
  let response: Response;
  try {
    response = await fetcher(SIGNUPS_ENDPOINT, { signal, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    return failed(signal.aborted ? TOO_SLOW : 'the sign-up figures could not be fetched (network error)');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) return failed(TOO_SLOW);
  }
  if (isOverview(body)) return body;
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return failed(typeof error === 'string' ? error : `the server answered ${response.status}`);
}

export function SignupsCardLoader(): React.JSX.Element {
  const [overview, setOverview] = useState<SignupsOverview | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SIGNUPS_CLIENT_TIMEOUT_MS);
    void fetchSignupsOverview(controller.signal).then((result) => {
      clearTimeout(timer);
      // Aborted without a timeout means the card has gone (unmounted): nothing to show.
      if (controller.signal.aborted && !timedOut) return;
      setOverview(result);
    });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return overview ? <SignupsCard overview={overview} /> : <SignupsCardSkeleton />;
}
