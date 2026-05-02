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
  searchMetaGeoLocations: vi.fn(),
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
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, maybeSingle: mockMaybeSingle, data: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
  // Reset chains
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, maybeSingle: mockMaybeSingle, data: [] });
  mockMaybeSingle.mockResolvedValue({ data: null });
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
        geo_radius_miles: 3,
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
        geo_radius_miles: 3,
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
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
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '12345', name: 'Leatherhead', type: 'city', country_code: 'GB', region: 'Surrey' },
    ]);
    // Update campaign with meta_campaign_id
    mockUpdate.mockReturnValue({ eq: mockEq });

    const result = await publishCampaign('campaign-123');
    expect(marketing.createMetaCampaign).toHaveBeenCalled();
    expect(marketing.createMetaAd).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('uses local Meta city targeting when venue location resolves', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 100,
        geo_radius_miles: 3,
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead, Surrey' },
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Local Test',
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
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
    vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
    vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_123' });
    vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_123' });
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '12345', name: 'Leatherhead', type: 'city', country_code: 'GB', region: 'Surrey' },
    ]);

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.searchMetaGeoLocations).toHaveBeenCalledWith('token', 'Leatherhead, Surrey', {
      countryCode: 'GB',
      limit: 10,
    });
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        targeting: {
          age_min: 18,
          age_max: 65,
          geo_locations: {
            cities: [{ key: '12345', radius: 3, distance_unit: 'mile' }],
            location_types: ['home', 'recent'],
          },
        },
      }),
    );
  });

  it('uses coordinate pin targeting when Meta Ads coordinates are configured', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 100,
        geo_radius_miles: 5,
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        venue_location: 'The Anchor, Horton Road, TW19 6AQ',
        venue_latitude: '51.4625',
        venue_longitude: '-0.5021',
      },
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Coordinate Test',
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
    mockSingle.mockResolvedValueOnce({ data: { storage_path: 'asset.jpg' } });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
    vi.mocked(marketing.uploadMetaImage).mockResolvedValue({ hash: 'image_hash' });
    vi.mocked(marketing.createMetaAdCreative).mockResolvedValue({ id: 'creative_123' });
    vi.mocked(marketing.createMetaAd).mockResolvedValue({ id: 'meta_ad_123' });

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.searchMetaGeoLocations).not.toHaveBeenCalled();
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        targeting: {
          age_min: 18,
          age_max: 65,
          geo_locations: {
            custom_locations: [
              {
                latitude: 51.4625,
                longitude: -0.5021,
                radius: 5,
                distance_unit: 'mile',
                country: 'GB',
              },
            ],
            location_types: ['home', 'recent'],
          },
        },
      }),
    );
  });

  it('adds resolved interests inside flexible_spec for local plus interests campaigns', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 30,
        geo_radius_miles: 3,
        audience_mode: 'local_interests',
        resolved_interests: [{ id: '6003139266461', name: 'Pub quiz' }],
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Interest Test',
          targeting: {
            age_min: 18,
            age_max: 65,
            geo_locations: { countries: ['GB'] },
            interests: [{ id: 'invented', name: 'Invented' }],
          },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-04-01',
          phase_end: '2026-04-10',
          adset_media_asset_id: null,
          ads: [
            {
              id: 'ad-1',
              meta_ad_id: 'existing-ad-1',
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

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    vi.mocked(marketing.createMetaAdSet).mockResolvedValue({ id: 'meta_adset_123' });
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '12345', name: 'Leatherhead', type: 'city', country_code: 'GB', region: 'Surrey' },
    ]);

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.createMetaAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        targeting: {
          age_min: 18,
          age_max: 65,
          geo_locations: {
            cities: [{ key: '12345', radius: 3, distance_unit: 'mile' }],
            location_types: ['home', 'recent'],
          },
          flexible_spec: [
            { interests: [{ id: '6003139266461', name: 'Pub quiz' }] },
          ],
        },
      }),
    );
  });

  it('blocks local plus interests publishing when no interests resolved', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 30,
        geo_radius_miles: 3,
        audience_mode: 'local_interests',
        resolved_interests: [],
        start_date: '2026-04-01',
        end_date: '2026-04-10',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({
      data: { venue_location: 'Leatherhead' },
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Interest Test',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-04-01',
          phase_end: '2026-04-10',
          adset_media_asset_id: null,
          ads: [
            {
              id: 'ad-1',
              meta_ad_id: 'existing-ad-1',
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
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '12345', name: 'Leatherhead', type: 'city', country_code: 'GB', region: 'Surrey' },
    ]);

    const result = await publishCampaign('campaign-123');

    expect(result.error).toContain('No Meta interests');
    expect(marketing.createMetaCampaign).not.toHaveBeenCalled();
  });

  it('allocates total campaign budget across event phase ad sets', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 40,
        geo_radius_miles: 3,
        start_date: '2026-05-08',
        end_date: '2026-05-15',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({ data: { venue_location: 'Leatherhead' } });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: ['Run-up', 'Day Before', 'Day Of'].map((phase, index) => ({
        id: `adset-${index + 1}`,
        meta_adset_id: null,
        name: `${phase} — Test`,
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        optimisation_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        budget_amount: null,
        phase_start: index === 0 ? '2026-05-08' : index === 1 ? '2026-05-14' : '2026-05-15',
        phase_end: index === 0 ? '2026-05-13' : null,
        adset_media_asset_id: null,
        ads_stop_time: index === 2 ? '19:00' : null,
        ads: [
          {
            id: `ad-${index + 1}`,
            meta_ad_id: `existing-ad-${index + 1}`,
            name: `Ad ${index + 1}`,
            headline: 'Test',
            primary_text: 'Primary text',
            description: 'Description',
            cta: 'LEARN_MORE',
            media_asset_id: null,
          },
        ],
      })),
    });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    vi.mocked(marketing.createMetaAdSet)
      .mockResolvedValueOnce({ id: 'meta_adset_1' })
      .mockResolvedValueOnce({ id: 'meta_adset_2' })
      .mockResolvedValueOnce({ id: 'meta_adset_3' });
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '12345', name: 'Leatherhead', type: 'city', country_code: 'GB', region: 'Surrey' },
    ]);

    const result = await publishCampaign('campaign-123');

    expect(result.success).toBe(true);
    expect(marketing.createMetaAdSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      lifetimeBudget: 24,
      startTime: '2026-05-07T23:00:00.000Z',
      endTime: '2026-05-13T23:00:00.000Z',
    }));
    expect(marketing.createMetaAdSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
      lifetimeBudget: 8,
      startTime: '2026-05-13T23:00:00.000Z',
      endTime: '2026-05-14T23:00:00.000Z',
    }));
    expect(marketing.createMetaAdSet).toHaveBeenNthCalledWith(3, expect.objectContaining({
      lifetimeBudget: 8,
      startTime: '2026-05-14T23:00:00.000Z',
      endTime: '2026-05-15T18:00:00.000Z',
    }));
  });

  it('blocks publishing when venue location is missing', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 40,
        geo_radius_miles: 3,
        start_date: '2026-05-08',
        end_date: '2026-05-15',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Local Test',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-05-08',
          phase_end: '2026-05-15',
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

    const result = await publishCampaign('campaign-123');

    expect(result.error).toContain('latitude and longitude');
    expect(marketing.searchMetaGeoLocations).not.toHaveBeenCalled();
    expect(marketing.createMetaCampaign).not.toHaveBeenCalled();
  });

  it('blocks publishing when Meta cannot resolve a local town or city', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        account_id: 'account-123',
        name: 'Test',
        objective: 'OUTCOME_TRAFFIC',
        special_ad_category: 'NONE',
        budget_type: 'LIFETIME',
        budget_amount: 40,
        geo_radius_miles: 1,
        start_date: '2026-05-08',
        end_date: '2026-05-15',
        destination_url: 'https://vip-club.uk/ma123',
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
    mockMaybeSingle.mockResolvedValueOnce({ data: { venue_location: 'Surrey' } });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      data: [
        {
          id: 'adset-1',
          meta_adset_id: null,
          name: 'Local Test',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          optimisation_goal: 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          budget_amount: null,
          phase_start: '2026-05-08',
          phase_end: '2026-05-15',
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
    vi.mocked(marketing.searchMetaGeoLocations).mockResolvedValue([
      { key: '987', name: 'Surrey', type: 'region', country_code: 'GB' },
    ]);

    const result = await publishCampaign('campaign-123');

    expect(result.error).toContain('UK town or city');
    expect(marketing.createMetaCampaign).not.toHaveBeenCalled();
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
        geo_radius_miles: 3,
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
