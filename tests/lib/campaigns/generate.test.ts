import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiCampaignPayload } from '@/types/campaigns';

// Module-level reference so the factory closure can share it with tests
const mockCreate = vi.fn();

// Mock OpenAI module — default export must be a real constructor (function, not arrow)
vi.mock('openai', () => {
  function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  }
  return { default: MockOpenAI };
});

// Mock env
vi.mock('@/env', () => ({
  env: {
    server: { OPENAI_API_KEY: 'test-key' },
    client: {},
  },
}));

import { generateCampaign, enforceAdSetConstraints } from '@/lib/campaigns/generate';

// ---------------------------------------------------------------------------
// Helpers for enforceAdSetConstraints tests
// ---------------------------------------------------------------------------
const makeAd = (overrides?: object) => ({
  name: 'Ad',
  headline: 'Hello',
  primary_text: 'Buy now',
  description: 'Great deal',
  cta: 'LEARN_MORE' as const,
  creative_brief: 'Show happy people',
  ...overrides,
});

const makeAdSet = (ads: ReturnType<typeof makeAd>[]): AiCampaignPayload['ad_sets'][number] => ({
  name: 'Phase 1',
  phase_label: 'Early Awareness',
  phase_start: '2026-03-01',
  phase_end: '2026-03-07',
  audience_description: 'Local adults',
  targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
  placements: 'AUTO' as const,
  optimisation_goal: 'REACH',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  ads,
});

describe('generateCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a parsed AI campaign payload', async () => {
    const mockPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Lead gen is best for this brief.',
      campaign_name: 'Tuesday Night Boost',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Local 25-45',
          audience_description: 'Local adults aged 25-45',
          targeting: {
            age_min: 25,
            age_max: 45,
            geo_locations: { countries: ['GB'] },
          },
          placements: 'AUTO',
          optimisation_goal: 'LEAD_GENERATION',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Quiet Tuesdays? Not Here',
              primary_text: 'Join us every Tuesday for live music.',
              description: 'Book your table',
              cta: 'BOOK_NOW',
              creative_brief: 'Lively bar scene, warm lighting',
            },
          ],
        },
      ],
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockPayload) } }],
    });

    const result = await generateCampaign({
      problemBrief: 'We are dead on Tuesday nights',
      venueName: 'The Anchor',
      venueLocation: 'London',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });

    expect(result.objective).toBe('OUTCOME_LEADS');
    expect(result.ad_sets).toHaveLength(1);
    expect(result.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });

  it('should throw if AI returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    await expect(
      generateCampaign({
        problemBrief: 'test',
        venueName: 'Test',
        venueLocation: 'London',
        budgetAmount: 100,
        budgetType: 'DAILY',
        startDate: '2026-04-01',
        endDate: null,
      })
    ).rejects.toThrow();
  });

  it('should truncate headlines longer than 40 chars', async () => {
    const longHeadline = 'A'.repeat(50); // 50 chars
    const mockPayload = {
      objective: 'OUTCOME_AWARENESS',
      rationale: 'Test',
      campaign_name: 'Test',
      special_ad_category: 'NONE',
      ad_sets: [{
        name: 'Set 1',
        audience_description: 'Test',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO',
        optimisation_goal: 'REACH',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ads: [{
          name: 'Ad 1',
          headline: longHeadline,
          primary_text: 'Test text',
          description: 'Test',
          cta: 'LEARN_MORE',
          creative_brief: 'Test image',
        }],
      }],
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockPayload) } }],
    });

    const result = await generateCampaign({
      problemBrief: 'test',
      venueName: 'Test',
      venueLocation: 'London',
      budgetAmount: 100,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: null,
    });

    expect(result.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });
});

describe('enforceAdSetConstraints', () => {
  it('trims ad sets with more than 5 ads to exactly 5', () => {
    const adSet = makeAdSet(Array.from({ length: 7 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
  });

  it('pads ad sets with fewer than 5 ads by duplicating the last entry', () => {
    const adSet = makeAdSet([makeAd({ name: 'Only One' })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
    expect(result.ads[4]).toEqual(result.ads[0]);
  });

  it('leaves ad sets with exactly 5 ads unchanged', () => {
    const adSet = makeAdSet(Array.from({ length: 5 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
  });

  it('truncates headline to 40 characters', () => {
    const longHeadline = 'A'.repeat(50);
    const adSet = makeAdSet([makeAd({ headline: longHeadline })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].headline).toHaveLength(40);
  });

  it('truncates primary_text to 125 characters', () => {
    const long = 'B'.repeat(130);
    const adSet = makeAdSet([makeAd({ primary_text: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].primary_text).toHaveLength(125);
  });

  it('truncates description to 25 characters', () => {
    const long = 'C'.repeat(30);
    const adSet = makeAdSet([makeAd({ description: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].description).toHaveLength(25);
  });
});
