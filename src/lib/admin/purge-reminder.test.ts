/**
 * The operator purge reminder: which brands count as due, how many London
 * calendar days overdue they are, and the rendered email (fixtures must never
 * produce undefined, NaN, Invalid Date or a blank date).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.test' }, server: { OPERATOR_ALERT_EMAIL: 'ops@cheers.test' } } }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));

import { sendEmail } from '@/lib/email/resend';

import {
  findBrandsDueForDeletion,
  findLapsedBrands,
  renderPurgeReminderEmail,
  sendPurgeReminder,
  subscriptionEndedAt,
  type BrandDueForDeletion,
  type LapsedBrand,
} from './purge-reminder';

const BAD_OUTPUT = ['undefined', 'NaN', 'Invalid Date', 'null', 'Invalid DateTime'];

function serviceReturning(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'not', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.returns = vi.fn(async () => ({ data: rows, error: null }));
  return { from: vi.fn(() => chain) } as never;
}

function brand(overrides: Partial<BrandDueForDeletion> = {}): BrandDueForDeletion {
  return {
    accountId: '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a',
    name: 'The Old Bell',
    offboardedAt: '2026-08-01T10:00:00.000Z',
    purgeAfter: '2026-08-31T10:00:00.000Z',
    daysOverdue: 27,
    ...overrides,
  };
}

describe('renderPurgeReminderEmail', () => {
  it('renders one brand with its dates, days overdue and the admin link', () => {
    const { subject, html } = renderPurgeReminderEmail({ dueForDeletion: [brand()], lapsed: [] }, 'https://cheers.test/');

    expect(subject).toBe('[Cheers operator] 1 offboarded brand is due for deletion');
    expect(html).toContain('<strong>The Old Bell</strong>: offboarded 1 August 2026, deletion allowed from 31 August 2026, 27 days overdue.');
    expect(html).toContain('This offboarded brand has passed the 30-day hold and its data has not been deleted yet.');
    expect(html).toContain('href="https://cheers.test/admin#offboarding"');
    expect(html).toContain('Delete data');
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
    for (const bad of BAD_OUTPUT) expect(subject).not.toContain(bad);
  });

  it('renders several brands, including one due today and one a day overdue', () => {
    const { subject, html } = renderPurgeReminderEmail(
      {
        dueForDeletion: [
          brand(),
          brand({ accountId: 'b2', name: 'Fish & Chips <Co>', daysOverdue: 1 }),
          brand({ accountId: 'b3', name: 'The Crown', daysOverdue: 0 }),
        ],
        lapsed: [],
      },
      'https://cheers.test',
    );

    expect(subject).toBe('[Cheers operator] 3 offboarded brands are due for deletion');
    expect(html).toContain('These offboarded brands have passed the 30-day hold and their data');
    expect(html).toContain('<strong>Fish &amp; Chips &lt;Co&gt;</strong>');
    expect(html).toContain('1 day overdue.');
    expect(html).toContain('<strong>The Crown</strong>: offboarded 1 August 2026, deletion allowed from 31 August 2026, due today.');
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
  });

  it('throws rather than send a broken date', () => {
    expect(() => renderPurgeReminderEmail({ dueForDeletion: [brand({ purgeAfter: 'not a date' })], lapsed: [] }, 'https://cheers.test')).toThrow(/Cannot render date/);
    expect(() => renderPurgeReminderEmail({ dueForDeletion: [brand({ daysOverdue: Number.NaN })], lapsed: [] }, 'https://cheers.test')).toThrow(/days overdue/);
  });
});

describe('findBrandsDueForDeletion', () => {
  it('counts days overdue on the London calendar, not in 24-hour blocks (BST)', async () => {
    // 03:45 UTC on 27 September is 04:45 BST on the 27th.
    const now = new Date('2026-09-27T03:45:00.000Z');
    const brands = await findBrandsDueForDeletion(
      serviceReturning([
        // 23:30 UTC on the 26th is 00:30 BST on the 27th: due today.
        { id: 'a', business_name: 'Due today', offboarded_at: '2026-08-27T23:30:00.000Z', purge_after: '2026-09-26T23:30:00.000Z' },
        // 22:30 UTC on the 26th is 23:30 BST on the 26th: one day overdue, though only about 5 hours ago.
        { id: 'b', business_name: 'One day', offboarded_at: '2026-08-27T22:30:00.000Z', purge_after: '2026-09-26T22:30:00.000Z' },
      ]),
      now,
    );

    expect(brands.map((b) => [b.name, b.daysOverdue])).toEqual([
      ['Due today', 0],
      ['One day', 1],
    ]);
  });

  it('counts across the October clock change and in GMT', async () => {
    const acrossChange = await findBrandsDueForDeletion(
      serviceReturning([{ id: 'a', business_name: 'A', offboarded_at: '2026-09-24T10:00:00.000Z', purge_after: '2026-10-24T10:00:00.000Z' }]),
      new Date('2026-10-26T03:45:00.000Z'),
    );
    expect(acrossChange[0].daysOverdue).toBe(2);

    const winter = await findBrandsDueForDeletion(
      serviceReturning([{ id: 'b', business_name: 'B', offboarded_at: '2026-11-01T23:30:00.000Z', purge_after: '2026-12-01T23:30:00.000Z' }]),
      new Date('2026-12-02T03:45:00.000Z'),
    );
    expect(winter[0].daysOverdue).toBe(1);
  });

  it('falls back to the brand id when the name is blank', async () => {
    const brands = await findBrandsDueForDeletion(
      serviceReturning([{ id: 'acc-9', business_name: '  ', offboarded_at: '2026-08-01T10:00:00.000Z', purge_after: '2026-08-31T10:00:00.000Z' }]),
      new Date('2026-09-27T03:45:00.000Z'),
    );

    expect(brands[0]).toEqual({
      accountId: 'acc-9',
      name: 'acc-9',
      offboardedAt: '2026-08-01T10:00:00.000Z',
      purgeAfter: '2026-08-31T10:00:00.000Z',
      daysOverdue: 27,
    });
  });
});

function lapsedBrand(overrides: Partial<LapsedBrand> = {}): LapsedBrand {
  return {
    accountId: '0a0b0c0d-1111-4222-8333-444455556666',
    name: 'The Plough',
    endedAt: '2026-06-01T09:00:00.000Z',
    daysSinceEnded: 118,
    ...overrides,
  };
}

describe('renderPurgeReminderEmail with lapsed brands', () => {
  it('renders a lapsed brand with its end date, how long ago, and how to offboard or keep it', () => {
    const { subject, html } = renderPurgeReminderEmail({ dueForDeletion: [], lapsed: [lapsedBrand()] }, 'https://cheers.test');

    expect(subject).toBe('[Cheers operator] 1 brand has had no subscription for 90 days');
    expect(html).toContain('<strong>The Plough</strong>: subscription ended 1 June 2026, 118 days ago.');
    expect(html).toContain("This brand's subscription ended at least 90 days ago and it has not been closed.");
    expect(html).toContain('<strong>Offboard</strong>');
    expect(html).toContain('set its billing override to suspended');
    expect(html).not.toContain('Due for deletion');
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
    for (const bad of BAD_OUTPUT) expect(subject).not.toContain(bad);
  });

  it('renders both lists in one email', () => {
    const { subject, html } = renderPurgeReminderEmail(
      { dueForDeletion: [brand()], lapsed: [lapsedBrand(), lapsedBrand({ accountId: 'x', name: 'The Swan', daysSinceEnded: 90 })] },
      'https://cheers.test',
    );

    expect(subject).toBe('[Cheers operator] 1 brand due for deletion, 2 lapsed brands to review');
    expect(html).toContain('<h3>Due for deletion</h3>');
    expect(html).toContain('<h3>No subscription for 90 days</h3>');
    expect(html).toContain("These brands' subscriptions ended at least 90 days ago and they have not been closed.");
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    for (const bad of BAD_OUTPUT) expect(html).not.toContain(bad);
  });

  it('throws rather than send a broken lapsed date or count', () => {
    expect(() => renderPurgeReminderEmail({ dueForDeletion: [], lapsed: [lapsedBrand({ endedAt: 'nope' })] }, 'https://cheers.test')).toThrow(/Cannot render date/);
    expect(() => renderPurgeReminderEmail({ dueForDeletion: [], lapsed: [lapsedBrand({ daysSinceEnded: Number.NaN })] }, 'https://cheers.test')).toThrow(/subscription ended/);
  });
});

describe('subscriptionEndedAt', () => {
  it('uses the later of the cancel request and the period end', () => {
    expect(subscriptionEndedAt({ canceled_at: '2026-05-10T10:00:00Z', current_period_end: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:05:00Z' })).toBe('2026-06-01T09:00:00Z');
    expect(subscriptionEndedAt({ canceled_at: '2026-06-03T10:00:00Z', current_period_end: '2026-06-01T09:00:00Z', updated_at: '2026-06-03T10:05:00Z' })).toBe('2026-06-03T10:00:00Z');
  });

  it('falls back to the last update when neither date is stored', () => {
    expect(subscriptionEndedAt({ canceled_at: null, current_period_end: null, updated_at: '2026-06-02T08:00:00Z' })).toBe('2026-06-02T08:00:00Z');
  });
});

/** A service whose subscriptions read returns `subscriptions` and whose accounts read returns `accounts`. */
function lapsedService(subscriptions: Array<Record<string, unknown>>, accounts: Array<Record<string, unknown>>) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'range', 'in', 'is', 'not', 'lte']) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push([table, method, ...args]);
        return chain;
      });
    }
    chain.returns = vi.fn(async () => {
      if (table === 'subscriptions') return { data: subscriptions, error: null };
      const isLapsedRead = calls.some(([t, m]) => t === 'accounts' && m === 'in');
      return { data: isLapsedRead ? accounts : [], error: null };
    });
    return chain;
  });
  return { service: { from } as never, calls };
}

const NOW = new Date('2026-09-27T03:45:00.000Z');

describe('findLapsedBrands', () => {
  it('lists a brand 90 London days after its last subscription ended, not 89', async () => {
    const { service } = lapsedService(
      [
        // 90 London calendar days before 27 September is 29 June.
        { account_id: 'a90', status: 'canceled', canceled_at: '2026-06-20T10:00:00Z', current_period_end: '2026-06-29T10:00:00Z', updated_at: '2026-06-29T10:01:00Z' },
        { account_id: 'a89', status: 'canceled', canceled_at: null, current_period_end: '2026-06-30T10:00:00Z', updated_at: '2026-06-30T10:01:00Z' },
      ],
      [{ id: 'a90', business_name: 'Ninety' }],
    );

    const brands = await findLapsedBrands(service, NOW);

    expect(brands).toEqual([{ accountId: 'a90', name: 'Ninety', endedAt: '2026-06-29T10:00:00Z', daysSinceEnded: 90 }]);
  });

  it('skips a brand with any live subscription, and uses the latest end across old ones', async () => {
    const { service, calls } = lapsedService(
      [
        { account_id: 'live', status: 'canceled', canceled_at: '2026-01-01T00:00:00Z', current_period_end: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { account_id: 'live', status: 'active', canceled_at: null, current_period_end: '2026-10-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z' },
        { account_id: 'two', status: 'incomplete_expired', canceled_at: null, current_period_end: null, updated_at: '2026-01-05T00:00:00Z' },
        { account_id: 'two', status: 'canceled', canceled_at: '2026-05-01T00:00:00Z', current_period_end: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
      ],
      [{ id: 'two', business_name: 'Two Subs' }],
    );

    const brands = await findLapsedBrands(service, NOW);

    expect(brands.map((b) => [b.accountId, b.endedAt])).toEqual([['two', '2026-05-01T00:00:00Z']]);
    const inCall = calls.find(([t, m]) => t === 'accounts' && m === 'in');
    expect(inCall?.[3]).toEqual(['two']);
    expect(calls).toContainEqual(['accounts', 'is', 'offboarded_at', null]);
    expect(calls).toContainEqual(['accounts', 'is', 'billing_override', null]);
  });

  it('reads no accounts when nothing has lapsed', async () => {
    const { service, calls } = lapsedService([], []);
    expect(await findLapsedBrands(service, NOW)).toEqual([]);
    expect(calls.some(([t]) => t === 'accounts')).toBe(false);
  });
});

describe('sendPurgeReminder', () => {
  it('sends nothing when no brand is due or lapsed', async () => {
    vi.mocked(sendEmail).mockClear();
    const { service } = lapsedService([], []);
    expect(await sendPurgeReminder(service, NOW)).toEqual({ due: 0, lapsed: 0, sent: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails the operator when only lapsed brands are waiting', async () => {
    vi.mocked(sendEmail).mockClear();
    const { service } = lapsedService(
      [{ account_id: 'old', status: 'canceled', canceled_at: '2026-03-01T00:00:00Z', current_period_end: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' }],
      [{ id: 'old', business_name: 'Old Venue' }],
    );

    expect(await sendPurgeReminder(service, NOW)).toEqual({ due: 0, lapsed: 1, sent: true });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@cheers.test', required: true, subject: '[Cheers operator] 1 brand has had no subscription for 90 days' }));
  });
});
