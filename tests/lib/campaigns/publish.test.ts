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
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, data: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
  // Reset chains
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, data: [] });
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
        destination_url: 'https://vip-club.uk/ma123',
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
        destination_url: 'https://vip-club.uk/ma123',
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
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Evergreen Test',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-04-01',
          phase_end: '2026-04-10',
          adset_media_asset_id: 'asset-1',
          ads: [
            {
              id: 'ad-1',
              meta_ad_id: null,
              name: 'Ad 1',
              headline: 'Test',
              primary_text: 'Primary text',
              description: 'Description',
              cta: 'LEARN_MORE',
              media_asset_id: null,
            },
          ],
        },
      ],
    });
    // Media asset lookup
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
    vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
    vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_123' });
    vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_123' });
    // Update campaign with meta_campaign_id
    mockUpdate.mockReturnValue({ eq: mockEq });

    const result = await publishCampaign('campaign-123');
    expect(marketing.createMetaCampaign).toHaveBeenCalled();
    expect(marketing.createMetaAd).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('blocks publishing when the campaign has no paid CTA URL', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'DAILY',
        budget_amount: 10,
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: null,
      },
    });
    mockSingle.mockResolvedValueOnce({
      data: { access_token: 'token', meta_account_id: 'act_123' },
    });
    mockSingle.mockResolvedValueOnce({
      data: { token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
    });
    mockSingle.mockResolvedValueOnce({
      data: { metadata: { pageId: 'page_123' } },
    });

    const result = await publishCampaign('campaign-123');
    expect(result.error).toContain('paid CTA URL');
    expect(marketing.createMetaCampaign).not.toHaveBeenCalled();
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
