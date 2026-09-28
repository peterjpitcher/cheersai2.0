/**
 * The sign-up funnel for the admin Sign-ups card (spec §4.10), read from an
 * in-memory database that applies the filters PostgREST would. Windows are
 * London calendar days, including across the October 2026 clock change.
 */
import { describe, expect, it } from 'vitest';

import { findSignupFunnel, FUNNEL_WINDOWS_DAYS } from './funnel';

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, opts: { failTable?: string; pageCap?: number } = {}) {
  const reads: Array<{ table: string; range: [number, number] | null }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const orderBy: string[] = [];
    let range: [number, number] | null = null;
    const chain: Record<string, unknown> = {};
    const compare = (a: unknown, b: unknown) => {
      if (typeof a === 'string' && typeof b === 'string') {
        const [x, y] = [Date.parse(a), Date.parse(b)];
        return Number.isNaN(x) || Number.isNaN(y) ? a.localeCompare(b) : x - y;
      }
      return 0;
    };
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => (filters.push((row) => row[column] === value), chain);
    chain.in = (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), chain);
    chain.gte = (column: string, value: string) => (filters.push((row) => row[column] != null && compare(row[column], value) >= 0), chain);
    chain.order = (column: string) => (orderBy.push(column), chain);
    chain.range = (start: number, end: number) => ((range = [start, end]), chain);
    chain.returns = async () => {
      reads.push({ table, range });
      if (opts.failTable === table) return { data: null, error: { message: 'connection refused' } };
      let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
      rows = [...rows].sort((a, b) => {
        for (const column of orderBy) {
          const diff = compare(a[column], b[column]);
          if (diff !== 0) return diff;
        }
        return 0;
      });
      if (range) {
        // PostgREST never returns more than its max-rows setting in one response.
        const end = Math.min(range[1], range[0] + (opts.pageCap ?? 1000) - 1);
        rows = rows.slice(range[0], end + 1);
      }
      return { data: rows, error: null };
    };
    return chain;
  };
  return { service: { from } as never, reads };
}

// Monday 28 September 2026, 04:45 in London (BST).
const NOW = new Date('2026-09-28T03:45:00.000Z');

function signup(id: string, requestedAt: string, extra: Row = {}): Row {
  return { id, account_id: null, requested_at: requestedAt, verified_at: null, venue_created_at: null, ...extra };
}

describe('findSignupFunnel', () => {
  it('counts each step per window, one row per login, with the checklist rules for the derived steps', async () => {
    const { service } = fakeDb({
      self_serve_signups: [
        // Today: asked only.
        signup('s1', '2026-09-28T01:00:00Z'),
        // 3 days ago: confirmed, venue, trial, connected, posted.
        signup('s2', '2026-09-25T10:00:00Z', {
          account_id: 'a-full',
          verified_at: '2026-09-25T10:05:00Z',
          venue_created_at: '2026-09-25T10:10:00Z',
        }),
        // 20 days ago: venue and Checkout, connection only 'needs_action', a draft but nothing posted.
        signup('s3', '2026-09-08T10:00:00Z', {
          account_id: 'a-checkout',
          verified_at: '2026-09-08T10:05:00Z',
          venue_created_at: '2026-09-08T10:10:00Z',
        }),
        // 60 days ago: confirmed, venue since deleted (account_id set null on delete).
        signup('s4', '2026-07-30T10:00:00Z', { verified_at: '2026-07-30T10:05:00Z', venue_created_at: '2026-07-30T10:10:00Z' }),
        // 100 days ago: outside every window.
        signup('s5', '2026-06-20T10:00:00Z', { account_id: 'a-old', verified_at: '2026-06-20T10:05:00Z' }),
      ],
      subscriptions: [
        { stripe_subscription_id: 'sub_1', account_id: 'a-full' },
        { stripe_subscription_id: 'sub_2', account_id: 'a-checkout' },
        { stripe_subscription_id: 'sub_3', account_id: 'a-checkout' },
        { stripe_subscription_id: 'sub_old', account_id: 'a-old' },
        // A brand the operator created: never counted.
        { stripe_subscription_id: 'sub_anchor', account_id: 'a-anchor' },
      ],
      social_connections: [
        { id: 'c1', account_id: 'a-full', status: 'active' },
        { id: 'c2', account_id: 'a-full', status: 'expiring' },
        { id: 'c3', account_id: 'a-checkout', status: 'needs_action' },
        { id: 'c4', account_id: 'a-anchor', status: 'active' },
      ],
      content_items: [
        { id: 'i1', account_id: 'a-full', status: 'posted' },
        { id: 'i2', account_id: 'a-full', status: 'posted' },
        { id: 'i3', account_id: 'a-checkout', status: 'draft' },
        { id: 'i4', account_id: 'a-anchor', status: 'posted' },
      ],
    });

    const funnel = await findSignupFunnel(service, NOW);

    expect(funnel.windows.map((window) => window.days)).toEqual([...FUNNEL_WINDOWS_DAYS]);
    const [week, month, quarter] = funnel.windows;
    expect(week.counts).toEqual({ requested: 2, verified: 1, venueCreated: 1, checkoutConfirmed: 1, channelConnected: 1, firstPost: 1 });
    expect(month.counts).toEqual({ requested: 3, verified: 2, venueCreated: 2, checkoutConfirmed: 2, channelConnected: 1, firstPost: 1 });
    expect(quarter.counts).toEqual({ requested: 4, verified: 3, venueCreated: 3, checkoutConfirmed: 2, channelConnected: 1, firstPost: 1 });
  });

  it('starts each window at midnight in London, today included', async () => {
    const { service } = fakeDb({
      self_serve_signups: [
        // 00:30 BST on Tuesday 22 September (23:30 UTC on the 21st): 7 London days including today, so inside.
        signup('in', '2026-09-21T23:30:00Z'),
        // 23:30 BST on Monday 21 September: 8 London days ago, outside the 7-day window.
        signup('out', '2026-09-21T22:30:00Z'),
      ],
    });

    const funnel = await findSignupFunnel(service, NOW);

    expect(funnel.windows[0]).toMatchObject({ days: 7, since: '2026-09-21T23:00:00.000Z', counts: { requested: 1 } });
    expect(funnel.windows[1].counts.requested).toBe(2);
  });

  it('counts the 25-hour clock-change day as one day', async () => {
    // Friday 30 October 2026, 09:00 GMT. The 7-day window starts at midnight on Saturday 24 October (BST).
    const friday = new Date('2026-10-30T09:00:00Z');
    const { service } = fakeDb({
      self_serve_signups: [
        signup('sat', '2026-10-23T23:30:00Z'), // 00:30 BST on Saturday 24 October: inside
        signup('fri', '2026-10-23T22:30:00Z'), // 23:30 BST on Friday 23 October: outside
      ],
    });

    const funnel = await findSignupFunnel(service, friday);

    expect(funnel.windows[0]).toMatchObject({ since: '2026-10-23T23:00:00.000Z', counts: { requested: 1 } });
  });

  it('reads every page, so a busy brand cannot push another out of the derived counts', async () => {
    const content_items: Row[] = [];
    // The first brand (by id order) has more posts than one 1,000-row response holds; the second has one.
    for (let index = 0; index < 1005; index += 1) {
      content_items.push({ id: `p${String(index).padStart(4, '0')}`, account_id: 'a-busy', status: 'posted' });
    }
    content_items.push({ id: 'q1', account_id: 'b-quiet', status: 'posted' });
    const { service, reads } = fakeDb({
      self_serve_signups: [
        signup('s1', '2026-09-27T10:00:00Z', { account_id: 'a-busy', venue_created_at: '2026-09-27T10:10:00Z' }),
        signup('s2', '2026-09-27T11:00:00Z', { account_id: 'b-quiet', venue_created_at: '2026-09-27T11:10:00Z' }),
      ],
      content_items,
    });

    const funnel = await findSignupFunnel(service, NOW);

    expect(reads.filter((read) => read.table === 'content_items').map((read) => read.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(funnel.windows[0].counts.firstPost).toBe(2);
  });

  it('skips the brand lookups when no sign-up has a venue', async () => {
    const { service, reads } = fakeDb({ self_serve_signups: [signup('s1', '2026-09-27T10:00:00Z')] });

    const funnel = await findSignupFunnel(service, NOW);

    expect(reads.map((read) => read.table)).toEqual(['self_serve_signups']);
    expect(funnel.windows[2].counts).toEqual({
      requested: 1,
      verified: 0,
      venueCreated: 0,
      checkoutConfirmed: 0,
      channelConnected: 0,
      firstPost: 0,
    });
  });

  it('gives zeros for every window when there are no sign-ups (the switch is off)', async () => {
    const { service } = fakeDb({});

    const funnel = await findSignupFunnel(service, NOW);

    expect(funnel.windows).toHaveLength(3);
    for (const window of funnel.windows) expect(Object.values(window.counts).every((count) => count === 0)).toBe(true);
  });

  it.each(['self_serve_signups', 'subscriptions', 'social_connections', 'content_items'])(
    'throws when the %s read fails, so the card shows an error instead of wrong numbers',
    async (table) => {
      const { service } = fakeDb(
        { self_serve_signups: [signup('s1', '2026-09-27T10:00:00Z', { account_id: 'a1', venue_created_at: '2026-09-27T10:10:00Z' })] },
        { failTable: table },
      );

      await expect(findSignupFunnel(service, NOW)).rejects.toThrow(`${table} lookup failed: connection refused`);
    },
  );
});
