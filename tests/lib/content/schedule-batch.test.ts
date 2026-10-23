import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleContentBatch, validateScheduleBatch } from '@/lib/content/schedule-batch';

const enqueueAndDispatch = vi.fn();
vi.mock('@/lib/publishing/queue', () => ({
  enqueueAndDispatch: (...args: unknown[]) => enqueueAndDispatch(...args),
}));

type Row = Record<string, unknown>;

/** Applies eq/in filters to fixed rows; records inserts, upserts and deletes. */
function fakeDb(rows: Record<string, Row[]>, { failUpsert = false } = {}) {
  const writes: Array<{ table: string; op: string; payload?: unknown; ids?: unknown[] }> = [];
  let nextId = 1;
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'delete' = 'select';
    let payload: Row[] = [];
    let ids: unknown[] = [];
    const filters: Array<(row: Row) => boolean> = [];
    const result = (): { data: unknown; error: unknown } => {
      if (op === 'insert') {
        const inserted = payload.map((row) => ({ id: `${table}-${nextId++}`, ...row }));
        writes.push({ table, op, payload });
        return { data: inserted, error: null };
      }
      if (op === 'delete') {
        writes.push({ table, op, ids });
        return { data: null, error: null };
      }
      return { data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, list: unknown[]) => {
        ids = list;
        filters.push((row) => list.includes(row[column]));
        return builder;
      },
      returns: () => builder,
      insert: (next: Row | Row[]) => {
        op = 'insert';
        payload = Array.isArray(next) ? next : [next];
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      upsert: (next: Row[]) => {
        writes.push({ table, op: 'upsert', payload: next });
        return Promise.resolve({ error: failUpsert ? { message: 'variant write failed' } : null });
      },
      maybeSingle: async () => {
        const { data } = result();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
      },
      single: async () => {
        const { data } = result();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, writes };
}

const eventBrief = {
  title: 'Snowball Showdown',
  eventName: 'Snowball Showdown',
  platforms: ['facebook', 'instagram'],
  eventDate: '2026-11-18',
  eventTime: '19:00',
  placements: ['feed', 'story'],
};

const slot = {
  slotKey: 'calendar:2026-11-10',
  scheduledAt: '2026-11-10T11:00:00.000Z',
  label: 'Fresh angle',
  copy: { facebook: { body: 'Cash bingo on Wednesday 18th November.' }, instagram: { body: 'Cash bingo, Wednesday 18th November.' } },
  mediaIds: ['art-1'],
};

const library = {
  media_assets: [{ id: 'art-1', account_id: 'acc-1', media_type: 'image', derived_variants: { story: 'derived/art-1/story.jpg' } }],
  campaigns: [
    { id: 'camp-own', account_id: 'acc-1', campaign_type: 'event' },
    { id: 'camp-weekly', account_id: 'acc-1', campaign_type: 'weekly' },
    { id: 'camp-other', account_id: 'acc-2', campaign_type: 'event' },
  ],
};

beforeEach(() => {
  enqueueAndDispatch.mockReset();
  enqueueAndDispatch.mockResolvedValue(undefined);
});

describe('scheduleContentBatch with an existing campaign', () => {
  it('adds a feed post and a story per platform to that campaign, creating none', async () => {
    const { db, writes } = fakeDb(library);
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'event',
      brief: eventBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
      existingCampaignId: 'camp-own',
    });

    expect(result).toMatchObject({ success: true, campaignId: 'camp-own', placements: ['feed', 'story'] });
    expect(writes.some((write) => write.table === 'campaigns' && write.op === 'insert')).toBe(false);
    const items = writes.find((write) => write.table === 'content_items' && write.op === 'insert')?.payload as Row[];
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.campaign_id === 'camp-own' && item.account_id === 'acc-1')).toBe(true);
    expect(enqueueAndDispatch).toHaveBeenCalledTimes(4);
  });

  it("refuses another brand's campaign before writing anything", async () => {
    const { db, writes } = fakeDb(library);
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'event',
      brief: eventBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook'],
      mode: 'schedule',
      existingCampaignId: 'camp-other',
    });

    expect(result).toEqual({ error: 'That campaign no longer exists.' });
    expect(writes.filter((write) => write.op !== 'select')).toEqual([]);
  });

  it('refuses a campaign of another kind before writing anything', async () => {
    const { db, writes } = fakeDb(library);
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'event',
      brief: eventBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook'],
      mode: 'schedule',
      existingCampaignId: 'camp-weekly',
    });

    expect(result).toEqual({ error: 'These posts are a different kind from that campaign, so they were not added to it.' });
    expect(writes.filter((write) => write.op !== 'select')).toEqual([]);
  });

  it('rolls back its own posts but never deletes the existing campaign', async () => {
    const { db, writes } = fakeDb(library, { failUpsert: true });
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'event',
      brief: eventBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook'],
      mode: 'schedule',
      existingCampaignId: 'camp-own',
    });

    expect(result.error).toBe('We could not schedule your posts, so nothing was scheduled. Please try again.');
    expect(writes.some((write) => write.table === 'content_items' && write.op === 'delete')).toBe(true);
    expect(writes.some((write) => write.table === 'campaigns' && write.op === 'delete')).toBe(false);
  });
});

describe('scheduleContentBatch for weekly and one-off posts', () => {
  const weeklyBrief = {
    title: 'Weekday lunch',
    platforms: ['facebook', 'instagram'],
    daysOfWeek: [2, 3, 4, 5],
    time: '12:00',
    endDate: '2026-11-26',
    placement: 'feed',
    ctaLinks: { facebook: 'https://l.example.com/fb-lunch', instagram: 'https://l.example.com/ig-lunch' },
  };

  it('keeps a wizard weekly post to its one placement', async () => {
    const { db, writes } = fakeDb(library);
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'weekly_recurring',
      brief: weeklyBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
    });

    expect(result).toMatchObject({ success: true, placements: ['feed'] });
    const items = writes.find((write) => write.table === 'content_items' && write.op === 'insert')?.payload as Row[];
    expect(items.map((item) => item.placement)).toEqual(['feed', 'feed']);
  });

  it('gives a weekly or one-off post its story when the brief asks for both placements', async () => {
    for (const [contentType, brief] of [
      ['weekly_recurring', { ...weeklyBrief, placements: ['feed', 'story'] }],
      ['instant_post', { title: 'Private hire', platforms: ['facebook', 'instagram'], publishMode: 'schedule', placements: ['feed', 'story'] }],
    ] as const) {
      const { db, writes } = fakeDb(library);
      const result = await scheduleContentBatch(db, 'acc-1', {
        contentType,
        brief,
        selectedMediaIds: [],
        slotCopies: [slot],
        platforms: ['facebook', 'instagram'],
        mode: 'schedule',
      });

      expect(result).toMatchObject({ success: true, placements: ['feed', 'story'] });
      const items = writes.find((write) => write.table === 'content_items' && write.op === 'insert')?.payload as Row[];
      expect(items.map((item) => `${item.platform} ${item.placement}`).sort()).toEqual(['facebook feed', 'facebook story', 'instagram feed', 'instagram story']);
    }
  });

  it("puts the Instagram link on a weekly campaign's link-in-bio card", async () => {
    const { db, writes } = fakeDb(library);
    await scheduleContentBatch(db, 'acc-1', {
      contentType: 'weekly_recurring',
      brief: weeklyBrief,
      selectedMediaIds: [],
      slotCopies: [slot],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
    });

    const campaign = writes.find((write) => write.table === 'campaigns' && write.op === 'insert')?.payload as Row[];
    expect(campaign[0].link_in_bio_url).toBe('https://l.example.com/ig-lunch');
  });
});

describe('scheduleContentBatch with per-post Facebook links', () => {
  const linkedBrief = {
    ...eventBrief,
    ctaLinks: { facebook: 'https://l.the-anchor.pub/fb6e761f', instagram: 'https://l.the-anchor.pub/ig6e761f' },
  };

  async function variants(facebookPostLinks?: Map<string, string>, slotCopies: Array<typeof slot> = [slot]): Promise<Row[]> {
    const { db, writes } = fakeDb(library);
    const result = await scheduleContentBatch(db, 'acc-1', {
      contentType: 'event',
      brief: linkedBrief,
      selectedMediaIds: [],
      slotCopies,
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
      facebookPostLinks,
    });
    expect(result.success).toBe(true);
    return writes.find((write) => write.table === 'content_variants' && write.op === 'upsert')?.payload as Row[];
  }

  it("puts the post's own link on its Facebook feed post, and nowhere else", async () => {
    const rows = await variants(new Map([[slot.slotKey, 'https://l.the-anchor.pub/fp0001']]));
    const withBody = rows.filter((row) => typeof row.body === 'string' && row.body);
    const facebook = withBody.find((row) => String(row.body).includes('Cash bingo on Wednesday'));
    const instagram = withBody.find((row) => String(row.body).includes('Cash bingo, Wednesday'));

    expect(facebook?.body).toContain('https://l.the-anchor.pub/fp0001');
    expect(facebook?.body).not.toContain('fb6e761f');
    expect((facebook?.preview_data as Row).ctaUrl).toBe('https://l.the-anchor.pub/fp0001');
    expect(JSON.stringify(instagram)).not.toContain('fp0001');
  });

  it("keeps the event's shared link when there are no per-post links", async () => {
    const rows = await variants();
    const facebook = rows.find((row) => String(row.body ?? '').includes('Cash bingo on Wednesday'));
    expect(facebook?.body).toContain('https://l.the-anchor.pub/fb6e761f');
  });

  // Codex review on #220: an edited caption is published as written, so it needs the swap too.
  const edited = {
    ...slot,
    copy: {
      ...slot.copy,
      facebook: {
        ...slot.copy.facebook,
        publishBodyOverride: 'Cash bingo on Wednesday, written by hand.\n\nBook now: https://l.the-anchor.pub/fb6e761f. See you there!',
      },
    },
  };

  it("puts the post's own link into a caption the owner edited, keeping every other edit", async () => {
    const rows = await variants(new Map([[slot.slotKey, 'https://l.the-anchor.pub/fp0001']]), [edited]);
    const facebook = rows.find((row) => String(row.body ?? '').includes('written by hand'));
    const preview = facebook?.preview_data as Row;

    expect(facebook?.body).toBe('Cash bingo on Wednesday, written by hand.\n\nBook now: https://l.the-anchor.pub/fp0001. See you there!');
    expect((preview.structuredCopy as Row).publishBodyOverride).toBe(facebook?.body);
    expect(preview.ctaUrl).toBe('https://l.the-anchor.pub/fp0001');
  });

  it('leaves an edited caption exactly as written when there are no per-post links', async () => {
    const rows = await variants(undefined, [edited]);
    const facebook = rows.find((row) => String(row.body ?? '').includes('written by hand'));
    expect(facebook?.body).toBe(edited.copy.facebook.publishBodyOverride);
  });
});

describe('validateScheduleBatch', () => {
  it('applies the event-order rule to tools as well as the wizard', () => {
    const reason = validateScheduleBatch({
      contentType: 'event',
      brief: { ...eventBrief, promotionWindow: { opensOn: '2026-11-19', afterEvent: 'Snowball Showdown', afterDate: '2026-11-18', category: 'Cash Bingo' } },
      slotCopies: [slot],
    });
    expect(reason).toMatch(/can be promoted from Thursday 19th November/);
  });
});
