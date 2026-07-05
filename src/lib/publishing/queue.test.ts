import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Platform } from '@/types/content';

const {
  mockDispatchToQStash,
  mockFrom,
  mockPublishJobsInsert,
  mockPublishJobsSchemaLimit,
  mockPublishJobsSingle,
  mockContentVariantsMaybeSingle,
} = vi.hoisted(() => {
  const mockDispatchToQStash = vi.fn();
  const mockPublishJobsSchemaLimit = vi.fn();
  const mockPublishJobsSingle = vi.fn();
  const mockPublishJobsInsertSelect = vi.fn(() => ({ single: mockPublishJobsSingle }));
  const mockPublishJobsInsert = vi.fn(() => ({ select: mockPublishJobsInsertSelect }));
  const mockContentVariantsMaybeSingle = vi.fn();
  const mockContentVariantsEq = vi.fn(() => ({ maybeSingle: mockContentVariantsMaybeSingle }));
  const mockContentVariantsSelect = vi.fn(() => ({ eq: mockContentVariantsEq }));
  const mockPublishJobsSelect = vi.fn((columns: string) => {
    if (columns === 'platform') return { limit: mockPublishJobsSchemaLimit };
    return { single: mockPublishJobsSingle };
  });
  const mockFrom = vi.fn((table: string) => {
    if (table === 'publish_jobs') {
      return {
        insert: mockPublishJobsInsert,
        select: mockPublishJobsSelect,
      };
    }
    if (table === 'content_variants') {
      return { select: mockContentVariantsSelect };
    }
    return {};
  });
  return {
    mockDispatchToQStash,
    mockFrom,
    mockPublishJobsInsert,
    mockPublishJobsSchemaLimit,
    mockPublishJobsSingle,
    mockContentVariantsMaybeSingle,
  };
});

vi.mock('./dispatch', () => ({
  dispatchToQStash: mockDispatchToQStash,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

const TEST_JOB_ID = 'test-job-id-abc123';

function baseOptions(overrides: { scheduledAt?: Date; variantId?: string | null; platform?: Platform } = {}): {
  contentItemId: string;
  accountId: string;
  platform: Platform;
  scheduledAt: Date;
  variantId?: string | null;
} {
  return {
    contentItemId: 'content-1',
    accountId: 'account-1',
    platform: overrides.platform ?? 'facebook',
    scheduledAt: overrides.scheduledAt ?? new Date(),
    variantId: Object.prototype.hasOwnProperty.call(overrides, 'variantId')
      ? overrides.variantId
      : 'variant-1',
  };
}

async function loadQueue() {
  vi.resetModules();
  return import('./queue');
}

describe('enqueueAndDispatch()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishJobsSchemaLimit.mockResolvedValue({ data: [], error: null });
    mockPublishJobsSingle.mockResolvedValue({ data: { id: TEST_JOB_ID }, error: null });
    mockContentVariantsMaybeSingle.mockResolvedValue({ data: { id: 'variant-from-db' }, error: null });
  });

  it('should dispatch to QStash when scheduledAt is now', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: new Date() }));

    expect(mockDispatchToQStash).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
    expect(result.jobId).toBe(TEST_JOB_ID);
  });

  it('should dispatch to QStash when scheduledAt is within threshold', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const thirtySecondsFromNow = new Date(Date.now() + 30_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: thirtySecondsFromNow }));

    expect(mockDispatchToQStash).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
  });

  it('should NOT dispatch when scheduledAt is in the future', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const fiveMinutesFromNow = new Date(Date.now() + 300_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: fiveMinutesFromNow }));

    expect(mockDispatchToQStash).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('should NOT dispatch when scheduledAt is just past threshold', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const sixtyOneSecondsFromNow = new Date(Date.now() + 61_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: sixtyOneSecondsFromNow }));

    expect(mockDispatchToQStash).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('should return jobId from enqueuePublishJob', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const result = await enqueueAndDispatch(baseOptions());

    expect(result.jobId).toBe(TEST_JOB_ID);
  });

  it('should propagate dispatchToQStash errors', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const dispatchError = new Error('QStash unavailable');
    mockDispatchToQStash.mockRejectedValueOnce(dispatchError);

    await expect(enqueueAndDispatch(baseOptions({ scheduledAt: new Date() }))).rejects.toThrow(
      'QStash unavailable',
    );
  });

  it('rejects unsupported GBP publishing before creating a job', async () => {
    const { enqueueAndDispatch } = await loadQueue();

    await expect(
      enqueueAndDispatch(baseOptions({ platform: 'gbp' as Platform })),
    ).rejects.toThrow('Unsupported publishing platform: gbp');

    expect(mockPublishJobsInsert).not.toHaveBeenCalled();
    expect(mockDispatchToQStash).not.toHaveBeenCalled();
  });

  it('should pass correct deduplication key to QStash', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const scheduledAt = new Date('2025-06-15T12:00:00.000Z');
    const opts = baseOptions({ scheduledAt });

    await enqueueAndDispatch(opts);

    expect(mockDispatchToQStash).toHaveBeenCalledWith({
      jobId: TEST_JOB_ID,
      deduplicationId: `content-1:facebook:${scheduledAt.toISOString()}`,
    });
  });

  it('uses legacy-bridge publish job columns when platform is not present', async () => {
    const { enqueueAndDispatch } = await loadQueue();
    const scheduledAt = new Date('2026-06-15T12:00:00.000Z');
    mockPublishJobsSchemaLimit.mockResolvedValueOnce({
      data: null,
      error: {
        code: '42703',
        message: 'column publish_jobs.platform does not exist',
      },
    });

    await enqueueAndDispatch(baseOptions({ scheduledAt, variantId: null }));

    expect(mockContentVariantsMaybeSingle).toHaveBeenCalledOnce();
    expect(mockPublishJobsInsert).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'account-1',
      content_item_id: 'content-1',
      idempotency_key: `content-1:facebook:${scheduledAt.toISOString()}`,
      scheduled_at: scheduledAt.toISOString(),
      next_attempt_at: scheduledAt.toISOString(),
      status: 'queued',
      placement: 'feed',
      variant_id: 'variant-from-db',
    }));
  });

  it('does NOT dispatch to QStash in legacy-bridge mode even for immediate jobs', async () => {
    // The QStash worker (handler.ts) cannot process legacy-bridge jobs; the
    // edge-function worker drains them instead, so dispatching would only burn
    // QStash retries.
    const { enqueueAndDispatch } = await loadQueue();
    mockPublishJobsSchemaLimit.mockResolvedValue({
      data: null,
      error: { code: '42703', message: 'column publish_jobs.platform does not exist' },
    });

    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: new Date(), variantId: null }));

    expect(mockDispatchToQStash).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.jobId).toBe(TEST_JOB_ID);
  });
});
