import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockDispatchToQStash,
  mockSingle,
  // mockSelect and mockInsert are used internally by the chain but not referenced directly in tests
  mockFrom,
} = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  const mockInsert = vi.fn(() => ({ select: mockSelect }));
  const mockFrom = vi.fn(() => ({ insert: mockInsert }));
  const mockDispatchToQStash = vi.fn();
  return { mockDispatchToQStash, mockSingle, mockSelect, mockInsert, mockFrom };
});

vi.mock('./dispatch', () => ({
  dispatchToQStash: mockDispatchToQStash,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { enqueueAndDispatch } from './queue';
import type { Platform } from '@/types/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_JOB_ID = 'test-job-id-abc123';

function baseOptions(overrides: { scheduledAt?: Date } = {}): {
  contentItemId: string;
  accountId: string;
  platform: Platform;
  scheduledAt: Date;
} {
  return {
    contentItemId: 'content-1',
    accountId: 'account-1',
    platform: 'facebook',
    scheduledAt: overrides.scheduledAt ?? new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueueAndDispatch()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { id: TEST_JOB_ID }, error: null });
  });

  it('should dispatch to QStash when scheduledAt is now', async () => {
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: new Date() }));

    expect(mockDispatchToQStash).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
    expect(result.jobId).toBe(TEST_JOB_ID);
  });

  it('should dispatch to QStash when scheduledAt is within threshold', async () => {
    const thirtySecondsFromNow = new Date(Date.now() + 30_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: thirtySecondsFromNow }));

    expect(mockDispatchToQStash).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
  });

  it('should NOT dispatch when scheduledAt is in the future', async () => {
    const fiveMinutesFromNow = new Date(Date.now() + 300_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: fiveMinutesFromNow }));

    expect(mockDispatchToQStash).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('should NOT dispatch when scheduledAt is just past threshold', async () => {
    const sixtyOneSecondsFromNow = new Date(Date.now() + 61_000);
    const result = await enqueueAndDispatch(baseOptions({ scheduledAt: sixtyOneSecondsFromNow }));

    expect(mockDispatchToQStash).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('should return jobId from enqueuePublishJob', async () => {
    const result = await enqueueAndDispatch(baseOptions());

    expect(result.jobId).toBe(TEST_JOB_ID);
  });

  it('should propagate dispatchToQStash errors', async () => {
    const dispatchError = new Error('QStash unavailable');
    mockDispatchToQStash.mockRejectedValueOnce(dispatchError);

    await expect(enqueueAndDispatch(baseOptions({ scheduledAt: new Date() }))).rejects.toThrow(
      'QStash unavailable',
    );
  });

  it('should pass correct deduplication key to QStash', async () => {
    const scheduledAt = new Date('2025-06-15T12:00:00.000Z');
    const opts = baseOptions({ scheduledAt });

    await enqueueAndDispatch(opts);

    expect(mockDispatchToQStash).toHaveBeenCalledWith({
      jobId: TEST_JOB_ID,
      deduplicationId: `content-1:facebook:${scheduledAt.toISOString()}`,
    });
  });
});
