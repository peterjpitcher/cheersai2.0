import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks must be declared before imports ---

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123', user: { id: 'user-123' } }),
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
  setMetaObjectStatus: vi.fn(),
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
  activateOptimisationReplacementAd,
  applyOptimisationRecommendation,
  generateCampaignAction,
  getCampaignOptimisationActions,
  getCampaignWithTree,
  runCampaignDashboardOptimisation,
  saveCampaignDraft,
} from '@/app/(app)/campaigns/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { generateCampaign } from '@/lib/campaigns/generate';
import {
  createMetaAd,
  createMetaAdCreative,
  searchMetaInterests,
  setMetaObjectStatus,
  uploadMetaImage,
} from '@/lib/meta/marketing';
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
  storage: {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/signed.jpg' }, error: null })),
    })),
  },
};

type TestPhase = {
  phaseLabel: string;
  phaseStart: string;
  phaseEnd: string | null;
  adsStopTime: string | null;
};

function mockGeneratePrerequisites() {
  mockMaybeSingle.mockResolvedValueOnce({
    data: {
      setup_complete: true,
      meta_account_id: 'act_123',
      meta_pixel_id: '123456789012345',
      conversion_event_name: 'Purchase',
      conversion_optimisation_enabled: true,
    },
  });
  mockSingle.mockResolvedValueOnce({
    data: { display_name: 'The Anchor' },
  });
  mockMaybeSingle.mockResolvedValueOnce({
    data: { venue_location: 'Leatherhead' },
  });
}

function generatedPayloadForPhases(phases: TestPhase[]) {
  return {
    objective: 'OUTCOME_SALES' as const,
    rationale: 'Booking campaign.',
    campaign_name: 'Event Campaign',
    special_ad_category: 'NONE' as const,
    ad_sets: phases.map((phase, index) => ({
      name: phase.phaseLabel,
      phase_label: phase.phaseLabel,
      phase_start: phase.phaseStart,
      phase_end: phase.phaseEnd,
      ads_stop_time: phase.adsStopTime ?? undefined,
      audience_description: 'Local adults',
      targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
      placements: 'AUTO' as const,
      optimisation_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      ads: [
        {
          name: `Ad ${index + 1}`,
          headline: 'Book your seats',
          primary_text: 'Book your seats for this local event before tables fill.',
          description: 'Book now',
          cta: 'BOOK_NOW' as const,
          creative_brief: 'Venue event photo',
          angle: `Booking angle ${index + 1}`,
        },
      ],
    })),
  };
}

function mockGenerateFromPhases() {
  vi.mocked(generateCampaign).mockImplementationOnce(async (input) => (
    generatedPayloadForPhases(input.phases) as Awaited<ReturnType<typeof generateCampaign>>
  ));
}

function campaignTreeRow(engagement?: { reactions: number; comments: number; shares: number }) {
  const engagementMetrics = engagement
    ? {
        metrics_reactions: engagement.reactions,
        metrics_comments: engagement.comments,
        metrics_shares: engagement.shares,
      }
    : {};

  return {
    id: 'campaign-1',
    account_id: 'account-123',
    meta_campaign_id: 'meta-campaign-1',
    name: 'Campaign',
    objective: 'OUTCOME_SALES',
    problem_brief: 'Fill more tables.',
    ai_rationale: null,
    budget_type: 'DAILY',
    budget_amount: 20,
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    status: 'ACTIVE',
    meta_status: 'ACTIVE',
    publish_error: null,
    special_ad_category: 'NONE',
    campaign_kind: 'event',
    source_type: null,
    source_id: null,
    destination_url: 'https://example.com/book',
    geo_radius_miles: 3,
    audience_mode: 'local_only',
    audience_interest_keywords: [],
    resolved_interests: [],
    source_snapshot: null,
    quality_score: null,
    quality_status: null,
    quality_issues: [],
    audience_strategy: null,
    metrics_spend: 10,
    metrics_impressions: 1000,
    metrics_reach: 800,
    metrics_clicks: 50,
    ...engagementMetrics,
    metrics_ctr: 5,
    metrics_cpc: 0.2,
    metrics_conversions: 2,
    metrics_cost_per_conversion: 5,
    metrics_conversion_rate: 4,
    last_synced_at: '2026-09-22T08:00:00.000Z',
    created_at: '2026-09-01T08:00:00.000Z',
    ad_sets: [{
      id: 'adset-1',
      campaign_id: 'campaign-1',
      meta_adset_id: 'meta-adset-1',
      name: 'Ad set',
      phase_start: '2026-09-01',
      phase_end: '2026-09-30',
      targeting: {},
      placements: 'AUTO',
      budget_amount: 20,
      optimisation_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      adset_media_asset_id: null,
      adset_image_url: null,
      ads_stop_time: null,
      ads_start_time: null,
      service_key: null,
      decision_stage: null,
      budget_weight: null,
      meta_status: 'ACTIVE',
      metrics_spend: 6,
      metrics_impressions: 600,
      metrics_reach: 500,
      metrics_clicks: 30,
      ...engagementMetrics,
      metrics_ctr: 5,
      metrics_cpc: 0.2,
      metrics_conversions: 1,
      metrics_cost_per_conversion: 6,
      metrics_conversion_rate: 3.33,
      last_synced_at: '2026-09-22T08:00:00.000Z',
      status: 'ACTIVE',
      created_at: '2026-09-01T08:00:00.000Z',
      ads: [{
        id: 'ad-1',
        adset_id: 'adset-1',
        meta_ad_id: 'meta-ad-1',
        meta_creative_id: 'meta-creative-1',
        name: 'Ad',
        headline: 'Book now',
        primary_text: 'Book your table.',
        description: 'Tables available',
        cta: 'BOOK_NOW',
        angle: null,
        creative_format: null,
        creative_variant_key: null,
        utm_content_key: null,
        media_asset_id: null,
        creative_brief: null,
        preview_url: null,
        meta_status: 'ACTIVE',
        metrics_spend: 4,
        metrics_impressions: 400,
        metrics_reach: 300,
        metrics_clicks: 20,
        ...engagementMetrics,
        metrics_ctr: 5,
        metrics_cpc: 0.2,
        metrics_conversions: 1,
        metrics_cost_per_conversion: 4,
        metrics_conversion_rate: 5,
        last_synced_at: '2026-09-22T08:00:00.000Z',
        status: 'ACTIVE',
        created_at: '2026-09-01T08:00:00.000Z',
      }],
    }],
  };
}

function mockCampaignTreeLoad(row: ReturnType<typeof campaignTreeRow>) {
  const treeEqCalls: Array<{ column: string; value: string }> = [];
  const treeBuilder = {
    select: vi.fn(() => treeBuilder),
    eq: vi.fn((column: string, value: string) => {
      treeEqCalls.push({ column, value });
      return treeBuilder;
    }),
    single: vi.fn(async () => ({ data: row, error: null })),
  };
  const listBuilder = {
    select: vi.fn(() => listBuilder),
    eq: vi.fn(() => listBuilder),
    order: vi.fn(async () => ({ data: [], error: null })),
  };
  const campaignQueries = [treeBuilder, listBuilder];
  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== 'meta_campaigns') throw new Error(`Unexpected table: ${table}`);
      return campaignQueries.shift();
    }),
  };
  vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);
  return { treeEqCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCampaignAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
    mockMaybeSingle.mockResolvedValue({ data: null });
    vi.mocked(getManagementConnectionConfig).mockResolvedValue({
      baseUrl: 'https://management.example.com',
      apiKey: 'key',
      enabled: true,
    });
    vi.mocked(createManagementMetaAdsLink).mockImplementation(async (_config, input) => ({
      shortUrl: input.parentShortCode ? `https://l.the-anchor.pub/${input.parentShortCode}` : 'https://l.the-anchor.pub/ma-generated',
      shortCode: input.parentShortCode ?? 'ma-generated',
      destinationUrl: input.destinationUrl,
      utmDestinationUrl: input.destinationUrl.includes('utm_source=')
        ? input.destinationUrl
        : `${input.destinationUrl}?utm_source=facebook&utm_medium=paid_social&utm_campaign=test`,
      alreadyExists: Boolean(input.parentShortCode),
      variants: (input.variants ?? []).map((variant, index) => ({
        shortUrl: `https://l.the-anchor.pub/mv${index + 1}`,
        shortCode: `mv${index + 1}`,
        destinationUrl: input.destinationUrl,
        utmDestinationUrl: `${input.destinationUrl}${input.destinationUrl.includes('?') ? '&' : '?'}utm_content=${variant.utmContent}`,
        utmContent: variant.utmContent,
        parentShortCode: input.parentShortCode ?? 'ma-generated',
        alreadyExists: false,
      })),
    }));
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
      data: {
        setup_complete: true,
        meta_account_id: 'act_123',
        meta_pixel_id: '123456789012345',
        conversion_event_name: 'Purchase',
        conversion_optimisation_enabled: true,
      },
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
      variants: [],
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

  it('rejects evergreen campaigns longer than 45 days', async () => {
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
      endDate: '2026-05-16',
    });

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('45 days');
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
      variants: [],
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

  it('returns a three-moment media plan with one execution ad set for low-budget events', async () => {
    mockGeneratePrerequisites();
    mockGenerateFromPhases();

    const result = await generateCampaignAction({
      campaignKind: 'event',
      promotionName: 'Quiz Night',
      problemBrief: 'Promote bookings for quiz night.',
      destinationUrl: 'https://vip-club.uk/ma123',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 20,
      budgetType: 'LIFETIME',
      startDate: '2026-03-10',
      endDate: '2026-03-15',
      adsStopTime: '19:00',
    });

    if ('error' in result) {
      throw new Error(result.error);
    }

    expect(generateCampaign).toHaveBeenCalledWith(expect.objectContaining({
      phases: [
        expect.objectContaining({
          phaseType: 'booking-push',
          phaseLabel: 'Booking Push',
          phaseStart: '2026-03-10',
          phaseEnd: '2026-03-15',
        }),
      ],
      mediaPlan: expect.objectContaining({
        executionMode: 'single_push',
      }),
    }));
    expect(result.payload.ad_sets).toHaveLength(1);
    expect(result.payload.media_plan).toMatchObject({
      executionMode: 'single_push',
      budgetRecommendation: {
        recommendedBudgetAmount: 100,
        targetExecutionMode: 'two_phase',
      },
    });
    expect(result.payload.media_plan?.strategicPhases).toHaveLength(3);
    expect(result.sourceSnapshot.mediaPlan).toEqual(result.payload.media_plan);
  });

  it('uses two or three execution ad sets when event budget supports richer delivery', async () => {
    mockGeneratePrerequisites();
    mockGenerateFromPhases();

    const mediumResult = await generateCampaignAction({
      campaignKind: 'event',
      promotionName: 'Quiz Night',
      problemBrief: 'Promote bookings for quiz night.',
      destinationUrl: 'https://vip-club.uk/ma123',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 100,
      budgetType: 'LIFETIME',
      startDate: '2026-03-10',
      endDate: '2026-03-15',
      adsStopTime: '19:00',
    });

    if ('error' in mediumResult) {
      throw new Error(mediumResult.error);
    }

    expect(mediumResult.payload.media_plan?.executionMode).toBe('two_phase');
    expect(mediumResult.payload.ad_sets.map((adSet) => adSet.phase_label)).toEqual(['Warm-up', 'Closeout']);

    mockGeneratePrerequisites();
    mockGenerateFromPhases();

    const highResult = await generateCampaignAction({
      campaignKind: 'event',
      promotionName: 'Quiz Night',
      problemBrief: 'Promote bookings for quiz night.',
      destinationUrl: 'https://vip-club.uk/ma123',
      geoRadiusMiles: 3,
      audienceMode: 'local_only',
      budgetAmount: 150,
      budgetType: 'LIFETIME',
      startDate: '2026-03-10',
      endDate: '2026-03-15',
      adsStopTime: '19:00',
    });

    if ('error' in highResult) {
      throw new Error(highResult.error);
    }

    expect(highResult.payload.media_plan?.executionMode).toBe('three_phase');
    expect(highResult.payload.ad_sets.map((adSet) => adSet.phase_label)).toEqual([
      'Warm-up',
      'Tomorrow Push',
      'Last Chance',
    ]);
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
        failedActionInserts: 0,
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

describe('campaign performance row mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps engagement metrics on campaigns, ad sets, and ads', async () => {
    const row = campaignTreeRow({
      reactions: 12,
      comments: 3,
      shares: 2,
    });
    Object.assign(row.ad_sets[0], {
      metrics_reactions: 7,
      metrics_comments: 2,
      metrics_shares: 1,
    });
    Object.assign(row.ad_sets[0].ads[0], {
      metrics_reactions: 4,
      metrics_comments: 1,
      metrics_shares: 1,
    });
    const { treeEqCalls } = mockCampaignTreeLoad(row);

    const campaign = await getCampaignWithTree('campaign-1');

    expect(campaign?.performance).toMatchObject({ reactions: 12, comments: 3, shares: 2 });
    expect(campaign?.adSets?.[0].performance).toMatchObject({ reactions: 7, comments: 2, shares: 1 });
    expect(campaign?.adSets?.[0].ads?.[0].performance).toMatchObject({ reactions: 4, comments: 1, shares: 1 });
    expect(treeEqCalls).toContainEqual({ column: 'account_id', value: 'account-123' });
  });

  it('maps missing legacy engagement fields to zero at every level', async () => {
    mockCampaignTreeLoad(campaignTreeRow());

    const campaign = await getCampaignWithTree('campaign-1');

    expect(campaign?.performance).toMatchObject({ reactions: 0, comments: 0, shares: 0 });
    expect(campaign?.adSets?.[0].performance).toMatchObject({ reactions: 0, comments: 0, shares: 0 });
    expect(campaign?.adSets?.[0].ads?.[0].performance).toMatchObject({ reactions: 0, comments: 0, shares: 0 });
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
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      operation_type: 'optimisation_rewrite_apply_attempt',
      resource_type: 'meta_optimisation_action',
      resource_id: 'action-1',
    }));
  });

  const safeLiveProposalAction = {
    id: 'action-safe',
    campaign_id: 'campaign-weekday',
    adset_id: 'adset-weekday',
    ad_id: 'ad-weekday',
    action_type: 'copy_rewrite',
    status: 'planned',
    recommendation_payload: {
      proposed: {
        name: 'Evergreen Test | Value for money | Var 2 - booking rewrite',
        headline: 'Lunch from £9, Tuesday to Friday',
        primaryText: "Snack pots are £9 and wraps are £10.\n\nBook your table online and we'll have it ready for you.",
        description: 'Book now',
        cta: 'BOOK_NOW',
        angle: 'Booking intent',
      },
    },
  };

  it('creates the replacement ad PAUSED on Meta and records who applied it', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: safeLiveProposalAction, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAd, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAdSet, error: null })
      .mockResolvedValueOnce({ data: weekdayLunchCampaignRow, error: null })
      .mockResolvedValueOnce({ data: { access_token: 'token', meta_account_id: 'act_123' }, error: null })
      .mockResolvedValueOnce({ data: { metadata: { pageId: 'page-1' } }, error: null });
    mockSingle
      .mockResolvedValueOnce({ data: { storage_path: 'media/weekday.jpg' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'replacement-1' }, error: null });
    vi.mocked(uploadMetaImage).mockResolvedValueOnce({ hash: 'hash-1' } as never);
    vi.mocked(createMetaAdCreative).mockResolvedValueOnce({ id: 'creative-1' } as never);
    vi.mocked(createMetaAd).mockResolvedValueOnce({ id: 'meta-replacement-1' });

    const result = await applyOptimisationRecommendation('action-safe');

    expect(result).toEqual({ success: true, replacementAdId: 'replacement-1' });
    expect(createMetaAd).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }));
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
      meta_ad_id: 'meta-replacement-1',
      status: 'PAUSED',
      meta_status: 'PAUSED',
    }));
    expect(mockSupabase.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      operation_type: 'optimisation_rewrite_apply_attempt',
      resource_id: 'action-safe',
    }));
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      operation_type: 'optimisation_rewrite_applied',
      details: expect.objectContaining({ replacementAdId: 'replacement-1', createdPaused: true }),
    }));
  });

  it('changes nothing and tells the user when it cannot record who is applying', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: safeLiveProposalAction, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAd, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAdSet, error: null })
      .mockResolvedValueOnce({ data: weekdayLunchCampaignRow, error: null });
    mockSupabase.insert.mockReturnValueOnce({ error: { message: 'audit_log unavailable' } });

    const result = await applyOptimisationRecommendation('action-safe');

    expect(result).toEqual({ error: expect.stringContaining('Could not record who made this change') });
    expect(mockSupabase.update).not.toHaveBeenCalled();
    expect(uploadMetaImage).not.toHaveBeenCalled();
    expect(createMetaAd).not.toHaveBeenCalled();
  });

  it('skips a stored proposal that publishes the internal campaign name and never calls Meta', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: leakedWeekdayLunchAction, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAd, error: null })
      .mockResolvedValueOnce({ data: liveWeekdayLunchAdSet, error: null })
      .mockResolvedValueOnce({ data: weekdayLunchCampaignRow, error: null });

    const result = await applyOptimisationRecommendation('action-leaked');

    expect(result).toEqual({ error: expect.stringContaining('it uses the internal campaign name') });
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
    expect(mockSupabase.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'applied' }));
    expect(mockSupabase.insert).not.toHaveBeenCalled();
    expect(uploadMetaImage).not.toHaveBeenCalled();
    expect(createMetaAdCreative).not.toHaveBeenCalled();
    expect(createMetaAd).not.toHaveBeenCalled();
  });
});

// The rewrite applied on 22 September 2026, as stored in meta_optimisation_actions.
const leakedWeekdayLunchAction = {
  id: 'action-leaked',
  campaign_id: 'campaign-weekday',
  adset_id: 'adset-weekday',
  ad_id: 'ad-weekday',
  action_type: 'copy_rewrite',
  status: 'planned',
  recommendation_payload: {
    proposed: {
      name: 'Evergreen Test | Booking urgency | Var 1 - booking rewrite',
      headline: 'Book Weekday Lunch A (cod and chips)',
      primaryText:
        'Reserve a table for Weekday Lunch A (cod and chips).\n\n'
        + 'Weekday lunch at The Anchor, Stanwell Moor: lunch is served Tuesday to Friday, 12pm to 3pm (new since 1 September 2026)\n\n'
        + 'Book today and make the plan easy to say yes to.',
      description: 'Book now',
      cta: 'BOOK_NOW',
      angle: 'Booking intent',
    },
  },
};

const liveWeekdayLunchAd = {
  id: 'ad-weekday',
  adset_id: 'adset-weekday',
  meta_ad_id: 'meta-ad-weekday',
  name: 'Evergreen Test | Booking urgency | Var 1',
  status: 'ACTIVE',
  media_asset_id: 'asset-weekday',
};

const liveWeekdayLunchAdSet = {
  id: 'adset-weekday',
  campaign_id: 'campaign-weekday',
  meta_adset_id: 'meta-adset-weekday',
  adset_media_asset_id: null,
};

const weekdayLunchCampaignRow = {
  id: 'campaign-weekday',
  account_id: 'account-123',
  name: 'Weekday Lunch A (cod and chips)',
  destination_url: 'https://l.the-anchor.pub/weekday-lunch',
  campaign_kind: 'evergreen',
  source_snapshot: { sourceType: 'custom_promotion' },
};

describe('optimisation action summaries', () => {
  function mockActionRows(rows: unknown[]) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({ data: rows, error: null })),
    };
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ from: vi.fn(() => builder) } as never);
  }

  const baseRow = {
    run_id: 'run-1',
    campaign_id: 'campaign-weekday',
    adset_id: 'adset-weekday',
    ad_id: 'ad-weekday',
    action_type: 'copy_rewrite',
    reason: 'Rewrite recommended.',
    status: 'planned',
    severity: 'info',
    error: null,
    metrics_snapshot: {},
    replacement_ad_id: null,
    applied_at: null,
    created_at: '2026-09-19T03:00:00Z',
    meta_campaigns: { name: 'Weekday Lunch A (cod and chips)', status: 'ACTIVE', meta_status: 'ACTIVE', end_date: null, source_snapshot: {} },
  };

  it('marks a planned rewrite that uses the campaign name as blocked, with the reason', async () => {
    mockActionRows([{ ...baseRow, id: 'leaked', recommendation_payload: leakedWeekdayLunchAction.recommendation_payload }]);

    const [summary] = await getCampaignOptimisationActions('campaign-weekday');

    expect(summary.copyProblems).toContain('it uses the internal campaign name');
  });

  it('leaves a safe planned rewrite approvable', async () => {
    mockActionRows([{
      ...baseRow,
      id: 'safe',
      recommendation_payload: {
        proposed: {
          headline: 'Lunch from £9, Tuesday to Friday',
          primaryText: "Snack pots are £9.\n\nBook your table online and we'll have it ready for you.",
          description: 'Book now',
          cta: 'BOOK_NOW',
        },
      },
    }]);

    const [summary] = await getCampaignOptimisationActions('campaign-weekday');

    expect(summary.copyProblems).toEqual([]);
  });

  it('reports the replacement ad status so a paused replacement can be switched on', async () => {
    mockActionRows([{
      ...baseRow,
      id: 'applied',
      status: 'applied',
      recommendation_payload: {},
      replacement_ad_id: 'replacement-1',
      replacement: { status: 'PAUSED' },
    }]);

    const [summary] = await getCampaignOptimisationActions('campaign-weekday');

    expect(summary.replacementAdStatus).toBe('PAUSED');
  });
});

describe('activateOptimisationReplacementAd', () => {
  const appliedAction = {
    id: 'action-applied',
    campaign_id: 'campaign-weekday',
    action_type: 'copy_rewrite',
    status: 'applied',
    replacement_ad_id: 'replacement-1',
  };
  const pausedReplacement = { id: 'replacement-1', adset_id: 'adset-weekday', meta_ad_id: 'meta-replacement-1', status: 'PAUSED' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
  });

  function queueActivationReads(replacement: Record<string, unknown>) {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: appliedAction, error: null })
      .mockResolvedValueOnce({ data: { id: 'campaign-weekday' }, error: null })
      .mockResolvedValueOnce({ data: replacement, error: null });
  }

  it('switches on a paused replacement and records who did it', async () => {
    queueActivationReads(pausedReplacement);
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'adset-weekday', campaign_id: 'campaign-weekday' }, error: null })
      .mockResolvedValueOnce({ data: { access_token: 'token' }, error: null });

    const result = await activateOptimisationReplacementAd('action-applied');

    expect(result).toEqual({ success: true });
    expect(setMetaObjectStatus).toHaveBeenCalledWith('meta-replacement-1', 'token', 'ACTIVE');
    expect(mockSupabase.update).toHaveBeenCalledWith({ status: 'ACTIVE', meta_status: 'ACTIVE' });
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      operation_type: 'optimisation_replacement_activate_attempt',
      resource_id: 'action-applied',
    }));
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-123',
      operation_type: 'optimisation_replacement_activated',
    }));
  });

  it('refuses when the replacement is not paused', async () => {
    queueActivationReads({ ...pausedReplacement, status: 'ACTIVE' });

    const result = await activateOptimisationReplacementAd('action-applied');

    expect(result).toEqual({ error: expect.stringContaining('not paused') });
    expect(setMetaObjectStatus).not.toHaveBeenCalled();
  });

  it('refuses a replacement that sits in another campaign', async () => {
    queueActivationReads(pausedReplacement);
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'adset-other', campaign_id: 'campaign-other' }, error: null });

    const result = await activateOptimisationReplacementAd('action-applied');

    expect(result).toEqual({ error: 'The replacement ad does not belong to this campaign.' });
    expect(setMetaObjectStatus).not.toHaveBeenCalled();
  });

  it('tells the user and records the failure when Meta refuses', async () => {
    queueActivationReads(pausedReplacement);
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'adset-weekday', campaign_id: 'campaign-weekday' }, error: null })
      .mockResolvedValueOnce({ data: { access_token: 'token' }, error: null });
    vi.mocked(setMetaObjectStatus).mockRejectedValueOnce(new Error('Meta API error: token expired'));

    const result = await activateOptimisationReplacementAd('action-applied');

    expect(result).toEqual({ error: 'Meta API error: token expired' });
    expect(mockSupabase.update).not.toHaveBeenCalled();
    expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'optimisation_replacement_activate_failed',
      operation_status: 'failure',
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

  it('deletes the created campaign (cascade) when an ad insert fails', async () => {
    // Table-aware mock: campaign + ad_set inserts resolve via .select().single();
    // the ads insert is awaited directly and resolves with an error.
    // getConversionOptimisationConfig reads via maybeSingle before the campaign insert.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    let table = '';
    const deleteEqCalls: Array<{ table: string; column: string; value: unknown }> = [];
    let pendingDelete = false;

    mockSupabase.from.mockImplementation((t: string) => {
      table = t;
      return mockSupabase;
    });
    mockSupabase.delete.mockImplementation(() => {
      pendingDelete = true;
      return mockSupabase;
    });
    mockSupabase.eq.mockImplementation((column: string, value: unknown) => {
      if (pendingDelete) {
        deleteEqCalls.push({ table, column, value });
        pendingDelete = false;
      }
      return mockSupabase;
    });
    mockSupabase.insert.mockImplementation(() =>
      table === 'ads' ? { error: { message: 'ad insert boom' } } : mockSupabase,
    );
    // Campaign insert row id (via .select().single()); ad_set insert row id next.
    mockSingle
      .mockResolvedValueOnce({ data: { id: 'mock-id' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'adset-1' }, error: null });

    const payload = {
      objective: 'OUTCOME_LEADS' as const,
      rationale: 'Test rationale',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE' as const,
      ad_sets: [
        {
          name: 'Phase 1',
          phase_label: 'Phase 1',
          phase_start: '2026-04-01',
          phase_end: null,
          audience_description: 'Local adults',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          placements: 'AUTO' as const,
          optimisation_goal: 'OFFSITE_CONVERSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Book your seats',
              primary_text: 'Book your seats for this local event tonight.',
              description: 'Book now',
              cta: 'BOOK_NOW' as const,
              creative_brief: 'Venue event photo',
              angle: 'Booking angle',
            },
          ],
        },
      ],
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

    expect(result).toEqual({ error: 'ad insert boom' });
    // The partial draft is cleaned up via cascade delete of the campaign row.
    expect(deleteEqCalls).toContainEqual({ table: 'meta_campaigns', column: 'id', value: 'mock-id' });

    // Restore the shared chainable mock implementations (clearAllMocks does not reset
    // implementations) so this test cannot leak into any later-added sibling test.
    mockSupabase.from.mockReturnThis();
    mockSupabase.insert.mockReturnThis();
    mockSupabase.delete.mockReturnThis();
    mockSupabase.eq.mockReturnThis();
  });
});

describe('evergreen delivery schedule on generate and save', () => {
  // Weekday lunch on the 15 September to 9 October 2026 flight, total budget.
  const lunchSchedule = {
    days: ['friday', 'tuesday', 'thursday', 'wednesday'] as Array<'tuesday' | 'wednesday' | 'thursday' | 'friday'>,
    startHour: 9,
    endHour: 14,
  };
  const evergreenMeta = {
    campaignKind: 'evergreen' as const,
    promotionName: 'Weekday Lunch',
    budgetAmount: 180,
    budgetType: 'LIFETIME' as const,
    geoRadiusMiles: 5 as const,
    audienceMode: 'local_only' as const,
    startDate: '2026-09-15',
    endDate: '2026-10-09',
    problemBrief: 'Now serving lunch Tuesday to Friday.',
    destinationUrl: 'https://l.the-anchor.pub/ma-lunch',
    sourceType: 'custom_promotion',
  };
  const emptyPayload = {
    objective: 'OUTCOME_TRAFFIC' as const,
    rationale: 'Traffic campaign.',
    campaign_name: 'Weekday Lunch',
    special_ad_category: 'NONE' as const,
    ad_sets: [],
  };

  function campaignInsertArgs(): Record<string, unknown> {
    const call = mockSupabase.insert.mock.calls[0];
    if (!call) throw new Error('meta_campaigns was not inserted');
    return call[0] as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Flush any queued one-off results left by earlier tests before setting defaults.
    mockMaybeSingle.mockReset();
    mockSingle.mockReset();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as never);
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({ data: { id: 'campaign-new' }, error: null });
  });

  it('saves the schedule, days in week order, on an evergreen total-budget draft', async () => {
    const result = await saveCampaignDraft(emptyPayload, { ...evergreenMeta, deliverySchedule: lunchSchedule });

    expect(result).toEqual({ campaignId: 'campaign-new' });
    expect(campaignInsertArgs().delivery_schedule).toEqual({
      days: ['tuesday', 'wednesday', 'thursday', 'friday'],
      startHour: 9,
      endHour: 14,
    });
  });

  it('leaves the column out entirely when there is no schedule, so the insert is unchanged', async () => {
    const result = await saveCampaignDraft(emptyPayload, { ...evergreenMeta, deliverySchedule: null });

    expect(result).toEqual({ campaignId: 'campaign-new' });
    expect('delivery_schedule' in campaignInsertArgs()).toBe(false);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a daily budget', { budgetType: 'DAILY' }, /need a total budget/],
    ['an event campaign', { campaignKind: 'event', adsStopTime: '19:00' }, /only available for evergreen/],
    ['no chosen days', { deliverySchedule: { ...lunchSchedule, days: [] } }, /at least one delivery day/],
    ['half hours', { deliverySchedule: { ...lunchSchedule, startHour: 9.5 } }, /whole hours/],
    ['a flight with no scheduled day', { startDate: '2026-09-19', endDate: '2026-09-21' }, /None of the chosen delivery days/],
  ])('refuses to save a schedule with %s, before writing anything', async (_label, overrides, message) => {
    const result = await saveCampaignDraft(emptyPayload, {
      ...evergreenMeta,
      deliverySchedule: lunchSchedule,
      ...overrides,
    } as Parameters<typeof saveCampaignDraft>[1]);

    expect((result as { error: string }).error).toMatch(message);
    expect(mockSupabase.insert).not.toHaveBeenCalled();
  });

  it('refuses a schedule on a daily budget before creating a short link or calling the AI', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { setup_complete: true, meta_account_id: 'act_123', access_token: 'token' } })
      .mockResolvedValueOnce({ data: { venue_location: 'Stanwell Moor' } });
    mockSingle.mockResolvedValueOnce({ data: { display_name: 'The Anchor' } });

    const result = await generateCampaignAction({
      ...evergreenMeta,
      destinationUrl: 'https://www.the-anchor.pub/lunch-and-dinner',
      budgetType: 'DAILY',
      deliverySchedule: lunchSchedule,
    });

    expect((result as { error: string }).error).toMatch(/need a total budget/);
    expect(createManagementMetaAdsLink).not.toHaveBeenCalled();
    expect(generateCampaign).not.toHaveBeenCalled();
  });

  it('lets a valid schedule through to generation', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { setup_complete: true, meta_account_id: 'act_123', access_token: 'token' } })
      .mockResolvedValueOnce({ data: { venue_location: 'Stanwell Moor' } });
    mockSingle.mockResolvedValueOnce({ data: { display_name: 'The Anchor' } });
    vi.mocked(getManagementConnectionConfig).mockResolvedValueOnce({
      baseUrl: 'https://management.example.com',
      apiKey: 'key',
      enabled: true,
    });
    vi.mocked(createManagementMetaAdsLink).mockResolvedValueOnce({
      shortUrl: 'https://l.the-anchor.pub/ma-lunch',
      shortCode: 'ma-lunch',
      destinationUrl: 'https://www.the-anchor.pub/lunch-and-dinner',
      utmDestinationUrl: 'https://www.the-anchor.pub/lunch-and-dinner?utm_source=facebook',
      alreadyExists: false,
      variants: [],
    });
    vi.mocked(generateCampaign).mockResolvedValueOnce(emptyPayload as never);

    const result = await generateCampaignAction({
      ...evergreenMeta,
      destinationUrl: 'https://www.the-anchor.pub/lunch-and-dinner',
      deliverySchedule: lunchSchedule,
    });

    expect(result).not.toHaveProperty('error');
    expect(generateCampaign).toHaveBeenCalledTimes(1);
    // The copy step gets the schedule, days in week order, for the prompt and the copy check.
    expect(generateCampaign).toHaveBeenCalledWith(expect.objectContaining({
      deliverySchedule: { days: ['tuesday', 'wednesday', 'thursday', 'friday'], startHour: 9, endHour: 14 },
    }));
  });

  describe('save-time copy re-check', () => {
    function payloadWithAds(ads: Array<{ name: string; headline: string; primary_text: string; description: string }>) {
      return {
        ...emptyPayload,
        ad_sets: [
          {
            name: 'Evergreen Test',
            phase_label: 'Evergreen Test',
            phase_start: '2026-09-15',
            phase_end: '2026-10-09',
            audience_description: 'Locals',
            targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
            placements: 'AUTO' as const,
            optimisation_goal: 'LINK_CLICKS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            ads: ads.map((ad, index) => ({
              ...ad,
              cta: 'BOOK_NOW' as const,
              creative_brief: 'Dish photo',
              angle: `Angle ${index + 1}`,
            })),
          },
        ],
      };
    }

    beforeEach(() => {
      // The draft insert and the ad set insert both resolve through .select().single().
      mockSingle.mockResolvedValue({ data: { id: 'row-id' }, error: null });
    });

    it('refuses hand-edited copy that names a day outside the schedule, before writing anything', async () => {
      const payload = payloadWithAds([
        { name: 'Burger lunch', headline: 'Lunch now served, Tue to Fri, 12 to 3', primary_text: 'Burgers from £11.', description: 'Book now' },
        { name: 'Wrap lunch', headline: 'Wraps £10, Mon to Fri', primary_text: 'A fish finger wrap is £10.', description: 'Book now' },
      ]);

      const result = await saveCampaignDraft(payload, { ...evergreenMeta, deliverySchedule: lunchSchedule });

      expect(result).toEqual({
        error: 'This campaign only shows Tuesday to Friday, 09:00 to 14:00, UK time, but some ad copy says otherwise: "Wrap lunch" (Mon). Edit the copy, then save again.',
      });
      expect(mockSupabase.insert).not.toHaveBeenCalled();
    });

    it('saves hand-edited copy that stays inside the schedule', async () => {
      const payload = payloadWithAds([
        { name: 'Burger lunch', headline: 'Lunch now served, Tue to Fri, 12 to 3', primary_text: 'Burgers from £11, Tuesday to Friday.', description: 'Book now' },
      ]);

      const result = await saveCampaignDraft(payload, { ...evergreenMeta, deliverySchedule: lunchSchedule });

      expect(result).toEqual({ campaignId: 'row-id' });
    });

    it('does not start enforcing the other generation checks on save', async () => {
      // A generic phrase and a raw URL fail generation checks, but save has never run them.
      const payload = payloadWithAds([
        { name: 'Burger lunch', headline: "Don't miss out on lunch", primary_text: 'See https://www.the-anchor.pub for Tuesday lunch.', description: 'Book now' },
      ]);

      const result = await saveCampaignDraft(payload, { ...evergreenMeta, deliverySchedule: lunchSchedule });

      expect(result).toEqual({ campaignId: 'row-id' });
    });

    it('does not check copy at all when there is no schedule', async () => {
      const payload = payloadWithAds([
        { name: 'Burger lunch', headline: 'Lunch Monday to Sunday', primary_text: 'Lunch every day.', description: 'Weekend treat' },
      ]);

      const result = await saveCampaignDraft(payload, { ...evergreenMeta, budgetType: 'DAILY', deliverySchedule: null });

      expect(result).toEqual({ campaignId: 'row-id' });
    });
  });
});
