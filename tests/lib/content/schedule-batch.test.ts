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
    { id: 'camp-own', account_id: 'acc-1' },
    { id: 'camp-other', account_id: 'acc-2' },
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
