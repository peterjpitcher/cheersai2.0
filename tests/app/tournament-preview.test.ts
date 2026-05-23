import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuthContextMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/publishing/queue', () => ({
  enqueueAndDispatch: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

type QueryResult = { data?: unknown; error?: unknown };

function createSupabaseMock(results: QueryResult[]) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let resultIndex = 0;

  function nextResult(): QueryResult {
    const result = results[resultIndex] ?? { data: null, error: null };
    resultIndex += 1;
    return result;
  }

  function createBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {};

    for (const method of ['select', 'eq', 'is', 'contains', 'in']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }

    builder.maybeSingle = vi.fn(() => {
      calls.push({ table, method: 'maybeSingle', args: [] });
      return Promise.resolve(nextResult());
    });

    builder.then = vi.fn((resolve, reject) => Promise.resolve(nextResult()).then(resolve, reject));

    return builder;
  }

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ table, method: 'from', args: [table] });
      return createBuilder(table);
    }),
  };

  return { supabase, calls };
}

describe('getFixturePreview', () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
  });

  it('loads preview captions from content variants instead of a removed content_items column', async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: 'tournament-1',
          account_id: 'account-1',
          name: 'World Cup',
          slug: 'world-cup',
          status: 'active',
          base_image_square_id: null,
          base_image_story_id: null,
          house_rules_text: null,
          post_template: '{team_a} vs {team_b}',
          platforms: ['facebook'],
          post_lead_hours: 24,
          feed_api_key: null,
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-05-01T10:00:00.000Z',
        },
        error: null,
      },
      {
        data: [
          {
            id: 'content-1',
            platform: 'facebook',
            placement: 'feed',
            status: 'draft',
            scheduled_for: '2026-06-10T19:00:00.000Z',
            prompt_context: {
              source: 'tournament',
              tournament_fixture_id: 'fixture-1',
            },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            content_item_id: 'content-1',
            body: 'Canada vs Bosnia & Herzegovina preview copy',
            media_ids: [],
          },
        ],
        error: null,
      },
    ]);

    requireAuthContextMock.mockResolvedValue({
      accountId: 'account-1',
      supabase,
    });

    const { getFixturePreview } = await import('@/app/actions/tournament');
    const result = await getFixturePreview('tournament-1', 'fixture-1');

    expect(result.success).toBe(true);
    expect(result.items?.[0]?.captionText).toBe('Canada vs Bosnia & Herzegovina preview copy');

    const contentSelect = calls.find(
      (call) => call.table === 'content_items' && call.method === 'select',
    );
    expect(contentSelect?.args[0]).not.toContain('caption_text');
    expect(calls).toContainEqual({
      table: 'content_items',
      method: 'is',
      args: ['deleted_at', null],
    });

    const variantSelect = calls.find(
      (call) => call.table === 'content_variants' && call.method === 'select',
    );
    expect(variantSelect?.args[0]).toContain('body');
  });
});
