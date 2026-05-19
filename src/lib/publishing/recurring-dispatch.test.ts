/**
 * Tests for recurring auto-publish dispatch (06-05, SCHED-04).
 * Verifies: auto_confirm dispatch, idempotency skip, error resilience.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase service client
const mockFrom = vi.fn();

const mockSupabase = {
  from: mockFrom,
};

vi.mock('@/lib/supabase/service', () => ({
  tryCreateServiceSupabaseClient: vi.fn(() => mockSupabase),
}));

// Mock dispatchToQStash
vi.mock('@/lib/publishing/dispatch', () => ({
  dispatchToQStash: vi.fn().mockResolvedValue(undefined),
}));

// Mock transitionStatus
vi.mock('@/lib/publishing/state-machine', () => ({
  transitionStatus: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchRecurringPublishes } from './recurring-dispatch';
import { dispatchToQStash } from '@/lib/publishing/dispatch';

describe('dispatchRecurringPublishes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches items with auto_confirm=true and scheduled_for in past', async () => {
    const dueItems = [
      {
        id: 'ci-1',
        campaign_id: 'camp-1',
        platform: 'facebook',
        scheduled_for: '2026-05-19T10:00:00Z',
        account_id: 'acc-1',
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_items') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: dueItems, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'publish_jobs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: { id: 'job-1', idempotency_key: 'ci-1-facebook-123' },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }) }) };
    });

    const result = await dispatchRecurringPublishes();

    expect(result.dispatched).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(dispatchToQStash).toHaveBeenCalledTimes(1);
  });

  it('skips items with existing publish_job (idempotency)', async () => {
    const dueItems = [
      {
        id: 'ci-2',
        campaign_id: 'camp-1',
        platform: 'instagram',
        scheduled_for: '2026-05-19T10:00:00Z',
        account_id: 'acc-1',
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_items') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: dueItems, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'publish_jobs') {
        // Existing job found -- should skip
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [{ id: 'existing-job' }], error: null }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }) };
    });

    const result = await dispatchRecurringPublishes();

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dispatchToQStash).not.toHaveBeenCalled();
  });

  it('does NOT dispatch items with auto_confirm=false', async () => {
    // The query itself filters on auto_confirm=true, so no items returned
    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_items') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }) };
    });

    const result = await dispatchRecurringPublishes();

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(dispatchToQStash).not.toHaveBeenCalled();
  });

  it('continues processing remaining items when one errors', async () => {
    const dueItems = [
      {
        id: 'ci-fail',
        campaign_id: 'camp-1',
        platform: 'facebook',
        scheduled_for: '2026-05-19T10:00:00Z',
        account_id: 'acc-1',
      },
      {
        id: 'ci-ok',
        campaign_id: 'camp-1',
        platform: 'instagram',
        scheduled_for: '2026-05-19T10:00:00Z',
        account_id: 'acc-1',
      },
    ];

    let insertCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'content_items') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  lte: () => Promise.resolve({ data: dueItems, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'publish_jobs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: () => {
            insertCallCount++;
            if (insertCallCount === 1) {
              // First item fails
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: { message: 'DB error' } }),
                }),
              };
            }
            // Second item succeeds
            return {
              select: () => ({
                single: () => Promise.resolve({
                  data: { id: 'job-2', idempotency_key: 'ci-ok-instagram-123' },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ lte: () => Promise.resolve({ data: [], error: null }) }) }) };
    });

    const result = await dispatchRecurringPublishes();

    expect(result.dispatched).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('ci-fail');
  });

  it('returns zeroes when Supabase client is unavailable', async () => {
    const { tryCreateServiceSupabaseClient } = await import('@/lib/supabase/service');
    vi.mocked(tryCreateServiceSupabaseClient).mockReturnValueOnce(null);

    const result = await dispatchRecurringPublishes();

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
