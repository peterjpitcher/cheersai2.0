/**
 * The operator purge reminder: which brands count as due, how many London
 * calendar days overdue they are, and the rendered email (fixtures must never
 * produce undefined, NaN, Invalid Date or a blank date).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.test' }, server: {} } }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));

import { findBrandsDueForDeletion, renderPurgeReminderEmail, type BrandDueForDeletion } from './purge-reminder';

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
    const { subject, html } = renderPurgeReminderEmail([brand()], 'https://cheers.test/');

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
      [
        brand(),
        brand({ accountId: 'b2', name: 'Fish & Chips <Co>', daysOverdue: 1 }),
        brand({ accountId: 'b3', name: 'The Crown', daysOverdue: 0 }),
      ],
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
    expect(() => renderPurgeReminderEmail([brand({ purgeAfter: 'not a date' })], 'https://cheers.test')).toThrow(/Cannot render date/);
    expect(() => renderPurgeReminderEmail([brand({ daysOverdue: Number.NaN })], 'https://cheers.test')).toThrow(/days overdue/);
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
