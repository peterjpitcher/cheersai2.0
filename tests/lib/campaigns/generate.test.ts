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
  angle: 'Affordability',
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
      audience_keywords: ['Pub quiz', '6003139266461', 'Live music'],
      ad_sets: [
        {
          name: 'Local 25-45',
          phase_label: 'Run-up',
          phase_start: '2026-04-01',
          phase_end: '2026-04-30',
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
              angle: 'Social & group night',
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
      campaignKind: 'event',
      promotionName: 'Tuesday Night Boost',
      problemBrief: 'We are dead on Tuesday nights',
      destinationUrl: 'https://vip-club.uk/ma123',
      venueName: 'The Anchor',
      venueLocation: 'London',
      budgetAmount: 500,
      budgetType: 'DAILY',
      phases: [{ phaseType: 'run-up', phaseLabel: 'Run-up', phaseStart: '2026-04-01', phaseEnd: '2026-04-30', adsStopTime: null }],
    });

    expect(result.objective).toBe('OUTCOME_TRAFFIC');
    expect(result.audience_keywords).toEqual(['Pub quiz', 'Live music']);
    expect(result.ad_sets).toHaveLength(1);
    expect(result.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });

  it('should throw if AI returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    await expect(
      generateCampaign({
        campaignKind: 'event',
        promotionName: 'Test',
        problemBrief: 'test',
        destinationUrl: 'https://vip-club.uk/ma123',
        venueName: 'Test',
        venueLocation: 'London',
        budgetAmount: 100,
        budgetType: 'DAILY',
        phases: [{ phaseType: 'run-up', phaseLabel: 'Run-up', phaseStart: '2026-04-01', phaseEnd: null, adsStopTime: null }],
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
        phase_label: 'Run-up',
        phase_start: '2026-04-01',
        phase_end: null,
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
          angle: 'Value for money',
          creative_brief: 'Test image',
        }],
      }],
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockPayload) } }],
    });

    const result = await generateCampaign({
      campaignKind: 'event',
      promotionName: 'Test',
      problemBrief: 'test',
      destinationUrl: 'https://vip-club.uk/ma123',
      venueName: 'Test',
      venueLocation: 'London',
      budgetAmount: 100,
      budgetType: 'DAILY',
      phases: [{ phaseType: 'run-up', phaseLabel: 'Run-up', phaseStart: '2026-04-01', phaseEnd: null, adsStopTime: null }],
    });

    expect(result.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });

  it('adds aggregate event booking insights to event campaign prompts only', async () => {
    const mockPayload = {
      objective: 'OUTCOME_TRAFFIC',
      rationale: 'Use proven booking patterns.',
      campaign_name: 'Quiz Push',
      special_ad_category: 'NONE',
      audience_keywords: ['pub quiz', 'local nightlife'],
      ad_sets: [{
        name: 'Run-up',
        phase_label: 'Run-up',
        phase_start: '2026-04-01',
        phase_end: '2026-04-07',
        audience_description: 'Local adults',
        targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
        placements: 'AUTO',
        optimisation_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ads: [{
          name: 'Ad 1',
          headline: 'Quiz Night Jackpot',
          primary_text: 'A specific hook about the jackpot and a clear reason to book seats with friends before the quiz fills up.',
          description: 'Book your seats',
          cta: 'BOOK_NOW',
          angle: 'Jackpot & prize mechanic',
          creative_brief: 'Quiz crowd around a table',
        }],
      }],
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockPayload) } }],
    });

    await generateCampaign({
      campaignKind: 'event',
      promotionName: 'Quiz Night',
      problemBrief: 'Promote the quiz.',
      destinationUrl: 'https://vip-club.uk/ma-quiz',
      venueName: 'The Anchor',
      venueLocation: 'Horton',
      budgetAmount: 100,
      budgetType: 'LIFETIME',
      phases: [{ phaseType: 'run-up', phaseLabel: 'Run-up', phaseStart: '2026-04-01', phaseEnd: '2026-04-07', adsStopTime: null }],
      eventBookingInsights: 'Last 90 days: 12 tracked event bookings. Top event categories: Quiz (8 bookings).',
    });

    const eventPrompt = mockCreate.mock.calls[0]?.[0]?.messages?.[1]?.content;
    expect(eventPrompt).toContain('Historical booking insight summary');
    expect(eventPrompt).toContain('Top event categories: Quiz');
  });
});

describe('enforceAdSetConstraints', () => {
  it('trims ad sets with more than 3 ads to exactly 3', () => {
    const adSet = makeAdSet(Array.from({ length: 7 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
  });

  it('pads ad sets with fewer than 3 ads by duplicating the last entry', () => {
    const adSet = makeAdSet([makeAd({ name: 'Only One' })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
    expect(result.ads[2]).toEqual(result.ads[0]);
  });

  it('leaves ad sets with exactly 3 ads unchanged', () => {
    const adSet = makeAdSet(Array.from({ length: 3 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
  });

  it('truncates headline to 40 characters', () => {
    const longHeadline = 'A'.repeat(50);
    const adSet = makeAdSet([makeAd({ headline: longHeadline })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].headline).toHaveLength(40);
  });

  it('truncates primary_text to 350 characters', () => {
    const long = 'B'.repeat(400);
    const adSet = makeAdSet([makeAd({ primary_text: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].primary_text).toHaveLength(350);
  });

  it('truncates description to 25 characters', () => {
    const long = 'C'.repeat(30);
    const adSet = makeAdSet([makeAd({ description: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].description).toHaveLength(25);
  });

  it('throws if the ads array is empty', () => {
    const adSet = makeAdSet([]);
    expect(() => enforceAdSetConstraints(adSet)).toThrow('returned no ads from AI');
  });
});
