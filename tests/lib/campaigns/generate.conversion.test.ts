/**
 * Conversion-focused generation contract:
 *  - the model is told whether the campaign optimises for booking conversions
 *  - the system prompt carries the conversion copy principles
 *  - over-length copy is trimmed at word boundaries, not mid-word
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

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

vi.mock('@/env', () => ({
  env: {
    server: { OPENAI_API_KEY: 'test-key' },
    client: {},
  },
}));

import { generateCampaign, trimToLimit } from '@/lib/campaigns/generate';

const basePayload = {
  objective: 'OUTCOME_SALES',
  rationale: 'r',
  campaign_name: 'c',
  special_ad_category: 'NONE',
  audience_keywords: ['pub quiz'],
  ad_sets: [
    {
      name: 'Run-up',
      phase_label: 'Run-up',
      phase_start: '2026-04-01',
      phase_end: '2026-04-30',
      audience_description: 'Local adults',
      targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
      placements: 'AUTO',
      optimisation_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      ads: [
        {
          name: 'Ad 1',
          headline: 'Quiz night Thursday',
          primary_text: 'Book a table for quiz night this Thursday.',
          description: 'Reserve seats',
          cta: 'BOOK_NOW',
          angle: 'Booking urgency',
          creative_brief: 'Bar scene',
        },
      ],
    },
  ],
};

const baseInput = {
  campaignKind: 'event' as const,
  promotionName: 'Quiz Night',
  problemBrief: 'Quiet Thursdays',
  venueName: 'The Anchor',
  venueLocation: 'Stanwell Moor',
  budgetAmount: 100,
  budgetType: 'DAILY' as const,
  phases: [{ phaseType: 'run-up' as const, phaseLabel: 'Run-up', phaseStart: '2026-04-01', phaseEnd: '2026-04-30', adsStopTime: null }],
};

describe('conversion context injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(basePayload) } }],
    });
  });

  it('tells the model the campaign optimises for booking conversions when trackable', async () => {
    await generateCampaign({ ...baseInput, destinationUrl: 'https://vip-club.uk/ma123' });

    const userPrompt = mockCreate.mock.calls[0]![0].messages[1].content as string;
    expect(userPrompt).toContain('Conversion context:');
    expect(userPrompt).toContain('OFFSITE Purchase conversions');
    const systemPrompt = mockCreate.mock.calls[0]![0].messages[0].content as string;
    expect(systemPrompt).toContain('CONVERSION COPY PRINCIPLES');
    expect(systemPrompt).toContain('Honest urgency');
    expect(systemPrompt).toContain('Price anchoring');
  });

  it('tells the model the campaign optimises for clicks when the destination is untrackable', async () => {
    await generateCampaign({
      ...baseInput,
      campaignKind: 'evergreen' as never,
      destinationUrl: 'https://example.com/menu',
    });

    const userPrompt = mockCreate.mock.calls[0]![0].messages[1].content as string;
    expect(userPrompt).toContain('optimises for link clicks');
    expect(userPrompt).not.toContain('OFFSITE Purchase conversions');
  });
});

describe('trimToLimit', () => {
  it('returns text under the limit unchanged', () => {
    expect(trimToLimit('Book a table', 40)).toBe('Book a table');
  });

  it('trims at the last word boundary within the limit', () => {
    const text = 'Sunday roast with all the trimmings and live jazz';
    const trimmed = trimToLimit(text, 40);
    expect(trimmed.length).toBeLessThanOrEqual(40);
    expect(trimmed).toBe('Sunday roast with all the trimmings and');
    expect(text.startsWith(trimmed)).toBe(true);
  });

  it('strips dangling punctuation after the cut', () => {
    expect(trimToLimit('Two courses for fifteen pounds, every Friday', 31)).toBe('Two courses for fifteen pounds');
  });

  it('falls back to a hard cut when there is no usable word boundary', () => {
    const text = `${'a'.repeat(50)} end`;
    expect(trimToLimit(text, 40)).toBe('a'.repeat(40));
  });
});
