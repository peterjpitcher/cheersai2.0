import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getPublishedPlacements } from './queries';

function createBuilder(result: unknown, eqCalls: Array<{ column: string; value: unknown }>) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return builder;
    }),
    contains: vi.fn(chain),
    limit: vi.fn(chain),
    then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
  });
  return builder;
}

describe('getPublishedPlacements', () => {
  it('treats published content items and published jobs as published placements', async () => {
    const eqCalls: Array<{ column: string; value: unknown }> = [];
    const from = vi.fn((table: string) => {
      if (table === 'content_items') {
        return createBuilder({
          data: [
            { id: 'item-1', platform: 'facebook', placement: 'feed', status: 'published' },
            { id: 'item-2', platform: 'instagram', placement: 'story', status: 'scheduled' },
          ],
          error: null,
        }, eqCalls);
      }

      return createBuilder({ data: [{ status: 'published' }], error: null }, eqCalls);
    });

    const placements = await getPublishedPlacements({ from } as unknown as SupabaseClient, 'fixture-1', 'acct-1');

    expect(placements).toEqual(new Set(['facebook:feed', 'instagram:story']));
    expect(from).toHaveBeenCalledWith('publish_jobs');
    expect(eqCalls).toContainEqual({ column: 'status', value: 'published' });
    expect(eqCalls).not.toContainEqual({ column: 'status', value: 'succeeded' });
  });
});
