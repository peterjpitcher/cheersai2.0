/**
 * Tests for database-backed rate limit tracking (PLAT-08).
 * Verifies incrementRateLimit uses RPC, checkRateLimit returns correct states,
 * and getRateLimitStatus returns per-endpoint counts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createServiceSupabaseClient before importing module under test
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

mockSelect.mockReturnValue({
  eq: mockEq,
});

// Build chainable .eq() calls
mockEq.mockReturnValue({
  eq: mockEq,
  single: mockSingle,
});

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

describe('rate-limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default returns
    mockRpc.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
  });

  describe('incrementRateLimit', () => {
    it('should call supabase.rpc with increment_rate_limit', async () => {
      const { incrementRateLimit } = await import('./rate-limits');
      await incrementRateLimit('account-1', 'facebook', '/me/feed');

      expect(mockRpc).toHaveBeenCalledWith('increment_rate_limit', expect.objectContaining({
        p_account_id: 'account-1',
        p_provider: 'facebook',
        p_endpoint: '/me/feed',
        p_limit_ceiling: 200,
      }));
      // Also verify p_window_start is an ISO string
      const call = mockRpc.mock.calls[0];
      expect(call[1].p_window_start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should NOT use .upsert() — relies on RPC function', async () => {
      const { incrementRateLimit } = await import('./rate-limits');
      await incrementRateLimit('account-1', 'instagram', '/media');

      // Verify no .from() calls (no upsert pattern)
      expect(mockFrom).not.toHaveBeenCalled();
      // Only RPC should be called
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    it('should not throw when RPC returns an error (advisory logging)', async () => {
      mockRpc.mockResolvedValue({ error: { message: 'db error' } });
      const { incrementRateLimit } = await import('./rate-limits');

      // Should not throw
      await expect(incrementRateLimit('account-1', 'facebook', '/feed')).resolves.toBeUndefined();
    });
  });

  describe('checkRateLimit', () => {
    it('should return allowed:true with remaining count when under limit', async () => {
      mockSingle.mockResolvedValue({ data: { request_count: 50 }, error: null });
      const { checkRateLimit } = await import('./rate-limits');
      const result = await checkRateLimit('account-1', 'facebook', '/me/feed');

      expect(result).toEqual({ allowed: true, remaining: 150 });
    });

    it('should return allowed:true with full remaining when no prior requests', async () => {
      mockSingle.mockResolvedValue({ data: null, error: null });
      const { checkRateLimit } = await import('./rate-limits');
      const result = await checkRateLimit('account-1', 'facebook', '/me/feed');

      expect(result).toEqual({ allowed: true, remaining: 200 });
    });

    it('should return allowed:false with remaining:0 when at ceiling', async () => {
      mockSingle.mockResolvedValue({ data: { request_count: 200 }, error: null });
      const { checkRateLimit } = await import('./rate-limits');
      const result = await checkRateLimit('account-1', 'facebook', '/me/feed');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return array of endpoint counts', async () => {
      // getRateLimitStatus doesn't call .single() — it gets multiple rows
      // We need to set up the chain to return data at the end of .eq() chain
      const mockData = [
        { endpoint: '/me/feed', request_count: 42, limit_ceiling: 200 },
        { endpoint: '/me/photos', request_count: 10, limit_ceiling: 200 },
      ];

      // Override the last .eq() to return data directly (no .single())
      mockEq.mockReturnValue({
        eq: mockEq,
        single: mockSingle,
        data: mockData,
        error: null,
      });

      const { getRateLimitStatus } = await import('./rate-limits');
      const result = await getRateLimitStatus('account-1', 'facebook');

      expect(result).toEqual([
        { endpoint: '/me/feed', count: 42, ceiling: 200 },
        { endpoint: '/me/photos', count: 10, ceiling: 200 },
      ]);
    });

    it('should return empty array when no data', async () => {
      mockEq.mockReturnValue({
        eq: mockEq,
        single: mockSingle,
        data: null,
        error: null,
      });

      const { getRateLimitStatus } = await import('./rate-limits');
      const result = await getRateLimitStatus('account-1', 'instagram');

      expect(result).toEqual([]);
    });
  });
});
