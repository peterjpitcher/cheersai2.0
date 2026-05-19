import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canTransition, transitionStatus, VALID_TRANSITIONS } from './state-machine';
import type { ContentStatus } from '@/types/content';

// Mock Supabase client
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockEq2 = vi.fn();
const mockSingle = vi.fn();

const mockDb = {
  from: vi.fn(() => ({
    update: mockUpdate,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq2 });
  mockEq2.mockReturnValue({ single: mockSingle });
  mockSingle.mockResolvedValue({ data: { id: 'test-id' }, error: null });
});

describe('state-machine', () => {
  describe('VALID_TRANSITIONS', () => {
    it('has entries for all 7 content statuses', () => {
      const expectedStatuses: ContentStatus[] = [
        'draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed',
      ];
      for (const status of expectedStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      }
    });
  });

  describe('canTransition', () => {
    it('returns true for draft -> review', () => {
      expect(canTransition('draft', 'review')).toBe(true);
    });

    it('returns false for draft -> published (skip not allowed)', () => {
      expect(canTransition('draft', 'published')).toBe(false);
    });

    it('returns true for failed -> queued (retry re-queues)', () => {
      expect(canTransition('failed', 'queued')).toBe(true);
    });

    it('returns false for published -> anything (terminal state)', () => {
      const allStatuses: ContentStatus[] = [
        'draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed',
      ];
      for (const to of allStatuses) {
        expect(canTransition('published', to)).toBe(false);
      }
    });

    it('returns true for review -> approved', () => {
      expect(canTransition('review', 'approved')).toBe(true);
    });

    it('returns true for review -> draft (send back)', () => {
      expect(canTransition('review', 'draft')).toBe(true);
    });

    it('returns true for queued -> publishing', () => {
      expect(canTransition('queued', 'publishing')).toBe(true);
    });

    it('returns true for publishing -> published', () => {
      expect(canTransition('publishing', 'published')).toBe(true);
    });

    it('returns true for publishing -> failed', () => {
      expect(canTransition('publishing', 'failed')).toBe(true);
    });
  });

  describe('transitionStatus', () => {
    it('throws when transition is invalid', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transitionStatus(mockDb as any, 'content_items', 'test-id', 'draft', 'published'),
      ).rejects.toThrow('Invalid transition from draft to published');
    });

    it('updates the row status on valid transition', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await transitionStatus(mockDb as any, 'content_items', 'test-id', 'draft', 'review');

      expect(mockDb.from).toHaveBeenCalledWith('content_items');
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'review', updated_at: expect.any(String) });
      expect(mockEq).toHaveBeenCalledWith('id', 'test-id');
      expect(mockEq2).toHaveBeenCalledWith('status', 'draft');
    });

    it('throws when no row matched (concurrent modification)', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } });

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transitionStatus(mockDb as any, 'publish_jobs', 'test-id', 'queued', 'publishing'),
      ).rejects.toThrow();
    });
  });
});
