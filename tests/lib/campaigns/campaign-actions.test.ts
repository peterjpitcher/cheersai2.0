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

vi.mock('@/lib/meta/marketing', () => ({
  createMetaAd: vi.fn(),
  createMetaAdCreative: vi.fn(),
  searchMetaInterests: vi.fn(),
  uploadMetaImage: vi.fn(),
}));

vi.mock('@/lib/campaigns/optimisation', () => ({
  runMetaCampaignOptimisation: vi.fn(),
}));

vi.mock('@/lib/campaigns/performance-sync', () => ({
  syncMetaCampaignPerformance: vi.fn(),
}));

vi.mock('@/lib/management-app/data', () => ({
  getManagementConnectionConfig: vi.fn(),
}));

vi.mock('@/lib/management-app/client', () => ({
  createManagementMetaAdsLink: vi.fn(),
  ManagementApiError: class ManagementApiError extends Error {
    constructor(public code: string, message: string, public status?: number) {
      super(message);
    }
  },
}));

// next/cache is not available in the test environment
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  applyOptimisationRecommendation,
  generateCampaignAction,
  runCampaignDashboardOptimisation,
  saveCampaignDraft,
} from '@/app/(app)/campaigns/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { generateCampaign } from '@/lib/campaigns/generate';
import { searchMetaInterests } from '@/lib/meta/marketing';
import { createManagementMetaAdsLink } from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import { runMetaCampaignOptimisation } from '@/lib/campaigns/optimisation';
import { syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
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
    mockMaybeSingle.mockResolvedValue({ data: null });
  });

  it('should return error when meta_ad_accounts has no setup_complete row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null });

    const result = await generateCampaignAction({
      campaignKind: 'event',
      promotionName: 'Tuesday campaign',
      problemBrief: 'We are dead on Tuesday nights',
      destinationUrl: 'https://vip-club.uk/ma123',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-07',
      adsStopTime: '23:00',
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });

    const mockPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Lead gen works best for this brief.',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Run-up',
          phase_label: 'Run-up',
          phase_start: '2026-04-01',
          phase_end: '2026-04-07',
          audience_description: 'Local adults',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          placements: 'AUTO',
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Quiz night',
              primary_text: 'Book quiz seats before they go.',
              description: 'Book now',
              cta: 'LEARN_MORE',
              creative_brief: 'Quiz table',
              angle: 'Booking urgency',
            },
          ],
        },
      ],
    };

    vi.mocked(generateCampaign).mockResolvedValueOnce(mockPayload as never);

    const result = await generateCampaignAction({
      campaignKind: 'event',
      promotionName: 'Tuesday campaign',
      problemBrief: 'We are dead on Tuesday nights',
      destinationUrl: 'https://vip-club.uk/ma123',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-07',
      adsStopTime: '23:00',
    });

    expect(result).toHaveProperty('payload');
    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.payload.campaign_name).toBe('Test Campaign');
    expect(result.payload.objective).toBe('OUTCOME_SALES');
    expect(result.payload.ad_sets[0].optimisation_goal).toBe('OFFSITE_CONVERSIONS');
    expect(result.payload.ad_sets[0].ads[0].cta).toBe('BOOK_NOW');
    expect(generateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        venueLocation: 'Leatherhead',
      }),
    );
  });

  it('creates a management Meta Ads short link for evergreen campaigns', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { setup_complete: true, meta_account_id: 'act_123', access_token: 'token' },
    });
    mockSingle.mockResolvedValueOnce({
      data: { display_name: 'The Anchor' },
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });
    vi.mocked(getManagementConnectionConfig).mockResolvedValueOnce({
      baseUrl: 'https://management.example.com',
      apiKey: 'key',
      enabled: true,
    });
    vi.mocked(createManagementMetaAdsLink).mockResolvedValueOnce({
      shortUrl: 'https://vip-club.uk/ma-evergreen',
      shortCode: 'ma-evergreen',
      destinationUrl: 'https://www.the-anchor.pub/private-hire',
      utmDestinationUrl: 'https://www.the-anchor.pub/private-hire?utm_source=facebook',
      alreadyExists: false,
    });

    vi.mocked(generateCampaign).mockResolvedValueOnce({
      objective: 'OUTCOME_TRAFFIC',
      rationale: 'Traffic campaign.',
      campaign_name: 'Evergreen',
      special_ad_category: 'NONE',
      ad_sets: [],
    } as never);

    const result = await generateCampaignAction({
      campaignKind: 'evergreen',
      promotionName: 'Private Hire',
      problemBrief: 'Promote private hire.',
      destinationUrl: 'https://www.the-anchor.pub/private-hire',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 20,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });

    expect(createManagementMetaAdsLink).toHaveBeenCalled();
    expect(result).toMatchObject({
      destinationUrl: 'https://vip-club.uk/ma-evergreen',
    });
  });

  it('rejects evergreen campaigns longer than 30 days', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { setup_complete: true, meta_account_id: 'act_123' },
    });
    mockSingle.mockResolvedValueOnce({
      data: { display_name: 'The Anchor' },
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });

    const result = await generateCampaignAction({
      campaignKind: 'evergreen',
      promotionName: 'Private Hire',
      problemBrief: 'Promote private hire.',
      destinationUrl: 'https://www.the-anchor.pub/private-hire',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 20,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-05-01',
    });

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('30 days');
    expect(createManagementMetaAdsLink).not.toHaveBeenCalled();
  });

  it('resolves Meta interests from AI keywords without trusting AI IDs', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { setup_complete: true, meta_account_id: 'act_123', access_token: 'token' },
    });
    mockSingle.mockResolvedValueOnce({
      data: { display_name: 'The Anchor' },
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });
    vi.mocked(getManagementConnectionConfig).mockResolvedValueOnce({
      baseUrl: 'https://management.example.com',
      apiKey: 'key',
      enabled: true,
    });
    vi.mocked(createManagementMetaAdsLink).mockResolvedValueOnce({
      shortUrl: 'https://vip-club.uk/ma-evergreen',
      shortCode: 'ma-evergreen',
      destinationUrl: 'https://www.the-anchor.pub/private-hire',
      utmDestinationUrl: 'https://www.the-anchor.pub/private-hire?utm_source=facebook',
      alreadyExists: false,
    });
    vi.mocked(generateCampaign).mockResolvedValueOnce({
      objective: 'OUTCOME_TRAFFIC',
      rationale: 'Traffic campaign.',
      campaign_name: 'Evergreen',
      special_ad_category: 'NONE',
      audience_keywords: ['private dining', '6003139266461', 'cocktails'],
      ad_sets: [
        {
          name: 'Evergreen',
          phase_label: 'Evergreen',
          phase_start: '2026-04-01',
          phase_end: '2026-04-30',
          audience_description: 'Local adults',
          targeting: {
            age_min: 18,
            age_max: 65,
            geo_locations: { countries: ['GB'] },
            interests: [{ id: 'invented-id', name: 'Invented' }],
          },
          placements: 'AUTO',
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [],
        },
      ],
    } as never);
    vi.mocked(searchMetaInterests)
      .mockResolvedValueOnce([{ id: 'real-1', name: 'Private dining', audience_size: 20_000 }])
      .mockResolvedValueOnce([{ id: 'real-2', name: 'Cocktails', audience_size: 30_000 }]);

    const result = await generateCampaignAction({
      campaignKind: 'evergreen',
      promotionName: 'Private Hire',
      problemBrief: 'Promote private hire.',
      destinationUrl: 'https://www.the-anchor.pub/private-hire',
      geoRadiusMiles: 3,
      audienceMode: 'local_interests',
      budgetAmount: 20,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });

    if ('error' in result) {
      throw new Error(result.error);
    }
    expect(result.audienceInterestKeywords).toEqual(['private dining', 'cocktails']);
    expect(result.resolvedInterests.map((interest) => interest.id)).toEqual(['real-1', 'real-2']);
    expect(result.resolvedInterests.some((interest) => interest.id === 'invented-id')).toBe(false);
  });
});

describe('runCampaignDashboardOptimisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  });

  it('syncs performance before running recommend mode optimisation', async () => {
    const callOrder: string[] = [];
    mockSupabase.in.mockResolvedValueOnce({ data: [{ id: 'campaign-1' }], error: null });
    vi.mocked(syncMetaCampaignPerformance).mockImplementationOnce(async () => {
      callOrder.push('sync');
      return { campaignSynced: true, adSetsSynced: 1, adsSynced: 1 };
    });
    vi.mocked(runMetaCampaignOptimisation).mockImplementationOnce(async () => {
      callOrder.push('optimise');
      return {
        runId: 'run-1',
        evaluatedAdSets: 2,
        plannedActions: 3,
        appliedActions: 0,
        failedActions: 0,
      };
    });

    const result = await runCampaignDashboardOptimisation();

    expect(result).toMatchObject({
      success: true,
      synced: 1,
      syncFailed: 0,
      evaluatedAdSets: 2,
      plannedActions: 3,
      appliedActions: 0,
      failedActions: 0,
    });
    expect(callOrder).toEqual(['sync', 'optimise']);
    expect(syncMetaCampaignPerformance).toHaveBeenCalledWith('campaign-1', {
      accountId: 'account-123',
      supabase: mockSupabase,
    });
    expect(runMetaCampaignOptimisation).toHaveBeenCalledWith({
      accountId: 'account-123',
      mode: 'recommend',
      supabase: mockSupabase,
    });
  });
});

describe('applyOptimisationRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  });

  it('updates a draft ad with approved replacement copy', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'action-1',
          campaign_id: 'campaign-1',
          adset_id: 'adset-1',
          ad_id: 'ad-1',
          action_type: 'copy_rewrite',
          status: 'planned',
          recommendation_payload: {
            proposed: {
              name: 'Booking rewrite',
              headline: 'Book quiz seats',
              primaryText: 'Book quiz seats before they go. Prize pot, food and tables are ready.',
              description: 'Book your spot',
              cta: 'BOOK_NOW',
              angle: 'Booking urgency',
            },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'ad-1',
          adset_id: 'adset-1',
          meta_ad_id: null,
          name: 'Original ad',
          status: 'DRAFT',
          media_asset_id: 'asset-1',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'adset-1',
          campaign_id: 'campaign-1',
          meta_adset_id: null,
          adset_media_asset_id: 'asset-1',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'campaign-1',
          account_id: 'account-123',
          destination_url: 'https://www.the-anchor.pub/events/quiz-night',
          campaign_kind: 'event',
        },
        error: null,
      });

    const result = await applyOptimisationRecommendation('action-1');

    expect(result).toEqual({ success: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Booking rewrite',
      headline: 'Book quiz seats',
      primary_text: 'Book quiz seats before they go. Prize pot, food and tables are ready.',
      description: 'Book your spot',
      cta: 'BOOK_NOW',
      angle: 'Booking urgency',
    }));
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'applied',
      replacement_ad_id: null,
    }));
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
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      startDate: '2026-04-01',
      endDate: '2026-04-07',
      adsStopTime: '23:00',
      problemBrief: 'We are dead on Tuesday nights',
      campaignKind: 'event',
      promotionName: 'Test Campaign',
      destinationUrl: 'https://vip-club.uk/ma123',
    });

    expect(result).toHaveProperty('campaignId', 'mock-id');
  });
});
