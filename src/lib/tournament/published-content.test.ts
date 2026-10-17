import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearStaleRoundups, deleteFixtureContentItems, gamesLeftBehind } from './generate';
import { isPublishedContentStatus, isPublishedJobStatus } from './published-status';
import { findContentCoveringFixture } from '@/lib/tournament/content-freshness';
import type { Tournament, TournamentFixture } from '@/types/tournament';

vi.mock('./queries', () => ({ getPublishedPlacements: vi.fn(), getFixturesByTournament: vi.fn().mockResolvedValue([]) }));
vi.mock('./screening-service', () => ({ projectTournamentFixtures: vi.fn() }));
vi.mock('./overlay', () => ({ compositeOverlay: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/tournament/content-freshness', () => ({ findContentCoveringFixture: vi.fn() }));

type Row = Record<string, unknown>;

/** Records deletes and updates; answers selects from fixed rows per table, applying eq, in and is filters. */
function fakeDb(rows: Record<string, Row[]>, failing: string[] = []) {
  const deleted: Array<{ table: string; ids: unknown[] }> = [];
  const updated: Array<{ table: string; values: Row }> = [];
  const from = (table: string) => {
    let op: 'select' | 'delete' | 'update' = 'select';
    let values: Row = {};
    let ids: unknown[] = [];
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      contains: () => builder,
      in: (column: string, list: unknown[]) => {
        if (column === 'id') ids = list;
        filters.push((row) => list.includes(row[column]));
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      update: (next: Row) => {
        op = 'update';
        values = next;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (failing.includes(table)) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } }).then(resolve);
        if (op === 'delete') deleted.push({ table, ids });
        if (op === 'update') updated.push({ table, values });
        const data = op === 'select' ? (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))) : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { db: { from, storage: { from: () => ({ remove: vi.fn() }) } } as unknown as SupabaseClient, deleted, updated };
}

function item(
  id: string,
  status: string,
  fixtureIds: string[] = ['f1'],
  eventStart = '2026-11-07T14:10:00Z',
): { id: string; status: string; account_id: string; platform: string; placement: string; scheduled_for: string; prompt_context: Row } {
  return {
    id,
    status,
    account_id: 'account-1',
    platform: 'facebook',
    placement: 'feed',
    scheduled_for: '2026-11-04T11:40:00Z',
    prompt_context: { source: 'tournament', tournament_fixture_id: fixtureIds[0], roundup_fixture_ids: fixtureIds, eventStart },
  };
}

beforeEach(() => {
  vi.mocked(findContentCoveringFixture).mockReset();
});

describe('published statuses', () => {
  it('treats the live worker\'s posted and succeeded as published, as well as published', () => {
    for (const status of ['published', 'posted', 'succeeded']) {
      expect(isPublishedContentStatus(status)).toBe(true);
      expect(isPublishedJobStatus(status)).toBe(true);
    }
    for (const status of ['scheduled', 'queued', 'failed', 'publishing', null, undefined]) {
      expect(isPublishedContentStatus(status)).toBe(false);
      expect(isPublishedJobStatus(status)).toBe(false);
    }
  });
});

describe('deleteFixtureContentItems, keeping what has gone out', () => {
  it('keeps posts the live worker marked posted, or whose job succeeded, and deletes the rest', async () => {
    vi.mocked(findContentCoveringFixture)
      .mockResolvedValueOnce([item('posted-feed', 'posted'), item('job-succeeded', 'scheduled'), item('pending-story', 'scheduled')])
      .mockResolvedValue([item('posted-feed', 'posted')]);
    const { db, deleted } = fakeDb({
      publish_jobs: [
        { content_item_id: 'job-succeeded', account_id: 'account-1', status: 'succeeded' },
        { content_item_id: 'pending-story', account_id: 'account-1', status: 'queued' },
      ],
    });

    const count = await deleteFixtureContentItems(db, 'f1', 'account-1', true);

    expect(count).toBe(1);
    expect(deleted).toEqual([{ table: 'content_items', ids: ['pending-story'] }]);
  });

  it('keeps a post a worker is sending right now', async () => {
    vi.mocked(findContentCoveringFixture)
      .mockResolvedValueOnce([item('job-in-progress', 'scheduled'), item('v2-publishing', 'publishing'), item('pending-story', 'scheduled')])
      .mockResolvedValue([]);
    const { db, deleted } = fakeDb({
      publish_jobs: [
        { content_item_id: 'job-in-progress', account_id: 'account-1', status: 'in_progress' },
        { content_item_id: 'pending-story', account_id: 'account-1', status: 'queued' },
      ],
    });

    await deleteFixtureContentItems(db, 'f1', 'account-1', true);

    expect(deleted).toEqual([{ table: 'content_items', ids: ['pending-story'] }]);
  });

  it('deletes nothing when it cannot tell which posts have gone out', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([item('pending-story', 'scheduled')]);
    const { db, deleted } = fakeDb({}, ['publish_jobs']);

    await expect(deleteFixtureContentItems(db, 'f1', 'account-1', true)).rejects.toMatchObject({ message: 'publish_jobs unavailable' });
    expect(deleted).toEqual([]);
  });
});

describe('gamesLeftBehind', () => {
  const fixture = (id: string, kickOffAt: string): TournamentFixture => ({ id, kickOffAt } as TournamentFixture);
  const all = [
    fixture('moved', '2026-11-14T14:10:00Z'),
    fixture('old-day-a', '2026-11-07T14:10:00Z'),
    fixture('old-day-b', '2026-11-07T16:40:00Z'),
    fixture('new-day', '2026-11-14T16:40:00Z'),
    fixture('moved-too', '2026-11-21T14:10:00Z'),
  ];

  it('finds the day a moved game left, whose unpublished round-up still lists it', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([item('old-roundup', 'scheduled', ['old-day-a', 'moved', 'old-day-b'])]);
    const leads = await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all);
    expect(leads.map((lead) => lead.id)).toEqual(['old-day-a']);
  });

  it('leaves a published round-up and the game\'s own day alone', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([
      item('old-roundup', 'posted', ['old-day-a', 'moved']),
      item('new-roundup', 'scheduled', ['moved', 'new-day'], '2026-11-14T14:10:00Z'),
    ]);
    expect(await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all)).toEqual([]);
  });

  it('takes the departed day from the round-up, not from another game that has also moved', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([item('old-roundup', 'scheduled', ['moved', 'moved-too', 'old-day-a'])]);
    expect((await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all)).map((lead) => lead.id)).toEqual(['old-day-a']);

    // Every game it listed has left that day: nothing is left behind to rebuild.
    vi.mocked(findContentCoveringFixture).mockResolvedValue([item('old-roundup', 'scheduled', ['moved', 'moved-too'])]);
    expect(await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all)).toEqual([]);
  });
});

describe('clearStaleRoundups', () => {
  const fixture = (id: string, kickOffAt: string): TournamentFixture => ({ id, kickOffAt } as TournamentFixture);
  const tournament = { id: 't1', accountId: 'account-1' } as Tournament;
  const all = [
    fixture('moved', '2026-11-14T14:10:00Z'),
    fixture('moved-too', '2026-11-21T14:10:00Z'),
    fixture('old-day-a', '2026-11-07T14:10:00Z'),
    fixture('new-day', '2026-11-14T16:40:00Z'),
  ];

  beforeEach(() => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([]);
  });

  it('deletes a stale round-up once, up front, and returns a game still on its day', async () => {
    const { db, deleted } = fakeDb({
      content_items: [
        item('stale', 'scheduled', ['old-day-a', 'moved'], '2026-11-07T14:10:00Z'),
        item('fresh', 'scheduled', ['moved', 'new-day'], '2026-11-14T14:10:00Z'),
      ],
    });
    const leads = await clearStaleRoundups(db, tournament, all);
    expect(leads.map((lead) => lead.id)).toEqual(['old-day-a']);
    expect(deleted.filter((entry) => entry.table === 'content_items')).toEqual([{ table: 'content_items', ids: ['stale'] }]);
  });

  it('deletes a stale round-up even when every game it listed has moved away', async () => {
    const { db, deleted } = fakeDb({
      content_items: [item('stale', 'scheduled', ['moved', 'moved-too'], '2026-11-07T14:10:00Z')],
    });
    expect(await clearStaleRoundups(db, tournament, all)).toEqual([]);
    expect(deleted.filter((entry) => entry.table === 'content_items')).toEqual([{ table: 'content_items', ids: ['stale'] }]);
  });

  it('keeps a stale round-up that has gone out, and does not rebuild its day', async () => {
    const { db, deleted } = fakeDb({
      content_items: [item('sent', 'posted', ['old-day-a', 'moved'], '2026-11-07T14:10:00Z')],
    });
    expect(await clearStaleRoundups(db, tournament, all)).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
