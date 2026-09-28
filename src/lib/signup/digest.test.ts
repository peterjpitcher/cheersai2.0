/**
 * The sign-up lists in the daily operator email (spec §4.9, P7), read from an
 * in-memory database that applies the same filters PostgREST would, and
 * rendered from fixtures (never undefined, NaN, Invalid Date or a blank date).
 * Day counts are London calendar days, including across the October 2026
 * clock change (Sunday 25 October, a 25-hour day).
 */
import { describe, expect, it } from 'vitest';

import {
  findSignupDigest,
  londonDaysCutoff,
  londonDaysSince,
  renderSignupDigestSections,
  signupDigestSize,
  DIGEST_LIST_LIMIT,
  type SignupDigest,
} from './digest';

type Row = Record<string, unknown>;

/** Enough of the query builder for the digest: filters, order, range and returns. */
function fakeDb(tables: Record<string, Row[]>, failTable?: string, onRead?: (table: string) => void) {
  const reads: string[] = [];
  const signals: Array<AbortSignal | null> = [];
  const from = (table: string) => {
    reads.push(table);
    let signal: AbortSignal | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    let orderBy: string | null = null;
    let range: [number, number] | null = null;
    const chain: Record<string, unknown> = {};
    const compare = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? Date.parse(a) - Date.parse(b) : 0);
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => (filters.push((row) => row[column] === value), chain);
    chain.in = (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), chain);
    chain.is = (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), chain);
    chain.not = (column: string, _op: 'is', value: null) => (filters.push((row) => (row[column] ?? null) !== value), chain);
    chain.lt = (column: string, value: string) => (filters.push((row) => row[column] != null && compare(row[column], value) < 0), chain);
    chain.gte = (column: string, value: string) => (filters.push((row) => row[column] != null && compare(row[column], value) >= 0), chain);
    chain.gt = (column: string, value: string) => (filters.push((row) => row[column] != null && compare(row[column], value) > 0), chain);
    chain.order = (column: string) => ((orderBy = column), chain);
    chain.range = (start: number, end: number) => ((range = [start, end]), chain);
    chain.abortSignal = (value: AbortSignal) => ((signal = value), chain);
    chain.returns = async () => {
      signals.push(signal);
      onRead?.(table);
      if (failTable === table) return { data: null, error: { message: 'connection refused' } };
      let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
      if (orderBy) rows = [...rows].sort((a, b) => compare(a[orderBy as string], b[orderBy as string]));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows, error: null };
    };
    return chain;
  };
  return { service: { from } as never, reads, signals };
}

const BAD_OUTPUT = ['undefined', 'NaN', 'Invalid Date', 'Invalid DateTime', 'null'];

// Monday 28 September 2026, 04:45 in London (BST).
const NOW = new Date('2026-09-28T03:45:00.000Z');

function account(id: string, name: string, extra: Row = {}): Row {
  return { id, business_name: name, archived_at: null, offboarded_at: null, billing_override: null, ...extra };
}

describe('London day counting', () => {
  it('counts calendar days in London, not 24-hour blocks', () => {
    // 23:30 BST on Saturday 26 September is 22:30 UTC: two London days before Monday.
    expect(londonDaysSince('2026-09-26T22:30:00Z', NOW)).toBe(2);
    expect(londonDaysSince('2026-09-27T23:30:00Z', NOW)).toBe(0); // 00:30 on Monday in London
    expect(londonDaysSince('not a date', NOW)).toBeNaN();
  });

  it('counts the 25-hour clock-change day as one day', () => {
    const monday = new Date('2026-10-26T08:00:00Z'); // GMT again
    expect(londonDaysSince('2026-10-23T08:30:00Z', monday)).toBe(3); // Friday 09:30 BST
    expect(londonDaysSince('2026-10-25T00:30:00Z', monday)).toBe(1); // Sunday 01:30 BST
    // The cut-off for "3 days or more" is midnight at the start of Saturday 24 October, in BST.
    expect(londonDaysCutoff(monday, 3)).toBe('2026-10-23T23:00:00.000Z');
    expect(londonDaysCutoff(monday, 1)).toBe('2026-10-26T00:00:00.000Z');
  });

  it('counts the 23-hour spring clock change as one day', () => {
    const tuesday = new Date('2026-03-31T09:00:00Z'); // BST from Sunday 29 March
    expect(londonDaysSince('2026-03-28T12:00:00Z', tuesday)).toBe(3);
    expect(londonDaysCutoff(tuesday, 3)).toBe('2026-03-29T00:00:00.000Z');
  });
});

describe('findSignupDigest', () => {
  it('lists every kind of stuck and never-started self-serve sign-up, and nothing else', async () => {
    const { service } = fakeDb({
      admin_audit: [
        { action: 'operator_signup_alert', detail: { kind: 'provisioning', count: 1 }, created_at: '2026-09-27T20:00:00Z' },
        { action: 'operator_signup_alert', detail: { kind: 'provisioning', count: 2 }, created_at: '2026-09-27T21:00:00Z' },
        { action: 'operator_signup_alert', detail: { kind: 'email', count: 1 }, created_at: '2026-09-28T01:00:00Z' },
        // Older than 24 hours, and a different action: left out.
        { action: 'operator_signup_alert', detail: { kind: 'switch', count: 1 }, created_at: '2026-09-27T02:00:00Z' },
        { action: 'create_brand', detail: {}, created_at: '2026-09-28T01:00:00Z' },
      ],
      self_serve_signups: [
        // Confirmed on Saturday, no venue: stuck (1 day or more).
        { user_id: 'u-stuck', account_id: null, verified_at: '2026-09-26T10:00:00Z', venue_created_at: null },
        // Confirmed on Sunday evening (London): 1 day, listed.
        { user_id: 'u-sunday', account_id: null, verified_at: '2026-09-27T19:00:00Z', venue_created_at: null },
        // Confirmed on Monday just after midnight: today, not yet.
        { user_id: 'u-today', account_id: null, verified_at: '2026-09-27T23:30:00Z', venue_created_at: null },
        // Never confirmed: not stuck here (the clean-up deals with it).
        { user_id: 'u-unconfirmed', account_id: null, verified_at: null, venue_created_at: null },
        // Venues.
        { user_id: 'o1', account_id: 'a-no-checkout', verified_at: '2026-09-24T09:00:00Z', venue_created_at: '2026-09-24T09:10:00Z' },
        { user_id: 'o2', account_id: 'a-too-new', verified_at: '2026-09-26T09:00:00Z', venue_created_at: '2026-09-26T09:10:00Z' },
        { user_id: 'o3', account_id: 'a-never', verified_at: '2026-08-20T09:00:00Z', venue_created_at: '2026-08-20T09:10:00Z' },
        { user_id: 'o4', account_id: 'a-trial-quiet', verified_at: '2026-09-10T09:00:00Z', venue_created_at: '2026-09-10T09:10:00Z' },
        { user_id: 'o5', account_id: 'a-trial-connected', verified_at: '2026-09-10T09:00:00Z', venue_created_at: '2026-09-10T09:10:00Z' },
        { user_id: 'o6', account_id: 'a-trial-new', verified_at: '2026-09-10T09:00:00Z', venue_created_at: '2026-09-10T09:10:00Z' },
        { user_id: 'o7', account_id: 'a-offboarded', verified_at: '2026-08-01T09:00:00Z', venue_created_at: '2026-08-01T09:10:00Z' },
        { user_id: 'o8', account_id: 'a-comped', verified_at: '2026-08-01T09:00:00Z', venue_created_at: '2026-08-01T09:10:00Z' },
        { user_id: null, account_id: 'a-paid', verified_at: '2026-08-01T09:00:00Z', venue_created_at: '2026-08-01T09:10:00Z' },
      ],
      accounts: [
        account('a-no-checkout', 'No Checkout Arms'),
        account('a-too-new', 'Too New Tavern'),
        account('a-never', 'The Quiet Inn'),
        account('a-trial-quiet', 'Trial Quiet Bar'),
        account('a-trial-connected', 'Connected Cafe'),
        account('a-trial-new', 'Fresh Trial Hotel'),
        account('a-offboarded', 'Gone Grill', { offboarded_at: '2026-09-01T00:00:00Z' }),
        account('a-comped', 'Comped Club', { billing_override: 'comped' }),
        account('a-paid', 'Paid Pub'),
        // An operator-made brand with no sign-up row never appears.
        account('a-operator', 'The Anchor'),
      ],
      subscriptions: [
        { account_id: 'a-trial-quiet', status: 'trialing', created_at: '2026-09-20T10:00:00Z' },
        { account_id: 'a-trial-connected', status: 'trialing', created_at: '2026-09-20T10:00:00Z' },
        { account_id: 'a-trial-new', status: 'trialing', created_at: '2026-09-26T10:00:00Z' },
        { account_id: 'a-paid', status: 'active', created_at: '2026-08-02T10:00:00Z' },
      ],
      social_connections: [
        { account_id: 'a-trial-connected', status: 'active' },
        { account_id: 'a-trial-quiet', status: 'needs_action' },
      ],
    });

    const digest = await findSignupDigest(service, NOW);

    expect(digest.alerts).toEqual([
      { kind: 'provisioning', rows: 2, lastAt: '2026-09-27T21:00:00Z' },
      { kind: 'email', rows: 1, lastAt: '2026-09-28T01:00:00Z' },
    ]);
    expect(digest.verifiedWithoutVenue).toEqual([
      { userId: 'u-stuck', verifiedAt: '2026-09-26T10:00:00Z', days: 2 },
      { userId: 'u-sunday', verifiedAt: '2026-09-27T19:00:00Z', days: 1 },
    ]);
    expect(digest.noCheckout).toEqual([{ accountId: 'a-no-checkout', name: 'No Checkout Arms', since: '2026-09-24T09:10:00Z', days: 4 }]);
    expect(digest.neverStarted).toEqual([{ accountId: 'a-never', name: 'The Quiet Inn', since: '2026-08-20T09:10:00Z', days: 39 }]);
    expect(digest.trialWithoutConnection).toEqual([
      { accountId: 'a-trial-quiet', name: 'Trial Quiet Bar', since: '2026-09-20T10:00:00Z', days: 8 },
    ]);
    expect(signupDigestSize(digest)).toBe(7);
  });

  it('leaves out confirmed logins that have since joined a brand or been invited to one', async () => {
    const { service } = fakeDb({
      self_serve_signups: [
        { user_id: 'u-stuck', account_id: null, verified_at: '2026-09-26T10:00:00Z', venue_created_at: null },
        { user_id: 'u-joined', account_id: null, verified_at: '2026-09-26T10:00:00Z', venue_created_at: null },
        { user_id: 'u-invited', account_id: null, verified_at: '2026-09-26T10:00:00Z', venue_created_at: null },
        { user_id: 'u-old-invite', account_id: null, verified_at: '2026-09-26T10:00:00Z', venue_created_at: null },
      ],
      account_members: [{ user_id: 'u-joined', account_id: 'a1' }],
      team_invitations: [
        { user_id: 'u-invited', accepted_at: null, declined_at: null, cancelled_at: null, expires_at: '2026-10-02T00:00:00Z' },
        // Expired, and a declined one: they do not settle anything.
        { user_id: 'u-old-invite', accepted_at: null, declined_at: null, cancelled_at: null, expires_at: '2026-09-27T00:00:00Z' },
        { user_id: 'u-stuck', accepted_at: null, declined_at: '2026-09-27T00:00:00Z', cancelled_at: null, expires_at: '2026-10-02T00:00:00Z' },
      ],
    });
    const digest = await findSignupDigest(service, NOW);
    expect(digest.verifiedWithoutVenue.map((row) => row.userId)).toEqual(['u-stuck', 'u-old-invite']);
  });

  it('is bounded: confirmed logins for 30 London days, venues for 90, so the lists cannot grow for ever', async () => {
    const { service } = fakeDb({
      self_serve_signups: [
        // 29 and 30 London days before Monday 28 September.
        { user_id: 'u-29', account_id: null, verified_at: '2026-08-30T10:00:00Z', venue_created_at: null },
        { user_id: 'u-30', account_id: null, verified_at: '2026-08-29T10:00:00Z', venue_created_at: null },
        // 89 and 90 London days before.
        { user_id: 'o1', account_id: 'a-89', verified_at: '2026-07-01T09:00:00Z', venue_created_at: '2026-07-01T09:10:00Z' },
        { user_id: 'o2', account_id: 'a-90', verified_at: '2026-06-30T09:00:00Z', venue_created_at: '2026-06-30T09:10:00Z' },
      ],
      accounts: [account('a-89', 'Eighty Nine Inn'), account('a-90', 'Ninety Bar')],
    });
    const digest = await findSignupDigest(service, NOW);
    expect(digest.verifiedWithoutVenue.map((row) => [row.userId, row.days])).toEqual([['u-29', 29]]);
    expect(digest.neverStarted.map((venue) => [venue.name, venue.days])).toEqual([['Eighty Nine Inn', 89]]);
  });

  it('moves a venue from "no Checkout" to "never started" on its 30th London day', async () => {
    const tables = (createdAt: string) => ({
      self_serve_signups: [{ user_id: 'o', account_id: 'a', verified_at: createdAt, venue_created_at: createdAt }],
      accounts: [account('a', 'Edge Inn')],
    });
    // 29 London days before 28 September is 30 August.
    let digest = await findSignupDigest(fakeDb(tables('2026-08-30T20:00:00Z')).service, NOW);
    expect(digest.noCheckout.map((v) => v.days)).toEqual([29]);
    expect(digest.neverStarted).toEqual([]);
    digest = await findSignupDigest(fakeDb(tables('2026-08-29T20:00:00Z')).service, NOW);
    expect(digest.noCheckout).toEqual([]);
    expect(digest.neverStarted.map((v) => v.days)).toEqual([30]);
  });

  it('lists a venue set up on the Friday before the clock change as 3 days old on the Monday', async () => {
    const monday = new Date('2026-10-26T08:00:00Z');
    const { service } = fakeDb({
      self_serve_signups: [
        { user_id: 'o', account_id: 'a', verified_at: '2026-10-23T08:30:00Z', venue_created_at: '2026-10-23T08:30:00Z' },
        { user_id: 'p', account_id: 'b', verified_at: '2026-10-24T08:30:00Z', venue_created_at: '2026-10-24T08:30:00Z' },
      ],
      accounts: [account('a', 'Friday Inn'), account('b', 'Saturday Bar')],
    });
    const digest = await findSignupDigest(service, monday);
    expect(digest.noCheckout).toEqual([{ accountId: 'a', name: 'Friday Inn', since: '2026-10-23T08:30:00Z', days: 3 }]);
  });

  it('reads nothing about brands when no self-serve venue is old enough', async () => {
    const { service, reads } = fakeDb({ self_serve_signups: [] });
    const digest = await findSignupDigest(service, NOW);
    expect(signupDigestSize(digest)).toBe(0);
    expect(reads).not.toContain('accounts');
  });

  it('gives every read the caller\'s signal, and starts no further read once it fires', async () => {
    const controller = new AbortController();
    const { service, reads, signals } = fakeDb(
      {
        self_serve_signups: [
          { user_id: 'u1', account_id: null, verified_at: '2026-09-20T10:00:00Z', venue_created_at: null },
          { user_id: 'o1', account_id: 'a1', verified_at: '2026-09-20T10:00:00Z', venue_created_at: '2026-09-20T10:10:00Z' },
        ],
      },
      undefined,
      // The deadline passes during the confirmed-logins read.
      (table) => {
        if (table === 'self_serve_signups') controller.abort();
      },
    );

    await expect(findSignupDigest(service, NOW, { signal: controller.signal })).rejects.toThrow('lookup stopped: the deadline passed');
    expect(reads).toEqual(['admin_audit', 'self_serve_signups']);
    expect(signals.every((signal) => signal === controller.signal)).toBe(true);
  });

  it('reads without a deadline for the daily email', async () => {
    const { service, signals } = fakeDb({});
    await findSignupDigest(service, NOW);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal !== null && !signal.aborted)).toBe(true);
  });

  it('throws when a read fails, so the reminder can say the lists are unavailable', async () => {
    await expect(findSignupDigest(fakeDb({}, 'admin_audit').service, NOW)).rejects.toThrow(/admin_audit lookup failed/);
    await expect(
      findSignupDigest(
        fakeDb(
          { self_serve_signups: [{ user_id: 'o', account_id: 'a', verified_at: '2026-09-01T00:00:00Z', venue_created_at: '2026-09-01T00:00:00Z' }] },
          'subscriptions',
        ).service,
        NOW,
      ),
    ).rejects.toThrow(/subscriptions lookup failed/);
  });
});

describe('renderSignupDigestSections', () => {
  const DIGEST: SignupDigest = {
    alerts: [{ kind: 'provisioning', rows: 3, lastAt: '2026-09-27T21:00:00Z' }],
    verifiedWithoutVenue: [{ userId: '11111111-1111-4111-8111-111111111111', verifiedAt: '2026-09-26T10:00:00Z', days: 2 }],
    noCheckout: [{ accountId: 'a1', name: 'Fish & Chips <Co>', since: '2026-09-24T09:10:00Z', days: 4 }],
    trialWithoutConnection: [{ accountId: 'a2', name: 'Trial Quiet Bar', since: '2026-09-20T10:00:00Z', days: 1 }],
    neverStarted: [{ accountId: 'a3', name: 'The Quiet Inn', since: '2026-08-20T09:10:00Z', days: 39 }],
  };

  it('renders every list with London dates, escaped names and the admin link', () => {
    const html = renderSignupDigestSections(DIGEST, 'https://cheers.test/').join('\n');
    expect(html).toContain('<strong>provisioning</strong>: 3 times, last at 27/09/2026, 22:00:00 (UK time).');
    expect(html).toContain('11111111-1111-4111-8111-111111111111: confirmed 26 September 2026, 2 days ago.');
    expect(html).toContain('<strong>Fish &amp; Chips &lt;Co&gt;</strong>: venue set up 24 September 2026, 4 days ago.');
    expect(html).toContain('<strong>Trial Quiet Bar</strong>: trial started 20 September 2026, 1 day ago.');
    expect(html).toContain('<strong>The Quiet Inn</strong>: venue set up 20 August 2026, 39 days ago.');
    expect(html).toContain('href="https://cheers.test/admin#offboarding"');
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
  });

  it('says which kinds refused nobody, so a closure_notice is not described as a refusal', () => {
    const html = renderSignupDigestSections(
      {
        ...DIGEST,
        alerts: [
          { kind: 'provisioning', rows: 3, lastAt: '2026-09-27T21:00:00Z' },
          { kind: 'closure_notice', rows: 1, lastAt: '2026-09-27T20:00:00Z' },
          { kind: 'closure_request', rows: 2, lastAt: '2026-09-27T19:00:00Z' },
          { kind: 'admin_export', rows: 1, lastAt: '2026-09-27T18:00:00Z' },
        ],
      },
      'https://cheers.test',
    ).join('\n');
    expect(html).toContain('Unless a line says otherwise, each one was refused with an error and our email address.');
    expect(html).toContain(
      "<strong>closure_notice</strong>: 1 time, last at 27/09/2026, 21:00:00 (UK time). Not refused: the owner was told we have their request to close the venue",
    );
    expect(html).toContain('<strong>closure_request</strong>: 2 times, last at 27/09/2026, 20:00:00 (UK time).</li>');
    expect(html).toContain('<strong>provisioning</strong>: 3 times, last at 27/09/2026, 22:00:00 (UK time).</li>');
    expect(html).toContain('<strong>admin_export</strong>: 1 time, last at 27/09/2026, 19:00:00 (UK time). No customer involved');
    expect(html).not.toContain('Each one was refused');
  });

  it('leaves empty lists out entirely', () => {
    expect(
      renderSignupDigestSections({ alerts: [], verifiedWithoutVenue: [], noCheckout: [], trialWithoutConnection: [], neverStarted: [] }, 'https://cheers.test'),
    ).toEqual([]);
  });

  it('shows at most the list limit and counts the rest', () => {
    const many = Array.from({ length: DIGEST_LIST_LIMIT + 3 }, (_, index) => ({
      accountId: `a${index}`,
      name: `Venue ${index}`,
      since: '2026-08-20T09:10:00Z',
      days: 39,
    }));
    const html = renderSignupDigestSections({ ...DIGEST, neverStarted: many }, 'https://cheers.test').join('\n');
    expect(html).toContain('<li>and 3 more</li>');
  });

  it('throws rather than send a broken date or count', () => {
    expect(() =>
      renderSignupDigestSections({ ...DIGEST, noCheckout: [{ ...DIGEST.noCheckout[0]!, since: 'not a date' }] }, 'https://cheers.test'),
    ).toThrow(/Cannot render date/);
    expect(() =>
      renderSignupDigestSections({ ...DIGEST, neverStarted: [{ ...DIGEST.neverStarted[0]!, days: Number.NaN }] }, 'https://cheers.test'),
    ).toThrow(/day count/);
    expect(() => renderSignupDigestSections({ ...DIGEST, alerts: [{ kind: 'x', rows: 1, lastAt: '' }] }, 'https://cheers.test')).toThrow(
      /Cannot render time/,
    );
  });
});
