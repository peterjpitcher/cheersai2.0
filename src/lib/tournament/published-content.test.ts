import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteFixtureContentItems, gamesLeftBehind } from './generate';
import { isPublishedContentStatus, isPublishedJobStatus } from './published-status';
import { findContentCoveringFixture } from '@/lib/tournament/content-freshness';
import type { TournamentFixture } from '@/types/tournament';

vi.mock('./queries', () => ({ getPublishedPlacements: vi.fn(), getFixturesByTournament: vi.fn().mockResolvedValue([]) }));
vi.mock('./screening-service', () => ({ projectTournamentFixtures: vi.fn() }));
vi.mock('./overlay', () => ({ compositeOverlay: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/tournament/content-freshness', () => ({ findContentCoveringFixture: vi.fn() }));

type Row = Record<string, unknown>;

/** Records deletes and updates; answers selects from fixed rows per table. */
function fakeDb(rows: Record<string, Row[]>, failing: string[] = []) {
  const deleted: Array<{ table: string; ids: unknown[] }> = [];
  const updated: Array<{ table: string; values: Row }> = [];
  const from = (table: string) => {
    let op: 'select' | 'delete' | 'update' = 'select';
    let values: Row = {};
    let ids: unknown[] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (_column: string, list: unknown[]) => {
        ids = list;
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
        return Promise.resolve({ data: op === 'select' ? rows[table] ?? [] : null, error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { db: { from, storage: { from: () => ({ remove: vi.fn() }) } } as unknown as SupabaseClient, deleted, updated };
}

function item(id: string, status: string, fixtureIds: string[] = ['f1']): { id: string; status: string; platform: string; placement: string; scheduled_for: string; prompt_context: Row } {
  return {
    id,
    status,
    platform: 'facebook',
    placement: 'feed',
    scheduled_for: '2026-11-07T11:00:00Z',
    prompt_context: { source: 'tournament', tournament_fixture_id: fixtureIds[0], roundup_fixture_ids: fixtureIds },
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
    const { db, deleted } = fakeDb({ publish_jobs: [{ content_item_id: 'job-succeeded' }] });

    const count = await deleteFixtureContentItems(db, 'f1', 'account-1', true);

    expect(count).toBe(1);
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
  ];

  it('finds the day a moved game left, whose unpublished round-up still lists it', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([item('old-roundup', 'scheduled', ['old-day-a', 'moved', 'old-day-b'])]);
    const leads = await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all);
    expect(leads.map((lead) => lead.id)).toEqual(['old-day-a']);
  });

  it('leaves a published round-up and the game\'s own day alone', async () => {
    vi.mocked(findContentCoveringFixture).mockResolvedValue([
      item('old-roundup', 'posted', ['old-day-a', 'moved']),
      item('new-roundup', 'scheduled', ['moved', 'new-day']),
    ]);
    expect(await gamesLeftBehind({} as SupabaseClient, 'account-1', all[0], all)).toEqual([]);
  });
});
