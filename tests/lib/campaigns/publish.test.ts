import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/meta/marketing', () => ({
  createMetaCampaign: vi.fn(),
  createMetaAdSet: vi.fn(),
  uploadMetaImage: vi.fn(),
  createMetaAdCreative: vi.fn(),
  createMetaAd: vi.fn(),
  pauseMetaObject: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    constructor(message: string, public code: number) { super(message); }
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import * as marketing from '@/lib/meta/marketing';
import { publishCampaign, pauseCampaign } from '@/app/(app)/campaigns/[id]/actions';

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: mockUpdate,
  eq: mockEq,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  storage: {
    from: vi.fn().mockReturnThis(),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/image.jpg' }, error: null }),
  },
};

// Make update/eq chainable
mockUpdate.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ eq: mockEq });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
  // Reset chains
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  // Reset storage mock
  mockSupabase.storage.from.mockReturnThis();
  mockSupabase.storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://example.com/image.jpg' },
    error: null,
  });
});

describe('publishCampaign', () => {
  it('should return error if campaign not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const result = await publishCampaign('campaign-123');
    expect(result.error).toBeDefined();
  });

  it('should return error if Meta Ads not connected', async () => {
    // Campaign found
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        special_ad_category: 'NONE',
        budget_type: 'DAILY',
        budget_amount: 10,
        start_date: '2026-04-01',
        end_date: null,
      },
    });
    // Ad account — no token
    mockSingle.mockResolvedValueOnce({ data: null });

    const result = await publishCampaign('campaign-123');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Meta Ads');
  });

  it('should call createMetaCampaign on successful publish attempt', async () => {
    // Campaign
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        special_ad_category: 'NONE',
        budget_type: 'DAILY',
        budget_amount: 10,
        start_date: '2026-04-01',
        end_date: null,
      },
    });
    // Ad account (access_token + meta_account_id)
    mockSingle.mockResolvedValueOnce({
      data: { access_token: 'token', meta_account_id: 'act_123' },
    });
    // Token expiry check
    mockSingle.mockResolvedValueOnce({
      data: { token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
    });
    // Facebook page connection
    mockSingle.mockResolvedValueOnce({
      data: { metadata: { pageId: 'page_123' } },
    });
    // Ad sets with ads (empty)
    mockSingle.mockResolvedValueOnce({ data: [] });
    // link_in_bio_profiles website URL
    mockSingle.mockResolvedValueOnce({ data: { website_url: 'https://example.com' } });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    // Update campaign with meta_campaign_id
    mockUpdate.mockReturnValue({ eq: mockEq });

    const result = await publishCampaign('campaign-123');
    expect(marketing.createMetaCampaign).toHaveBeenCalled();
    // With no ad sets, it should succeed
    expect(result.success).toBe(true);
  });
});

describe('pauseCampaign', () => {
  it('should return error if campaign has no meta_campaign_id', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { meta_campaign_id: null, account_id: 'account-123' },
    });
    const result = await pauseCampaign('campaign-123');
    expect(result.error).toBeDefined();
  });
});
