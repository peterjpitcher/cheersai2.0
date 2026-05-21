/**
 * Tests for the publish-scheduler cron route.
 * Covers auth, happy path, dispatch failure recovery, and per-job isolation.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/publishing/state-machine', () => ({
  transitionStatus: vi.fn(),
}));

vi.mock('@/lib/publishing/dispatch', () => ({
  dispatchToQStash: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { GET } from './route';

// --- Types ---

interface ScheduledJobRow {
  id: string;
  content_item_id: string;
  idempotency_key: string;
}

// --- Helpers ---

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request('http://localhost/api/cron/publish-scheduler', {
    method,
    headers: new Headers(headers),
  });
}

function createMockDb(jobs: ScheduledJobRow[]) {
  const mockReturns = vi.fn().mockResolvedValue({ data: jobs, error: null });
  const mockLte = vi.fn(() => ({ returns: mockReturns }));
  const mockEqStatus = vi.fn(() => ({ lte: mockLte }));
  const mockSchemaLimit = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockSelectQuery = vi.fn((columns: string) => {
    if (columns === 'platform') {
      return { limit: mockSchemaLimit };
    }
    return { eq: mockEqStatus };
  });

  // For revert updates — track calls per table
  const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockFunctionsInvoke = vi.fn().mockResolvedValue({
    data: { ok: true, processed: 0 },
    error: null,
  });

  const mockFrom = vi.fn(() => ({
    select: mockSelectQuery,
    update: mockUpdate,
  }));

  return {
    from: mockFrom,
    functions: { invoke: mockFunctionsInvoke },
    mockSchemaLimit,
    mockUpdate,
    mockUpdateEq,
    mockFunctionsInvoke,
  };
}

function setupDb(jobs: ScheduledJobRow[]) {
  const mockDb = createMockDb(jobs);
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockDb as never);
  return mockDb;
}

// --- Tests ---

describe('publish-scheduler cron route', () => {
  describe('authentication', () => {
    it('should return 401 when no secret is provided', async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
    });

    it('should return 401 when wrong secret is provided', async () => {
      const res = await GET(makeRequest({ 'x-cron-secret': 'wrong-secret' }));
      expect(res.status).toBe(401);
    });

    it('should accept x-cron-secret header', async () => {
      setupDb([]);
      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(200);
    });

    it('should accept Authorization Bearer header', async () => {
      setupDb([]);
      const res = await GET(makeRequest({ Authorization: 'Bearer test-secret' }));
      expect(res.status).toBe(200);
    });
  });

  describe('no jobs', () => {
    it('should return promoted 0 when no jobs are due', async () => {
      setupDb([]);
      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();
      expect(body).toEqual({ promoted: 0 });
    });

    it('delegates to the legacy publish-queue function when publish_jobs has no platform column', async () => {
      const mockDb = setupDb([]);
      mockDb.mockSchemaLimit.mockResolvedValueOnce({
        data: null,
        error: {
          code: '42703',
          message: 'column publish_jobs.platform does not exist',
        },
      });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(body).toEqual({ legacyBridge: true, ok: true, processed: 0 });
      expect(mockDb.mockFunctionsInvoke).toHaveBeenCalledWith('publish-queue', {
        body: {
          leadWindowMinutes: 5,
          source: 'vercel-publish-scheduler',
        },
      });
    });
  });

  describe('happy path', () => {
    it('should promote due jobs and dispatch to QStash', async () => {
      const jobs: ScheduledJobRow[] = [
        { id: 'job-1', content_item_id: 'ci-1', idempotency_key: 'key-1' },
        { id: 'job-2', content_item_id: 'ci-2', idempotency_key: 'key-2' },
      ];
      setupDb(jobs);
      vi.mocked(transitionStatus).mockResolvedValue(undefined);
      vi.mocked(dispatchToQStash).mockResolvedValue(undefined);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(body).toEqual({ promoted: 2 });
      // 2 jobs x 2 tables = 4 transition calls
      expect(transitionStatus).toHaveBeenCalledTimes(4);
      expect(dispatchToQStash).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispatch failure recovery', () => {
    it('should revert status to scheduled when QStash dispatch fails', async () => {
      const jobs: ScheduledJobRow[] = [
        { id: 'job-1', content_item_id: 'ci-1', idempotency_key: 'key-1' },
      ];
      const mockDb = setupDb(jobs);
      vi.mocked(transitionStatus).mockResolvedValue(undefined);
      vi.mocked(dispatchToQStash).mockRejectedValue(new Error('QStash unavailable'));

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(body).toEqual({ promoted: 0 });

      // Verify revert updates were called for both tables
      expect(mockDb.mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockDb.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'scheduled' }),
      );
      expect(mockDb.mockUpdateEq).toHaveBeenCalledWith('id', 'job-1');
      expect(mockDb.mockUpdateEq).toHaveBeenCalledWith('id', 'ci-1');
    });

    it('should continue to next job when dispatch fails for one', async () => {
      const jobs: ScheduledJobRow[] = [
        { id: 'job-1', content_item_id: 'ci-1', idempotency_key: 'key-1' },
        { id: 'job-2', content_item_id: 'ci-2', idempotency_key: 'key-2' },
      ];
      setupDb(jobs);
      vi.mocked(transitionStatus).mockResolvedValue(undefined);
      vi.mocked(dispatchToQStash)
        .mockRejectedValueOnce(new Error('QStash unavailable'))
        .mockResolvedValueOnce(undefined);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(body).toEqual({ promoted: 1 });
    });
  });

  describe('transition failure isolation', () => {
    it('should skip failed job and continue to next when transition fails', async () => {
      const jobs: ScheduledJobRow[] = [
        { id: 'job-1', content_item_id: 'ci-1', idempotency_key: 'key-1' },
        { id: 'job-2', content_item_id: 'ci-2', idempotency_key: 'key-2' },
      ];
      setupDb(jobs);
      vi.mocked(transitionStatus)
        .mockRejectedValueOnce(new Error('Concurrent modification'))
        .mockResolvedValue(undefined);
      vi.mocked(dispatchToQStash).mockResolvedValue(undefined);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      // First job fails at transition, second succeeds fully
      expect(body).toEqual({ promoted: 1 });
    });
  });
});
