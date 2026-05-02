import { describe, expect, it } from 'vitest';

import { applyDeterministicCampaignNames, buildInterestSummary } from '@/lib/campaigns/naming';
import type { AiCampaignPayload } from '@/types/campaigns';

const basePayload: AiCampaignPayload = {
  objective: 'OUTCOME_TRAFFIC',
  rationale: 'Test rationale',
  campaign_name: 'Campaign',
  special_ad_category: 'NONE',
  ad_sets: [{
    name: 'AI ad set name',
    phase_label: 'Run-up',
    phase_start: '2026-05-01',
    phase_end: '2026-05-07',
    audience_description: 'Local adults',
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
    placements: 'AUTO',
    optimisation_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads: [
      {
        name: 'Variation 1',
        headline: 'Headline',
        primary_text: 'Primary',
        description: 'Description',
        cta: 'LEARN_MORE',
        angle: 'Jackpot & prize mechanic',
        creative_brief: 'Brief',
      },
      {
        name: 'Variation 2',
        headline: 'Headline',
        primary_text: 'Primary',
        description: 'Description',
        cta: 'LEARN_MORE',
        angle: 'Social & group night',
        creative_brief: 'Brief',
      },
    ],
  }],
};

describe('campaign naming helpers', () => {
  it('names local-only ad sets and ads deterministically', () => {
    const result = applyDeterministicCampaignNames(basePayload, {
      audienceMode: 'local_only',
      geoRadiusMiles: 3,
      resolvedInterests: [],
    });

    expect(result.ad_sets[0].name).toBe('Run-up | Local only | 3mi | Local only');
    expect(result.ad_sets[0].ads[0].name).toBe('Run-up | Jackpot & prize mechanic | Var 1');
    expect(result.ad_sets[0].ads[1].name).toBe('Run-up | Social & group night | Var 2');
  });

  it('summarises resolved interests in local plus interests names', () => {
    const result = applyDeterministicCampaignNames(basePayload, {
      audienceMode: 'local_interests',
      geoRadiusMiles: 5,
      resolvedInterests: [
        { id: '1', name: 'Pub quiz' },
        { id: '2', name: 'Cocktails' },
        { id: '3', name: 'Private dining' },
      ],
    });

    expect(result.ad_sets[0].name).toBe('Run-up | Local + interests | 5mi | Pub quiz + Cocktails +1 more');
    expect(buildInterestSummary('local_interests', [{ id: '1', name: 'Pub quiz' }])).toBe('Pub quiz');
  });
});
