import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { generateCampaign } from '@/lib/campaigns/generate';

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
