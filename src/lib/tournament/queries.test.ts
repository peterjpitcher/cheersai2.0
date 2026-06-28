import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { deriveFixtureContentStatuses, getPublishedPlacements } from './queries';
import type { TournamentFixture } from '@/types/tournament';

function createBuilder(
  result: unknown,
  calls: Array<{ method: string; column: string; value: unknown }>,
) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn((column: string, value: unknown) => {
      calls.push({ method: 'eq', column, value });
      return builder;
    }),
    in: vi.fn((column: string, value: unknown) => {
      calls.push({ method: 'in', column, value });
      return builder;
    }),
    is: vi.fn((column: string, value: unknown) => {
      calls.push({ method: 'is', column, value });
      return builder;
    }),
    contains: vi.fn(chain),
    limit: vi.fn(chain),
    then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
  });
  return builder;
}

describe('getPublishedPlacements', () => {
  it('treats published content items and completed jobs as published placements', async () => {
    const calls: Array<{ method: string; column: string; value: unknown }> = [];
    const from = vi.fn((table: string) => {
      if (table === 'content_items') {
        return createBuilder({
          data: [
            { id: 'item-1', platform: 'facebook', placement: 'feed', status: 'posted' },
            { id: 'item-2', platform: 'instagram', placement: 'story', status: 'scheduled' },
          ],
          error: null,
        }, calls);
      }

      return createBuilder({ data: [{ status: 'succeeded' }], error: null }, calls);
    });

    const placements = await getPublishedPlacements({ from } as unknown as SupabaseClient, 'fixture-1', 'acct-1');

    expect(placements).toEqual(new Set(['facebook:feed', 'instagram:story']));
    expect(from).toHaveBeenCalledWith('publish_jobs');
    expect(calls).toContainEqual({ method: 'is', column: 'deleted_at', value: null });
    expect(calls).toContainEqual({ method: 'in', column: 'status', value: ['published', 'succeeded'] });
  });
});

describe('deriveFixtureContentStatuses', () => {
  it('ignores trashed tournament content when deriving fixture status', async () => {
    const calls: Array<{ method: string; column: string; value: unknown }> = [];
    const from = vi.fn(() => createBuilder({ data: [], error: null }, calls));

    const fixture = {
      id: 'fixture-1',
      contentGenerated: true,
      showing: true,
      teamsConfirmed: true,
    } as TournamentFixture;

    const statuses = await deriveFixtureContentStatuses(
      { from } as unknown as SupabaseClient,
      [fixture],
      'acct-1',
    );

    expect(statuses.get('fixture-1')).toBe('ready');
    expect(calls).toContainEqual({ method: 'is', column: 'deleted_at', value: null });
  });

  it('treats legacy posted content as published', async () => {
    const calls: Array<{ method: string; column: string; value: unknown }> = [];
    const from = vi.fn(() => createBuilder({
      data: [
        {
          id: 'content-1',
          status: 'posted',
          scheduled_for: '2026-06-27T19:00:00+00:00',
          prompt_context: {
            source: 'tournament',
            tournament_fixture_id: 'fixture-1',
          },
        },
        {
          id: 'content-2',
          status: 'succeeded',
          scheduled_for: '2026-06-27T19:00:00+00:00',
          prompt_context: {
            source: 'tournament',
            tournament_fixture_id: 'fixture-1',
          },
        },
      ],
      error: null,
    }, calls));

    const fixture = {
      id: 'fixture-1',
      contentGenerated: true,
      showing: true,
      teamsConfirmed: true,
    } as TournamentFixture;

    const statuses = await deriveFixtureContentStatuses(
      { from } as unknown as SupabaseClient,
      [fixture],
      'acct-1',
    );

    expect(statuses.get('fixture-1')).toBe('published');
  });
});
