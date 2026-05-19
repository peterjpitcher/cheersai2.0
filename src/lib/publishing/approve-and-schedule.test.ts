/**
 * Tests for approve-and-schedule flow (04-02 Task 1).
 * Verifies preflight gating, state transitions, job creation, and QStash dispatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing the module under test
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/publishing/preflight', () => ({
  getPublishReadinessIssues: vi.fn(),
}));

vi.mock('@/lib/publishing/queue', () => ({
  enqueuePublishJob: vi.fn(),
}));

vi.mock('@/lib/publishing/dispatch', () => ({
  dispatchToQStash: vi.fn(),
}));

vi.mock('@/lib/publishing/state-machine', () => ({
  transitionStatus: vi.fn(),
}));

vi.mock('@/lib/publishing/audit', () => ({
  logPublishAuditEvent: vi.fn(),
}));

import { approveAndSchedule } from './approve-and-schedule';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { logPublishAuditEvent } from '@/lib/publishing/audit';

const mockFrom = vi.fn();
const mockDb = { from: mockFrom } as unknown as ReturnType<typeof createServiceSupabaseClient>;

function setupSelectChain(data: unknown, error: unknown = null) {
  return mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockDb);
  mockFrom.mockReset();
});

const baseParams = {
  contentItemId: 'ci-1',
  accountId: 'acc-1',
  platforms: ['facebook' as const],
  scheduledAt: null,
  placement: 'feed' as const,
};

describe('approveAndSchedule', () => {
  it('returns { success: false, issues } when preflight finds issues', async () => {
    const issues = [{ code: 'connection_missing', message: 'Connect Facebook' }];
    vi.mocked(getPublishReadinessIssues).mockResolvedValue(issues);

    const result = await approveAndSchedule(baseParams);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(issues);
    expect(enqueuePublishJob).not.toHaveBeenCalled();
  });

  it('transitions content to approved then scheduled for future dates', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' }); // load current status
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    const futureDate = new Date(Date.now() + 3600_000); // 1 hour from now
    const result = await approveAndSchedule({
      ...baseParams,
      scheduledAt: futureDate,
    });

    expect(result.success).toBe(true);
    // Should transition review -> approved
    expect(transitionStatus).toHaveBeenCalledWith(
      mockDb, 'content_items', 'ci-1', 'review', 'approved',
    );
    // Should transition approved -> scheduled (not queued) for future
    expect(transitionStatus).toHaveBeenCalledWith(
      mockDb, 'content_items', 'ci-1', 'approved', 'scheduled',
    );
  });

  it('transitions content to approved then queued for immediate dates (null)', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    const result = await approveAndSchedule(baseParams);

    expect(result.success).toBe(true);
    expect(transitionStatus).toHaveBeenCalledWith(
      mockDb, 'content_items', 'ci-1', 'review', 'approved',
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      mockDb, 'content_items', 'ci-1', 'approved', 'queued',
    );
  });

  it('calls enqueuePublishJob with correct platform and scheduledAt', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    await approveAndSchedule(baseParams);

    expect(enqueuePublishJob).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: 'ci-1',
        accountId: 'acc-1',
        platform: 'facebook',
      }),
    );
  });

  it('calls dispatchToQStash immediately when scheduledAt is null', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    await approveAndSchedule(baseParams);

    expect(dispatchToQStash).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
      }),
    );
  });

  it('does NOT call dispatchToQStash when scheduledAt is in the future', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    const futureDate = new Date(Date.now() + 3600_000);
    await approveAndSchedule({ ...baseParams, scheduledAt: futureDate });

    expect(dispatchToQStash).not.toHaveBeenCalled();
  });

  it('creates one publish_job per target platform', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');

    const result = await approveAndSchedule({
      ...baseParams,
      platforms: ['facebook', 'instagram'],
    });

    expect(enqueuePublishJob).toHaveBeenCalledTimes(2);
    expect(result.jobIds).toEqual(['job-1', 'job-2']);
  });

  it('logs audit event for state_transition', async () => {
    vi.mocked(getPublishReadinessIssues).mockResolvedValue([]);
    setupSelectChain({ status: 'review' });
    vi.mocked(enqueuePublishJob).mockResolvedValue('job-1');

    await approveAndSchedule(baseParams);

    expect(logPublishAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        operationType: 'state_transition',
        resourceType: 'content_item',
        resourceId: 'ci-1',
      }),
    );
  });
});
