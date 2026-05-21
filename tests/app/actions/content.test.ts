import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import that triggers the modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn(),
}));

vi.mock('@/lib/publishing/queue', () => ({
  enqueueAndDispatch: vi.fn().mockResolvedValue({ jobId: 'job-1', dispatched: false }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { requireAuthContext } from '@/lib/auth/server';
import { enqueueAndDispatch } from '@/lib/publishing/queue';

// ---------------------------------------------------------------------------
// Chainable Supabase mock builder
//
// Each call to createChainMock() returns an object where every builder method
// returns `this`, and terminal methods (single, maybeSingle) return queued
// results. All method calls are tracked for assertion.
// ---------------------------------------------------------------------------

function createChainMock() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const terminalResults: Array<{ data?: unknown; error?: { message: string } | null }> = [];
  let terminalIdx = 0;

  function nextTerminal() {
    const result = terminalResults[terminalIdx] ?? { data: null, error: null };
    terminalIdx++;
    return result;
  }

  const chain: Record<string, unknown> = {};

  const builderMethods = ['from', 'select', 'insert', 'upsert', 'update', 'delete', 'eq', 'or', 'not', 'order', 'in', 'limit', 'gte', 'lte'];
  for (const method of builderMethods) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }

  // Terminal methods resolve from the queue
  chain.single = vi.fn(() => {
    calls.push({ method: 'single', args: [] });
    return Promise.resolve(nextTerminal());
  });
  chain.maybeSingle = vi.fn(() => {
    calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(nextTerminal());
  });

  // Also make the chain itself thenable for queries that end without single/maybeSingle
  // (e.g., .insert().select() that returns { data: [...], error: null })
  chain.then = undefined; // not thenable by default

  return {
    mock: chain,
    calls,
    enqueueResult(result: { data?: unknown; error?: { message: string } | null }) {
      terminalResults.push(result);
    },
    /** Make the next builder method that would normally chain instead resolve as terminal */
    reset() {
      calls.length = 0;
      terminalResults.length = 0;
      terminalIdx = 0;
    },
    /** Check if a specific .eq(col, val) was called */
    hasEqCall(col: string, val: string): boolean {
      return calls.some((c) => c.method === 'eq' && c.args[0] === col && c.args[1] === val);
    },
  };
}

// ---------------------------------------------------------------------------
// createScheduledBatch
// ---------------------------------------------------------------------------

describe('createScheduledBatch', () => {
  let supabaseMock: ReturnType<typeof createChainMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    supabaseMock = createChainMock();

    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: supabaseMock.mock as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' } as never,
    });
  });

  it('creates publish_jobs for every content item in schedule mode', async () => {
    // 1. Draft lookup (.from('content_items').select('id').eq(...).eq(...).single())
    supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
    // 2. Campaign insert (.from('campaigns').insert(...).select('id').single())
    supabaseMock.enqueueResult({ data: { id: 'camp-1' }, error: null });
    // 3. Content items insert (.from('content_items').insert(...).select('id, platform'))
    //    — This ends with .select() not .single(), so we need the select to act as terminal.
    //    Override select to return the data for this specific call.
    const originalSelect = supabaseMock.mock.select as ReturnType<typeof vi.fn>;
    let selectCallCount = 0;
    (supabaseMock.mock as Record<string, unknown>).select = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'select', args });
      selectCallCount++;
      // Call 1: draft .select('id') — chain continues to .eq().eq().single()
      // Call 2: campaign .select('id') — chain continues to .single()
      // Call 3: content_items .select('id, platform') — this IS the terminal
      if (selectCallCount === 3) {
        return {
          data: [
            { id: 'ci-1', platform: 'facebook' },
            { id: 'ci-2', platform: 'instagram' },
            { id: 'ci-3', platform: 'facebook' },
            { id: 'ci-4', platform: 'instagram' },
          ],
          error: null,
        };
      }
      return supabaseMock.mock; // chain continues
    });

    // 4. Variants upsert — chain ends at .upsert() which should resolve
    const originalUpsert = supabaseMock.mock.upsert;
    let upsertCallCount = 0;
    (supabaseMock.mock as Record<string, unknown>).upsert = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'upsert', args });
      upsertCallCount++;
      if (upsertCallCount === 1) {
        // Variant upsert — return success directly
        return Promise.resolve({ error: null });
      }
      return supabaseMock.mock; // chain continues
    });

    // 5. Draft delete — chain .delete().eq().eq().eq() should resolve
    const originalDelete = supabaseMock.mock.delete;
    let deleteEqCount = 0;
    // Override eq to track and eventually resolve the delete chain
    const originalEq = supabaseMock.mock.eq;
    let eqAfterDeleteCount = 0;
    let inDeleteChain = false;
    (supabaseMock.mock as Record<string, unknown>).delete = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'delete', args });
      inDeleteChain = true;
      eqAfterDeleteCount = 0;
      return supabaseMock.mock;
    });

    const { createScheduledBatch } = await import('@/app/actions/content');

    const result = await createScheduledBatch({
      draftContentId: 'draft-1',
      contentType: 'event',
      brief: { title: 'Test Event', eventDate: '2026-06-15', eventTime: '19:00' },
      selectedMediaIds: [],
      slotCopies: [
        {
          slotKey: 'slot-1',
          scheduledAt: '2026-06-14T10:00:00.000Z',
          label: '1 day to go',
          copy: {
            facebook: { body: 'FB1' },
            instagram: { body: 'IG1' },
            gbp: { body: 'GBP1' },
          },
        },
        {
          slotKey: 'slot-2',
          scheduledAt: '2026-06-15T10:00:00.000Z',
          label: 'Event day',
          copy: {
            facebook: { body: 'FB2' },
            instagram: { body: 'IG2' },
            gbp: { body: 'GBP2' },
          },
        },
      ],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // 2 slots x 2 platforms = 4 content items = 4 enqueue calls
    expect(enqueueAndDispatch).toHaveBeenCalledTimes(4);
    expect(enqueueAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        platform: 'facebook',
      }),
    );
  });

  it('rolls back all created rows when enqueue fails mid-batch', async () => {
    // 1. Draft lookup
    supabaseMock.enqueueResult({ data: { id: 'draft-1' }, error: null });
    // 2. Campaign insert
    supabaseMock.enqueueResult({ data: { id: 'camp-1' }, error: null });

    // Override select for content_items insert result
    let selectCallCount = 0;
    (supabaseMock.mock as Record<string, unknown>).select = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'select', args });
      selectCallCount++;
      if (selectCallCount === 3) {
        return {
          data: [
            { id: 'ci-1', platform: 'facebook' },
            { id: 'ci-2', platform: 'instagram' },
          ],
          error: null,
        };
      }
      return supabaseMock.mock;
    });

    // Variant upsert
    let upsertCallCount = 0;
    (supabaseMock.mock as Record<string, unknown>).upsert = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'upsert', args });
      upsertCallCount++;
      if (upsertCallCount === 1) {
        return Promise.resolve({ error: null });
      }
      return supabaseMock.mock;
    });

    // Delete and .in() for rollback — make them resolve
    (supabaseMock.mock as Record<string, unknown>).delete = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'delete', args });
      return supabaseMock.mock;
    });
    (supabaseMock.mock as Record<string, unknown>).in = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'in', args });
      return Promise.resolve({ error: null });
    });

    // Make the second enqueue call fail
    vi.mocked(enqueueAndDispatch)
      .mockResolvedValueOnce({ jobId: 'job-1', dispatched: false })
      .mockRejectedValueOnce(new Error('QStash timeout'));

    const { createScheduledBatch } = await import('@/app/actions/content');

    const result = await createScheduledBatch({
      draftContentId: 'draft-1',
      contentType: 'event',
      brief: { title: 'Test Event', eventDate: '2026-06-15', eventTime: '19:00' },
      selectedMediaIds: [],
      slotCopies: [
        {
          slotKey: 'slot-1',
          scheduledAt: '2026-06-14T10:00:00.000Z',
          copy: {
            facebook: { body: 'FB1' },
            instagram: { body: 'IG1' },
            gbp: { body: 'GBP1' },
          },
        },
      ],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
    });

    // Must return a hard error with no contentItemIds
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Publish job creation failed');
    expect(result.contentItemIds).toBeUndefined();
    expect(result.success).toBeUndefined();

    // Verify rollback was attempted — delete calls should be present
    const deleteCalls = supabaseMock.calls.filter((c) => c.method === 'delete');
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getCalendarItemsAction — account scoping (A3)
// ---------------------------------------------------------------------------

describe('getCalendarItemsAction', () => {
  let supabaseMock: ReturnType<typeof createChainMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    supabaseMock = createChainMock();

    // Override order to return terminal result (list query doesn't use single())
    (supabaseMock.mock as Record<string, unknown>).order = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'order', args });
      return Promise.resolve({ data: [], error: null });
    });

    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: supabaseMock.mock as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' } as never,
    });
  });

  it('filters by account_id to prevent cross-account leakage', async () => {
    const { getCalendarItemsAction } = await import('@/app/actions/content');
    await getCalendarItemsAction('2026-06-01', '2026-06-30');

    expect(supabaseMock.hasEqCall('account_id', 'acc-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDraft — account scoping (B2)
// ---------------------------------------------------------------------------

describe('getDraft', () => {
  let supabaseMock: ReturnType<typeof createChainMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    supabaseMock = createChainMock();
    supabaseMock.enqueueResult({
      data: {
        id: 'ci-1',
        account_id: 'acc-1',
        content_type: 'event',
        status: 'draft',
        title: 'Test',
        body_draft: null,
        campaign_name: null,
        scheduled_at: null,
        event_date: null,
        event_end_date: null,
        coupon_code: null,
        recurring_day_of_week: null,
        auto_confirm: false,
        ai_generation_params: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: supabaseMock.mock as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' } as never,
    });
  });

  it('includes account_id filter in query', async () => {
    const { getDraft } = await import('@/app/actions/content');
    await getDraft('ci-1');

    expect(supabaseMock.hasEqCall('account_id', 'acc-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listDrafts — account scoping (B2)
// ---------------------------------------------------------------------------

describe('listDrafts', () => {
  let supabaseMock: ReturnType<typeof createChainMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    supabaseMock = createChainMock();

    // Override order + limit to return terminal result for list query
    (supabaseMock.mock as Record<string, unknown>).order = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'order', args });
      return supabaseMock.mock;
    });
    (supabaseMock.mock as Record<string, unknown>).limit = vi.fn((...args: unknown[]) => {
      supabaseMock.calls.push({ method: 'limit', args });
      return Promise.resolve({ data: [], error: null });
    });

    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: supabaseMock.mock as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' } as never,
    });
  });

  it('includes account_id filter in query', async () => {
    const { listDrafts } = await import('@/app/actions/content');
    await listDrafts();

    expect(supabaseMock.hasEqCall('account_id', 'acc-1')).toBe(true);
  });
});
