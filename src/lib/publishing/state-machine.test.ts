import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canTransition, transitionStatus, VALID_TRANSITIONS } from './state-machine';
import type { ContentStatus } from '@/types/content';

/** Build a chainable Supabase mock matching .from().update().eq().eq().select().maybeSingle() */
function createMockDb() {
  const mockMaybeSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockEqStatus = vi.fn(() => ({ select: mockSelect }));
  const mockEqId = vi.fn(() => ({ eq: mockEqStatus }));
  const mockUpdate = vi.fn(() => ({ eq: mockEqId }));
  const mockFrom = vi.fn(() => ({ update: mockUpdate }));
  const mockDb = { from: mockFrom } as unknown as SupabaseClient;

  return {
    db: mockDb,
    from: mockFrom,
    update: mockUpdate,
    eqId: mockEqId,
    eqStatus: mockEqStatus,
    select: mockSelect,
    maybeSingle: mockMaybeSingle,
  };
}

describe('state-machine', () => {
  describe('VALID_TRANSITIONS', () => {
    it('should have entries for all content statuses including posted', () => {
      const expectedStatuses: ContentStatus[] = [
        'draft', 'review', 'approved', 'scheduled', 'queued',
        'publishing', 'published', 'posted', 'failed',
      ];
      for (const status of expectedStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      }
    });
  });

  describe('canTransition', () => {
    it.each([
      ['scheduled', 'queued'],
      ['queued', 'publishing'],
      ['publishing', 'published'],
      ['publishing', 'failed'],
      ['failed', 'queued'],
      ['draft', 'review'],
      ['review', 'approved'],
      ['review', 'draft'],
      ['approved', 'scheduled'],
      ['approved', 'queued'],
    ] as [ContentStatus, ContentStatus][])(
      'should return true for valid transition %s -> %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(true);
      },
    );

    it.each([
      ['draft', 'published'],
      ['published', 'queued'],
      ['queued', 'scheduled'],
      ['scheduled', 'published'],
    ] as [ContentStatus, ContentStatus][])(
      'should return false for invalid transition %s -> %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      },
    );

    it('should return false for an unknown status', () => {
      expect(canTransition('nonexistent' as ContentStatus, 'draft')).toBe(false);
    });

    it('should return false for all transitions from published (terminal state)', () => {
      const allStatuses: ContentStatus[] = [
        'draft', 'review', 'approved', 'scheduled', 'queued',
        'publishing', 'published', 'posted', 'failed',
      ];
      for (const to of allStatuses) {
        expect(canTransition('published', to)).toBe(false);
      }
    });

    it('should have no outgoing transitions from terminal states', () => {
      expect(VALID_TRANSITIONS.published).toEqual([]);
      expect(VALID_TRANSITIONS.posted).toEqual([]);
    });
  });

  describe('transitionStatus', () => {
    let mocks: ReturnType<typeof createMockDb>;

    beforeEach(() => {
      vi.clearAllMocks();
      mocks = createMockDb();
    });

    it('should throw Invalid transition error without making a DB call when transition is invalid', async () => {
      await expect(
        transitionStatus(mocks.db, 'content_items', 'item-1', 'draft', 'published'),
      ).rejects.toThrow('Invalid transition from draft to published');

      expect(mocks.from).not.toHaveBeenCalled();
    });

    it('should call Supabase with correct .from().update().eq().eq().select().maybeSingle() chain', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: { id: 'item-1' }, error: null });

      await transitionStatus(mocks.db, 'content_items', 'item-1', 'scheduled', 'queued');

      expect(mocks.from).toHaveBeenCalledWith('content_items');
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'queued', updated_at: expect.any(String) }),
      );
      expect(mocks.eqId).toHaveBeenCalledWith('id', 'item-1');
      expect(mocks.eqStatus).toHaveBeenCalledWith('status', 'scheduled');
      expect(mocks.select).toHaveBeenCalledWith('id');
      expect(mocks.maybeSingle).toHaveBeenCalled();
    });

    it('should resolve successfully when Supabase returns a matching row', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: { id: 'item-1' }, error: null });

      await expect(
        transitionStatus(mocks.db, 'content_items', 'item-1', 'queued', 'publishing'),
      ).resolves.toBeUndefined();
    });

    it('should throw with no matching row message when data is null (concurrent modification)', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      await expect(
        transitionStatus(mocks.db, 'content_items', 'item-1', 'publishing', 'published'),
      ).rejects.toThrow('no matching row (concurrent modification?)');
    });

    it('should throw with Supabase error message when Supabase returns an error', async () => {
      mocks.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      });

      await expect(
        transitionStatus(mocks.db, 'content_items', 'item-1', 'publishing', 'failed'),
      ).rejects.toThrow('connection refused');
    });

    it('should work with the publish_jobs table argument', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: { id: 'job-1' }, error: null });

      await transitionStatus(mocks.db, 'publish_jobs', 'job-1', 'failed', 'queued');

      expect(mocks.from).toHaveBeenCalledWith('publish_jobs');
    });

    it('should work with the content_items table argument', async () => {
      mocks.maybeSingle.mockResolvedValue({ data: { id: 'ci-1' }, error: null });

      await transitionStatus(mocks.db, 'content_items', 'ci-1', 'review', 'approved');

      expect(mocks.from).toHaveBeenCalledWith('content_items');
    });
  });
});
