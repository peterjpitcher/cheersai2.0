import { describe, it, expect } from 'vitest';
import type { AiCampaignPayload } from '@/types/campaigns';

describe('AiCampaignPayload', () => {
  it('should accept a valid payload with correct objective and headline length', () => {
    const payload: AiCampaignPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Drive lead generation through targeted ads.',
      campaign_name: 'Summer Leads Campaign',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Ad Set 1',
          audience_description: 'Local adults aged 25-45',
          targeting: {
            age_min: 25,
            age_max: 45,
            geo_locations: {
              countries: ['GB'],
            },
          },
          placements: 'AUTO',
          optimisation_goal: 'LEAD_GENERATION',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Get a free quote today',
              primary_text: 'Find out how we can help your business grow.',
              description: 'Limited time offer — contact us now.',
              cta: 'GET_QUOTE',
              creative_brief: 'Use brand colours with a clear CTA button.',
            },
          ],
        },
      ],
    };

    expect(payload.objective).toBe('OUTCOME_LEADS');
    expect(payload.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });
});
