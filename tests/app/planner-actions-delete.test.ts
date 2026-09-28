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
      'in',
      'filter',
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

  it('archives a failed post by resolving jobs, trashing content, and dismissing alerts', async () => {
    const { supabase, calls } = createSupabaseMock([
      {
        data: {
          id: contentId,
          account_id: 'account-1',
          status: 'failed',
          deleted_at: null,
          prompt_context: null,
        },
        error: null,
      },
      { error: null },
      { error: null },
      { error: null },
      { error: null },
    ]);

    requireAuthContextMock.mockResolvedValue({
      accountId: 'account-1',
      supabase,
    });

    const { archivePlannerFailure } = await import('@/app/(app)/planner/actions');
    await archivePlannerFailure({ contentId });

    const contentUpdate = calls.find(
      (call) => call.table === 'content_items' && call.method === 'update',
    );
    const jobUpdate = calls.find(
      (call) => call.table === 'publish_jobs' && call.method === 'update',
    );
    const notificationUpdate = calls.find(
      (call) => call.table === 'notifications' && call.method === 'update',
    );

    expect(contentUpdate?.args[0]).toEqual(expect.objectContaining({
      deleted_at: expect.any(String),
      updated_at: expect.any(String),
    }));
    expect(jobUpdate?.args[0]).toEqual(expect.objectContaining({
      resolved_at: expect.any(String),
      resolution_kind: 'user_archived_failure',
      next_attempt_at: null,
    }));
    expect(notificationUpdate?.args[0]).toEqual(expect.objectContaining({
      read_at: expect.any(String),
      dismissed_at: expect.any(String),
    }));
    expect(calls).toContainEqual({
      table: 'publish_jobs',
      method: 'is',
      args: ['resolved_at', null],
    });
    expect(calls).toContainEqual({
      table: 'notifications',
      method: 'filter',
      args: ['metadata->>contentId', 'eq', contentId],
    });
  });
});

describe('deletePlannerContent from the post page (onlyIfUnpublished)', () => {
  const contentId = '44444444-4444-4444-8444-444444444444';
  const liveRow = (status: string) => ({
    id: contentId,
    account_id: 'account-1',
    status,
    scheduled_for: '2026-09-28T11:00:00.000Z',
    placement: 'feed',
    platform: 'facebook',
    deleted_at: null,
    prompt_context: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['publishing', 'posted'])('refuses a %s post and writes nothing', async (status) => {
    const { supabase, calls } = createSupabaseMock([{ data: liveRow(status), error: null }]);
    requireAuthContextMock.mockResolvedValue({ supabase, accountId: 'account-1' });
    const { deletePlannerContent } = await import('@/app/(app)/planner/actions');

    const result = await deletePlannerContent({ contentId, onlyIfUnpublished: true });

    expect(result).toEqual({ error: 'This post is being published or has already gone out, so it can no longer be cancelled.' });
    expect(calls.some((call) => ['update', 'delete', 'insert'].includes(call.method))).toBe(false);
  });

  it('refuses a scheduled post whose job the worker has already taken', async () => {
    const { supabase, calls } = createSupabaseMock([
      { data: liveRow('scheduled'), error: null },
      { data: [{ id: 'job-1' }], error: null },
    ]);
    requireAuthContextMock.mockResolvedValue({ supabase, accountId: 'account-1' });
    const { deletePlannerContent } = await import('@/app/(app)/planner/actions');

    const result = await deletePlannerContent({ contentId, onlyIfUnpublished: true });

    expect(result).toEqual({ error: 'This post is being sent right now, so it can no longer be cancelled.' });
    expect(calls).toContainEqual({ table: 'publish_jobs', method: 'in', args: ['status', ['in_progress', 'succeeded']] });
    expect(calls.some((call) => ['update', 'delete', 'insert'].includes(call.method))).toBe(false);
  });

  it('cancels a scheduled post with no job under way', async () => {
    const { supabase, calls } = createSupabaseMock([
      { data: liveRow('scheduled'), error: null },
      { data: [], error: null },
    ]);
    requireAuthContextMock.mockResolvedValue({ supabase, accountId: 'account-1' });
    const { deletePlannerContent } = await import('@/app/(app)/planner/actions');

    const result = await deletePlannerContent({ contentId, onlyIfUnpublished: true });

    expect(result).toMatchObject({ ok: true, contentId });
    expect(calls).toContainEqual({ table: 'content_items', method: 'update', args: [expect.objectContaining({ deleted_at: expect.any(String) })] });
  });

  it('keeps the old behaviour for other callers: no status check', async () => {
    const { supabase, calls } = createSupabaseMock([{ data: liveRow('posted'), error: null }]);
    requireAuthContextMock.mockResolvedValue({ supabase, accountId: 'account-1' });
    const { deletePlannerContent } = await import('@/app/(app)/planner/actions');

    const result = await deletePlannerContent({ contentId });

    expect(result).toMatchObject({ ok: true, contentId });
    expect(calls.some((call) => call.table === 'publish_jobs' && call.method === 'in')).toBe(false);
  });
});
