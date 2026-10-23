import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * createScheduledBatch asks the events system for each Facebook event post's own link
 * (tasks/SPEC-per-post-links.md) and never fails over it.
 */

const mocks = vi.hoisted(() => ({
  scheduleContentBatch: vi.fn(),
  loadManagementConfig: vi.fn(),
  resolveFacebookPostLinks: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/billing/entitlement-server', () => ({
  requireEntitledContext: vi.fn(async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'delete']) chain[method] = vi.fn(() => chain);
    chain.single = vi.fn(async () => ({ data: { id: 'draft-1' }, error: null }));
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
    return { supabase: chain, accountId: 'acc-1' };
  }),
}));
vi.mock('@/lib/content/schedule-batch', () => ({
  scheduleContentBatch: mocks.scheduleContentBatch,
  validateScheduleBatch: () => null,
}));
vi.mock('@/lib/content/post-links', () => ({
  loadManagementConfig: mocks.loadManagementConfig,
  resolveFacebookPostLinks: mocks.resolveFacebookPostLinks,
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({ service: true }) }));
vi.mock('@/lib/publishing/audit', () => ({ logPublishAuditEvent: vi.fn() }));
vi.mock('@/lib/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createScheduledBatch } from '@/app/actions/content';

const CONFIG = { baseUrl: 'https://management.example.com', apiKey: 'fixture-management-key' };
const slotCopies = [
  { slotKey: 'slot-a', scheduledAt: '2026-11-10T11:00:00.000Z', copy: { facebook: { body: 'Cash bingo.' }, instagram: { body: 'Cash bingo.' } } },
];

function batch(overrides: Record<string, unknown> = {}) {
  return createScheduledBatch({
    draftContentId: 'draft-1',
    contentType: 'event',
    brief: { title: 'Snowball Showdown', ctaLinks: { facebook: 'https://l.the-anchor.pub/fb6e761f', instagram: 'https://l.the-anchor.pub/ig6e761f' } },
    selectedMediaIds: [],
    slotCopies,
    platforms: ['facebook', 'instagram'],
    mode: 'schedule',
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scheduleContentBatch.mockResolvedValue({ success: true, contentItemIds: ['item-1'], campaignId: 'camp-1', placements: ['feed'] });
  mocks.loadManagementConfig.mockResolvedValue(CONFIG);
  mocks.resolveFacebookPostLinks.mockResolvedValue(new Map([['slot-a', 'https://l.the-anchor.pub/fp0001']]));
});

describe('createScheduledBatch per-post Facebook links', () => {
  it("gives each Facebook event post its own link from the brand's events system", async () => {
    await expect(batch()).resolves.toMatchObject({ success: true });

    expect(mocks.loadManagementConfig).toHaveBeenCalledWith({ service: true }, 'acc-1');
    expect(mocks.resolveFacebookPostLinks).toHaveBeenCalledWith(CONFIG, {
      facebookLink: 'https://l.the-anchor.pub/fb6e761f',
      slots: [{ slotKey: 'slot-a', scheduledAt: '2026-11-10T11:00:00.000Z' }],
    });
    expect(mocks.scheduleContentBatch.mock.calls[0][2].facebookPostLinks).toEqual(new Map([['slot-a', 'https://l.the-anchor.pub/fp0001']]));
  });

  it("schedules with the event's shared link, and logs a warning, when the events system fails", async () => {
    mocks.resolveFacebookPostLinks.mockRejectedValue(new Error('events system unavailable'));
    await expect(batch()).resolves.toMatchObject({ success: true });

    expect(mocks.scheduleContentBatch.mock.calls[0][2].facebookPostLinks).toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith('per-post Facebook links unavailable; the posts keep the event link', {
      accountId: 'acc-1',
      error: 'events system unavailable',
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('fixture-management-key');
  });

  it('asks for nothing for posts that are not events, not on Facebook, or have no event link, or without a connection', async () => {
    await batch({ contentType: 'instant_post' });
    await batch({ platforms: ['instagram'] });
    await batch({ brief: { title: 'Snowball Showdown' } });
    expect(mocks.resolveFacebookPostLinks).not.toHaveBeenCalled();

    mocks.loadManagementConfig.mockResolvedValue(null);
    await batch();
    expect(mocks.resolveFacebookPostLinks).not.toHaveBeenCalled();
    expect(mocks.scheduleContentBatch.mock.calls.every((call) => call[2].facebookPostLinks === undefined)).toBe(true);
  });
});
