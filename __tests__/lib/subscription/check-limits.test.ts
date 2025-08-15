import { checkCampaignLimit, checkPostLimit, checkMediaLimit } from '@/lib/subscription/check-limits';
import { createClient } from '@/lib/supabase/server';

// Mock the Supabase client
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

describe('Subscription Limit Checks', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        single: jest.fn(),
      })),
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkCampaignLimit', () => {
    it('should allow campaign creation when under limit', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { subscription_tier: 'starter', trial_ends_at: '2025-12-31' },
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ count: 5 }),
      });

      const result = await checkCampaignLimit('test-tenant-id');

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(5);
      expect(result.limit).toBe(20); // Starter tier limit
    });

    it('should deny campaign creation when at limit', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { subscription_tier: 'free', trial_ends_at: '2025-12-31' },
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ count: 5 }),
      });

      const result = await checkCampaignLimit('test-tenant-id');

      expect(result.allowed).toBe(false);
      expect(result.showUpgrade).toBe(true);
      expect(result.message).toContain('reached your limit');
    });

    it('should handle unlimited campaigns for pro tier', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { subscription_tier: 'pro', trial_ends_at: null },
        }),
      });

      const result = await checkCampaignLimit('test-tenant-id');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBeUndefined(); // Unlimited
    });
  });

  describe('checkPostLimit', () => {
    it('should count posts only from current month', async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { subscription_tier: 'free' },
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ count: 3 }),
      });

      const result = await checkPostLimit('test-tenant-id');

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(3);
      expect(result.limit).toBe(10); // Free tier limit
    });
  });

  describe('checkMediaLimit', () => {
    it('should enforce media asset limits', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { subscription_tier: 'free' },
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ count: 10 }),
      });

      const result = await checkMediaLimit('test-tenant-id');

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('reached your limit');
      expect(result.currentUsage).toBe(10);
      expect(result.limit).toBe(10);
    });
  });
});