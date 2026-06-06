import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  collectManagementMetaAdVariantsFromPayload,
  ensureManagementMetaAdVariantLinks,
  resolveManagementMetaAdVariantShortUrl,
} from '@/lib/campaigns/management-tracking';
import { createManagementMetaAdsLink } from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import type { AiCampaignPayload } from '@/types/campaigns';

describe('management campaign tracking links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getManagementConnectionConfig).mockResolvedValue({
      baseUrl: 'https://management.example.com',
      apiKey: 'key',
      enabled: true,
    });
  });

  it('collects generated ad UTM keys as management short-link variants', () => {
    const payload: AiCampaignPayload = {
      objective: 'OUTCOME_SALES',
      rationale: 'Test',
      campaign_name: 'Music Bingo',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Launch',
          phase_label: 'Launch',
          phase_start: '2026-06-01',
          phase_end: '2026-06-07',
          audience_description: 'Local adults',
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
          placements: 'AUTO',
          optimisation_goal: 'OFFSITE_CONVERSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Venue photo',
              headline: 'Book music bingo',
              primary_text: 'Music bingo is back.',
              description: 'Book now',
              cta: 'BOOK_NOW',
              creative_brief: 'Venue photo',
              angle: 'booking',
              creative_format: 'venue_photo',
              creative_variant_key: 'music_bingo__launch__venue_photo',
              utm_content_key: 'ad_music_bingo__launch__venue_photo',
            },
          ],
        },
      ],
    };

    expect(collectManagementMetaAdVariantsFromPayload(payload)).toEqual([
      expect.objectContaining({
        utmContent: 'ad_music_bingo__launch__venue_photo',
        name: 'Music Bingo / Launch / Venue photo',
      }),
    ]);
  });

  it('creates missing management variants and stores them on the source snapshot', async () => {
    vi.mocked(createManagementMetaAdsLink).mockResolvedValue({
      shortUrl: 'https://l.the-anchor.pub/ma123',
      shortCode: 'ma123',
      destinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=paid_social&utm_campaign=event_music_bingo&utm_content=meta_ads_main',
      utmDestinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=paid_social&utm_campaign=event_music_bingo&utm_content=meta_ads_main',
      alreadyExists: true,
      variants: [
        {
          shortUrl: 'https://l.the-anchor.pub/mv123',
          shortCode: 'mv123',
          destinationUrl: 'https://www.the-anchor.pub/events/music-bingo',
          utmDestinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=paid_social&utm_campaign=event_music_bingo&utm_content=ad_one',
          utmContent: 'ad_one',
          parentShortCode: 'ma123',
          alreadyExists: false,
        },
      ],
    });

    const snapshot = await ensureManagementMetaAdVariantLinks({
      campaignKind: 'event',
      campaignName: 'Music Bingo',
      destinationUrl: 'https://l.the-anchor.pub/ma123',
      sourceSnapshot: {
        eventId: 'event-1',
        metaAdsShortLink: 'https://l.the-anchor.pub/ma123',
        metaAdsDestinationUrl: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=paid_social&utm_campaign=event_music_bingo&utm_content=meta_ads_main',
      },
      variants: [
        {
          utmContent: 'ad_one',
          name: 'Ad one',
          metadata: { ad_name: 'Ad one' },
        },
      ],
    });

    expect(createManagementMetaAdsLink).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventId: 'event-1',
        parentShortCode: 'ma123',
        variants: [expect.objectContaining({ utmContent: 'ad_one' })],
      }),
    );
    expect(resolveManagementMetaAdVariantShortUrl(snapshot, 'ad_one')).toBe('https://l.the-anchor.pub/mv123');
  });
});
