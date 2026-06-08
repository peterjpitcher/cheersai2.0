import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiCampaignPayload, FoodAdWindow } from '@/types/campaigns';

// Module-level reference so the factory closure can share it with tests.
const mockCreate = vi.fn();

// Mock OpenAI module — default export must be a real constructor (function, not arrow).
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

// Mock env.
vi.mock('@/env', () => ({
  env: {
    server: { OPENAI_API_KEY: 'test-key' },
    client: {},
  },
}));

import { generateCampaign } from '@/lib/campaigns/generate';

// A single Sunday-roast morning_commit window (day-of) and a weekday lunch window.
const sundayMorningWindow: FoodAdWindow = {
  serviceKey: 'sunday_roast',
  decisionStage: 'morning_commit',
  runDay: 'sunday',
  runDate: '2026-06-14',
  startsAtLocal: '08:30',
  endsAtLocal: '11:30',
  serviceDate: '2026-06-14',
  serviceDateOffsetDays: 0,
  budgetWeight: 30,
  copyIntent: 'Roasts served from 1pm today.',
  windowKey: 'sunday_roast_morning',
  enabled: true,
};

const weekdayLunchWindow: FoodAdWindow = {
  serviceKey: 'weekday_dinner',
  decisionStage: 'lunch_decision',
  runDay: 'tuesday',
  runDate: '2026-06-09',
  startsAtLocal: '11:00',
  endsAtLocal: '13:30',
  serviceDate: '2026-06-09',
  serviceDateOffsetDays: 0,
  budgetWeight: 55,
  copyIntent: "Get tonight's dinner decided during the lunch break.",
  windowKey: 'weekday_lunch_decision',
  enabled: true,
};

function makeFoodAdSet(
  overrides: Partial<{ headline: string; primary_text: string; cta: string; name: string }> = {},
): unknown {
  return {
    name: overrides.name ?? 'Window',
    phase_label: 'Window',
    phase_start: '2026-06-14',
    phase_end: null,
    audience_description: 'Local diners',
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
    placements: 'AUTO',
    optimisation_goal: 'OFFSITE_CONVERSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads: [
      {
        name: 'Ad 1',
        headline: overrides.headline ?? 'Roast table',
        primary_text:
          overrides.primary_text ?? 'Book a table for our Sunday roast, served from 1pm. Hand-carved meats and all the trimmings.',
        description: 'Reserve now',
        cta: overrides.cta ?? 'BOOK_NOW',
        angle: 'Booking urgency',
        creative_brief: 'Sunday roast spread',
      },
    ],
  };
}

const baseFoodInput = {
  campaignKind: 'food_booking' as const,
  promotionName: 'Sunday Roast Bookings',
  problemBrief: 'Fill the roast service.',
  destinationUrl: 'https://www.the-anchor.pub/book',
  venueName: 'The Anchor',
  venueLocation: 'Stanwell Moor',
  budgetAmount: 200,
  budgetType: 'LIFETIME' as const,
  foodHooks: ['Hand-carved roast', 'Cauliflower cheese'],
};

describe('generateCampaign — food_booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds per-window prompt context with service name, date, window times, hooks and booking URL', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        objective: 'OUTCOME_SALES',
        rationale: 'Roast push.',
        campaign_name: 'Roast Bookings',
        special_ad_category: 'NONE',
        audience_keywords: ['sunday roast', 'family lunch'],
        ad_sets: [makeFoodAdSet()],
      }) } }],
    });

    await generateCampaign({
      ...baseFoodInput,
      phases: [{ phaseType: 'day-of', phaseLabel: 'Sunday roast morning', phaseStart: '2026-06-14', phaseEnd: null, adsStopTime: '11:30' }],
      foodWindows: [sundayMorningWindow],
    });

    const prompt = mockCreate.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(prompt).toContain('Sunday roast'); // human service label
    expect(prompt).toContain('2026-06-14'); // service date
    expect(prompt).toContain('08:30');
    expect(prompt).toContain('11:30'); // window run times
    expect(prompt).toContain('https://www.the-anchor.pub/book'); // booking URL
    expect(prompt).toContain('Hand-carved roast'); // food hook
    expect(prompt).toContain('morning_commit'); // decision stage
    // Last orders is supplied only for Sunday day-of windows.
    expect(prompt).toContain('17:30');
  });

  it('does not surface last orders for non-Sunday-day-of windows', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        objective: 'OUTCOME_SALES',
        rationale: 'Weekday push.',
        campaign_name: 'Weekday Dinner',
        special_ad_category: 'NONE',
        audience_keywords: ['after work dinner'],
        ad_sets: [makeFoodAdSet({
          headline: 'Dinner table',
          primary_text: 'Book a table for dinner tonight, served from 4pm. After-work plates and a warm welcome.',
        })],
      }) } }],
    });

    await generateCampaign({
      ...baseFoodInput,
      phases: [{ phaseType: 'day-of', phaseLabel: 'Weekday lunch decision', phaseStart: '2026-06-09', phaseEnd: null, adsStopTime: '13:30' }],
      foodWindows: [weekdayLunchWindow],
    });

    const prompt = mockCreate.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    // The general guidance sentence may mention "last orders", but no last-orders
    // TIME should be injected for a non-Sunday-day-of window.
    expect(prompt).not.toMatch(/last orders \d/i);
  });

  it('forces BOOK_NOW on every food ad even if the model returns another CTA', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        objective: 'OUTCOME_SALES',
        rationale: 'Roast push.',
        campaign_name: 'Roast Bookings',
        special_ad_category: 'NONE',
        audience_keywords: ['sunday roast'],
        ad_sets: [makeFoodAdSet({ cta: 'LEARN_MORE' })],
      }) } }],
    });

    const result: AiCampaignPayload = await generateCampaign({
      ...baseFoodInput,
      phases: [{ phaseType: 'day-of', phaseLabel: 'Sunday roast morning', phaseStart: '2026-06-14', phaseEnd: null, adsStopTime: '11:30' }],
      foodWindows: [sundayMorningWindow],
    });

    expect(result.ad_sets[0].ads.every((ad) => ad.cta === 'BOOK_NOW')).toBe(true);
  });

  it('fails when the model returns roast copy that says "tonight"', async () => {
    // Return the SAME broken copy on both the initial call and the correction retry
    // so the food hard rule (no "tonight" for roast) keeps blocking.
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        objective: 'OUTCOME_SALES',
        rationale: 'Roast push.',
        campaign_name: 'Roast Bookings',
        special_ad_category: 'NONE',
        audience_keywords: ['sunday roast'],
        ad_sets: [makeFoodAdSet({
          headline: 'Roast tonight',
          primary_text: 'Book your Sunday roast table tonight — hand-carved meats served from 1pm.',
        })],
      }) } }],
    });

    await expect(
      generateCampaign({
        ...baseFoodInput,
        phases: [{ phaseType: 'day-of', phaseLabel: 'Sunday roast morning', phaseStart: '2026-06-14', phaseEnd: null, adsStopTime: '11:30' }],
        foodWindows: [sundayMorningWindow],
      }),
    ).rejects.toThrow();
  });
});
