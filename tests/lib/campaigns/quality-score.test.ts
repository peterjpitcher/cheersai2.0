import { describe, expect, it } from 'vitest';

import { buildCampaignQualitySnapshot } from '@/lib/campaigns/quality-score';
import type { AiCampaignPayload } from '@/types/campaigns';

const adSet: AiCampaignPayload['ad_sets'][number] = {
  name: 'Run-up',
  phase_label: 'Run-up',
  phase_start: '2026-05-01',
  phase_end: '2026-05-07',
  audience_description: 'Local adults',
  targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
  placements: 'AUTO',
  optimisation_goal: 'OFFSITE_CONVERSIONS',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  ads: [
    {
      name: 'Ad 1',
      headline: 'Book quiz seats',
      primary_text: 'Book quiz seats now.',
      description: 'Book now',
      cta: 'BOOK_NOW',
      creative_brief: 'Venue photo',
      angle: 'Booking urgency',
      creative_format: 'venue_photo',
      utm_content_key: 'ad-1',
    },
    {
      name: 'Ad 2',
      headline: 'Bring the group',
      primary_text: 'Reserve a table for friends.',
      description: 'Reserve now',
      cta: 'BOOK_NOW',
      creative_brief: 'People social',
      angle: 'Social plan',
      creative_format: 'people_social',
      utm_content_key: 'ad-2',
    },
    {
      name: 'Ad 3',
      headline: 'Cash on arrival',
      primary_text: 'No payment now, pay on arrival.',
      description: 'Book seats',
      cta: 'BOOK_NOW',
      creative_brief: 'Event detail',
      angle: 'Payment reassurance',
      creative_format: 'event_detail',
      utm_content_key: 'ad-3',
    },
  ],
};

describe('campaign quality score', () => {
  it('marks conversion-ready campaigns with ad-level attribution as ready', () => {
    const snapshot = buildCampaignQualitySnapshot({
      campaignKind: 'event',
      destinationUrl: 'https://www.the-anchor.pub/events/quiz?utm_source=facebook',
      budgetAmount: 30,
      budgetType: 'LIFETIME',
      audienceMode: 'local_only',
      conversionReady: true,
      capiReady: true,
      adSets: [adSet],
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.score).toBe(100);
  });

  it('blocks campaigns missing conversion setup or ad-level UTM keys', () => {
    const snapshot = buildCampaignQualitySnapshot({
      campaignKind: 'event',
      destinationUrl: 'https://www.the-anchor.pub/events/quiz',
      budgetAmount: 10,
      budgetType: 'LIFETIME',
      audienceMode: 'local_only',
      conversionReady: false,
      capiReady: false,
      adSets: [{ ...adSet, ads: [{ ...adSet.ads[0]!, utm_content_key: undefined }] }],
    });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'conversion_setup_missing',
      'missing_ad_utm',
      'capi_not_ready',
      'low_lifetime_budget',
    ]));
  });
});
