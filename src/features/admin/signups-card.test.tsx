/**
 * The admin Sign-ups card, rendered from fixtures: the funnel and every list
 * with rows in it, the empty and error states, and never an email address,
 * undefined, NaN or an unreadable date.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignupsCard, SignupsCardSkeleton } from '@/features/admin/signups-card';
import type { SignupsOverview } from '@/lib/signup/admin-overview';
import { DIGEST_LIST_LIMIT, type SignupDigest } from '@/lib/signup/digest';

const BAD_OUTPUT = ['undefined', 'NaN', 'Invalid Date', 'Invalid DateTime', 'null', 'unknown date', 'unknown time', 'age unknown'];

const COUNTS = { requested: 12, verified: 9, venueCreated: 7, checkoutConfirmed: 5, channelConnected: 3, firstPost: 2 };

const DIGEST: SignupDigest = {
  alerts: [{ kind: 'provisioning', rows: 2, lastAt: '2026-09-27T21:00:00Z' }],
  verifiedWithoutVenue: [{ userId: '8d7f3a1e-0000-4000-8000-000000000001', verifiedAt: '2026-09-26T10:00:00Z', days: 2 }],
  noCheckout: [{ accountId: 'a1', name: 'No Checkout Arms', since: '2026-09-24T09:10:00Z', days: 4 }],
  trialWithoutConnection: [{ accountId: 'a2', name: 'Quiet Trial Inn', since: '2026-09-20T09:10:00Z', days: 8 }],
  neverStarted: [{ accountId: 'a3', name: 'Never Started Tap', since: '2026-08-20T09:10:00Z', days: 39 }],
};

function ready(extra: Partial<Extract<SignupsOverview, { status: 'ready' }>> = {}): SignupsOverview {
  return {
    status: 'ready',
    signupSwitch: 'open',
    readAt: '2026-09-28T09:30:00.000Z',
    funnel: {
      windows: [
        { days: 7, since: '2026-09-21T23:00:00.000Z', counts: COUNTS },
        { days: 30, since: '2026-08-29T23:00:00.000Z', counts: { ...COUNTS, requested: 40 } },
        { days: 90, since: '2026-06-30T23:00:00.000Z', counts: { ...COUNTS, requested: 95 } },
      ],
    },
    digest: DIGEST,
    ...extra,
  };
}

function expectClean(html: string) {
  for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
  expect(html).not.toContain('@');
}

describe('SignupsCard', () => {
  it('shows the funnel for each window and a row in every list, in UK dates', () => {
    const html = renderToStaticMarkup(<SignupsCard overview={ready()} />);

    expect(html).toContain('id="signups"');
    expect(html).toContain('Sign-up is open.');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Last 30 days');
    expect(html).toContain('Last 90 days');
    for (const label of [
      'Asked to sign up',
      'Confirmed their email',
      'Set up a venue',
      'Started a plan (Checkout)',
      'Connected Facebook or Instagram',
      'Published a first post',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('>12<');
    expect(html).toContain('>40<');
    expect(html).toContain('>95<');

    // Read at 10:30 BST (09:30 UTC).
    expect(html).toContain('28/09/2026, 10:30:00');
    expect(html).toContain('<strong>provisioning</strong>: 2 times, last at 27/09/2026, 22:00:00 (UK time)');
    expect(html).toContain('8d7f3a1e-0000-4000-8000-000000000001');
    expect(html).toContain('confirmed 26 September 2026, 2 days ago');
    expect(html).toContain('<strong>No Checkout Arms</strong>: venue set up 24 September 2026, 4 days ago');
    expect(html).toContain('<strong>Quiet Trial Inn</strong>: trial started 20 September 2026, 8 days ago');
    expect(html).toContain('<strong>Never Started Tap</strong>: venue set up 20 August 2026, 39 days ago');
    expect(html).toContain('href="#offboarding"');
    expectClean(html);
  });

  it('dates a late-evening sign-up on the London day, across the October clock change', () => {
    const html = renderToStaticMarkup(
      <SignupsCard
        overview={ready({
          readAt: '2026-10-26T08:00:00.000Z',
          digest: {
            alerts: [],
            // 23:30 BST on Saturday 24 October is 22:30 UTC.
            verifiedWithoutVenue: [{ userId: 'u-late', verifiedAt: '2026-10-24T22:30:00Z', days: 2 }],
            noCheckout: [],
            trialWithoutConnection: [],
            neverStarted: [],
          },
        })}
      />,
    );

    expect(html).toContain('26/10/2026, 08:00:00'); // GMT again
    expect(html).toContain('confirmed 24 October 2026, 2 days ago');
  });

  it('says "None." for empty lists and explains zeros while the switch is off', () => {
    const empty = ready({
      signupSwitch: 'closed',
      digest: { alerts: [], verifiedWithoutVenue: [], noCheckout: [], trialWithoutConnection: [], neverStarted: [] },
      funnel: {
        windows: [7, 30, 90].map((days) => ({
          days,
          since: '2026-09-21T23:00:00.000Z',
          counts: { requested: 0, verified: 0, venueCreated: 0, checkoutConfirmed: 0, channelConnected: 0, firstPost: 0 },
        })),
      },
    });

    const html = renderToStaticMarkup(<SignupsCard overview={empty} />);

    expect(html).toContain('Sign-up is closed');
    expect(html.match(/None\./g)).toHaveLength(5);
    expectClean(html);
  });

  it('says when the switch could not be read', () => {
    const html = renderToStaticMarkup(<SignupsCard overview={ready({ signupSwitch: 'unavailable' })} />);
    expect(html).toContain('The sign-up switch could not be read just now');
  });

  it('says when the switch is on but billing enforcement is off, so sign-up stays closed', () => {
    const html = renderToStaticMarkup(<SignupsCard overview={ready({ signupSwitch: 'enforcement_off' })} />);
    expect(html).toContain('Sign-up switch on, but billing enforcement is off: sign-up stays closed.');
    expect(html).not.toContain('Sign-up is open.');
    expectClean(html);
  });

  it('treats a switch value it does not know as unreadable, never as open', () => {
    const odd = { ...ready(), signupSwitch: 'maybe' } as unknown as SignupsOverview;
    const html = renderToStaticMarkup(<SignupsCard overview={odd} />);
    expect(html).toContain('The sign-up switch could not be read just now');
    expect(html).not.toContain('Sign-up is open.');
  });

  it('shows the first 50 of a long list and counts the rest', () => {
    const many = Array.from({ length: DIGEST_LIST_LIMIT + 3 }, (_, index) => ({
      accountId: `a${index}`,
      name: `Venue ${index}`,
      since: '2026-08-20T09:10:00Z',
      days: 39,
    }));
    const html = renderToStaticMarkup(
      <SignupsCard overview={ready({ digest: { ...DIGEST, neverStarted: many } })} />,
    );

    expect(html).toContain(`Venue ${DIGEST_LIST_LIMIT - 1}<`);
    expect(html).not.toContain(`Venue ${DIGEST_LIST_LIMIT}<`);
    expect(html).toContain('and 3 more');
  });

  it('shows an error state, not figures, when the reads failed', () => {
    const html = renderToStaticMarkup(
      <SignupsCard
        overview={{ status: 'error', message: 'self_serve_signups lookup failed: connection refused', readAt: '2026-09-28T09:30:00.000Z' }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('The sign-up figures could not be read.');
    expect(html).toContain('self_serve_signups lookup failed: connection refused');
    expect(html).toContain('The rest of this page is unaffected.');
    expect(html).not.toContain('Last 7 days');
    expect(html).toContain('var(--c-claret)');
  });

  it('never renders a bad value as text, even from a broken timestamp', () => {
    const html = renderToStaticMarkup(
      <SignupsCard
        overview={ready({
          digest: {
            alerts: [],
            verifiedWithoutVenue: [{ userId: 'u1', verifiedAt: 'not a date', days: Number.NaN }],
            noCheckout: [],
            trialWithoutConnection: [],
            neverStarted: [],
          },
        })}
      />,
    );

    expect(html).toContain('confirmed unknown date, age unknown');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Invalid');
  });
});

describe('SignupsCardSkeleton', () => {
  it('shows a loading card while the reads run', () => {
    const html = renderToStaticMarkup(<SignupsCardSkeleton />);
    expect(html).toContain('Loading the sign-up figures');
    expect(html).toContain('aria-busy="true"');
  });
});
