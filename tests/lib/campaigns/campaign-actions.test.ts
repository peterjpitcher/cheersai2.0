import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks must be declared before imports ---

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/campaigns/generate', () => ({
  generateCampaign: vi.fn(),
}));

// next/cache is not available in the test environment
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { generateCampaign } from '@/lib/campaigns/generate';

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCampaignAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  });

  it('should return error when meta_ad_accounts has no setup_complete row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null });

    const result = await generateCampaignAction({
      problemBrief: 'We are dead on Tuesday nights',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: null,
    });

    expect(result).toHaveProperty('error');
    expect(typeof (result as { error: string }).error).toBe('string');
    expect((result as { error: string }).error.length).toBeGreaterThan(0);
  });

  it('should return payload with campaign_name on success', async () => {
    // First call: meta_ad_accounts check
    mockMaybeSingle.mockResolvedValueOnce({
      data: { setup_complete: true, meta_account_id: 'act_123' },
    });
    // Second call: accounts venue name
    mockSingle.mockResolvedValueOnce({
      data: { name: 'The Anchor', city: 'London' },
    });

    const mockPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Lead gen works best for this brief.',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE',
      ad_sets: [],
    };

    vi.mocked(generateCampaign).mockResolvedValueOnce(mockPayload as never);

    const result = await generateCampaignAction({
      problemBrief: 'We are dead on Tuesday nights',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: null,
    });

    expect(result).toHaveProperty('payload');
    expect((result as { payload: typeof mockPayload }).payload.campaign_name).toBe('Test Campaign');
  });
});

describe('saveCampaignDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  });

  it('should return campaignId on success', async () => {
    // Campaign insert → single
    mockSingle.mockResolvedValueOnce({ data: { id: 'mock-id' }, error: null });

    const payload = {
      objective: 'OUTCOME_LEADS' as const,
      rationale: 'Test rationale',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE' as const,
      ad_sets: [],
    };

    const result = await saveCampaignDraft(payload, {
      budgetAmount: 500,
      budgetType: 'DAILY' as const,
      startDate: '2026-04-01',
      endDate: null,
      problemBrief: 'We are dead on Tuesday nights',
    });

    expect(result).toHaveProperty('campaignId', 'mock-id');
  });
});
