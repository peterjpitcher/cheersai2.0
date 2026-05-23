import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuthContextMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/publishing/queue', () => ({
  enqueueAndDispatch: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
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

    for (const method of [
      'select',
      'update',
      'delete',
      'insert',
      'eq',
      'contains',
      'is',
      'not',
      'limit',
      'returns',
    ]) {
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

describe('planner delete/restore tournament sync', () => {
  const contentId = '11111111-1111-4111-8111-111111111111';
  const fixtureId = '22222222-2222-4222-8222-222222222222';
  const tournamentId = '33333333-3333-4333-8333-333333333333';
  const promptContext = {
    source: 'tournament',
    tournament_fixture_id: fixtureId,
    tournament_id: tournamentId,
  };

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
  });

  it('marks a tournament fixture ungenerated when its last active planner post is trashed', async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: 'account-1',
          status: 'scheduled',
          scheduled_for: '2026-06-11T19:00:00.000Z',
          placement: 'feed',
          platform: 'facebook',
          deleted_at: null,
          prompt_context: promptContext,
        },
        error: null,
      },
      { error: null },
      { error: null },
      { data: [], error: null },
      { error: null },
      { error: null },
    ]);

    requireAuthContextMock.mockResolvedValue({
      accountId: 'account-1',
      supabase,
    });

    const { deletePlannerContent } = await import('@/app/(app)/planner/actions');
    await deletePlannerContent({ contentId });

    const fixtureUpdate = calls.find(
      (call) => call.table === 'tournament_fixtures' && call.method === 'update',
    );

    expect(fixtureUpdate?.args[0]).toEqual(expect.objectContaining({
      content_generated: false,
      updated_at: expect.any(String),
    }));
    expect(calls).toContainEqual({
      table: 'content_items',
      method: 'is',
      args: ['deleted_at', null],
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/tournaments/${tournamentId}`);
  });

  it('marks a tournament fixture generated again when a trashed tournament post is restored', async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: 'account-1',
          status: 'draft',
          scheduled_for: '2026-06-11T19:00:00.000Z',
          placement: 'feed',
          platform: 'facebook',
          deleted_at: '2026-05-23T17:00:00.000Z',
          prompt_context: promptContext,
        },
        error: null,
      },
      { error: null },
      { data: [{ id: contentId }], error: null },
      { error: null },
      { error: null },
    ]);

    requireAuthContextMock.mockResolvedValue({
      accountId: 'account-1',
      supabase,
    });

    const { restorePlannerContent } = await import('@/app/(app)/planner/actions');
    await restorePlannerContent({ contentId });

    const fixtureUpdate = calls.find(
      (call) => call.table === 'tournament_fixtures' && call.method === 'update',
    );

    expect(fixtureUpdate?.args[0]).toEqual(expect.objectContaining({
      content_generated: true,
      updated_at: expect.any(String),
    }));
    expect(revalidatePathMock).toHaveBeenCalledWith(`/tournaments/${tournamentId}`);
  });
});
