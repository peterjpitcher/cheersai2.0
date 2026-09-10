import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiCampaignPayload, DeliverySchedule } from '@/types/campaigns';

// Evergreen copy with a delivery schedule (tasks/SPEC-evergreen-delivery-schedule.md).
// OpenAI is mocked, as in tests/lib/campaigns/generate.test.ts.
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

import { generateCampaign, validateCampaignCopy } from '@/lib/campaigns/generate';

const LUNCH: DeliverySchedule = {
  days: ['tuesday', 'wednesday', 'thursday', 'friday'],
  startHour: 9,
  endHour: 14,
};

const baseInput = {
  campaignKind: 'evergreen' as const,
  promotionName: 'Weekday Lunch',
  problemBrief: 'We now serve lunch Tuesday to Friday, 12pm to 3pm. Burgers from £11.',
  destinationUrl: 'https://l.the-anchor.pub/ma-lunch',
  venueName: 'The Anchor',
  venueLocation: 'Stanwell Moor',
  budgetAmount: 180,
  budgetType: 'LIFETIME' as const,
  phases: [{
    phaseType: 'evergreen' as const,
    phaseLabel: 'Evergreen Test',
    phaseStart: '2026-09-15',
    phaseEnd: '2026-10-09',
    adsStopTime: null,
  }],
};

type AdCopy = { headline: string; primary_text: string; description: string };

function evergreenPayload(ads: AdCopy[]) {
  return {
    objective: 'OUTCOME_TRAFFIC',
    rationale: 'Launch weekday lunch.',
    campaign_name: 'Weekday Lunch',
    special_ad_category: 'NONE',
    audience_keywords: ['pub lunch'],
    ad_sets: [{
      name: 'Evergreen Test',
      phase_label: 'Evergreen Test',
      phase_start: '2026-09-15',
      phase_end: '2026-10-09',
      audience_description: 'Locals',
      targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
      placements: 'AUTO',
      optimisation_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      ads: ads.map((ad, index) => ({
        name: `Variation ${index + 1}`,
        ...ad,
        cta: 'BOOK_NOW',
        angle: `Angle ${index + 1}`,
        creative_format: ['venue_photo', 'people_social', 'offer_graphic'][index],
        creative_brief: 'Dish on the table',
      })),
    }],
  };
}

const CLEAN_ADS: AdCopy[] = [
  {
    headline: 'Lunch now served, Tue to Fri, 12 to 3',
    primary_text: "We're now serving lunch Tuesday to Friday, 12pm to 3pm. Burgers from £11 and free on-site parking.",
    description: 'Burgers from £11',
  },
  {
    headline: 'Wraps £10, served 12 to 3, Tue to Fri',
    primary_text: 'Lunch break sorted. A fish finger wrap is £10, served Tuesday to Friday from 12pm to 3pm.',
    description: 'Snack pots from £9',
  },
  {
    headline: 'Cod and chips £16, lunch Tue to Fri',
    primary_text: 'Beer battered cod and chips as a proper pub lunch Tuesday to Friday, 12pm to 3pm. Book online.',
    description: 'Pies from £15',
  },
];

// The first ad slips in a Monday and the third promises the weekend.
const OFF_SCHEDULE_ADS: AdCopy[] = [
  { ...CLEAN_ADS[0]!, headline: 'Lunch now served, Mon to Fri, 12 to 3' },
  CLEAN_ADS[1]!,
  { ...CLEAN_ADS[2]!, description: 'Weekend treat' },
];

function aiResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

function promptOf(callIndex: number): string {
  return mockCreate.mock.calls[callIndex]?.[0]?.messages?.[1]?.content as string;
}

describe('generateCampaign with a delivery schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
  });

  it('tells the AI the delivery days and hours and what never to mention', async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evergreenPayload(CLEAN_ADS)));

    const result = await generateCampaign({ ...baseInput, deliverySchedule: LUNCH });

    expect(promptOf(0)).toContain(
      'DELIVERY SCHEDULE: These ads only show Tuesday to Friday, 09:00 to 14:00; never mention Monday, the weekend, or every day.',
    );
    // Clean copy passes first time: one call, no correction round.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.ad_sets[0]!.ads.map((ad) => ad.headline)).toEqual(CLEAN_ADS.map((ad) => ad.headline));
  });

  it('leaves the prompt without a schedule line when there is no schedule', async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evergreenPayload(CLEAN_ADS)));

    await generateCampaign(baseInput);

    expect(promptOf(0)).not.toContain('DELIVERY SCHEDULE');
    expect(promptOf(0)).not.toContain('These ads only show');
  });

  it('sends off-schedule copy through the correction loop and keeps the fix', async () => {
    mockCreate
      .mockResolvedValueOnce(aiResponse(evergreenPayload(OFF_SCHEDULE_ADS)))
      .mockResolvedValueOnce(aiResponse(evergreenPayload(CLEAN_ADS)));

    const result = await generateCampaign({ ...baseInput, deliverySchedule: LUNCH });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const correctionPrompt = promptOf(1);
    expect(correctionPrompt).toContain(
      'Ad set "Evergreen Test", ad "Variation 1": These ads only show Tuesday to Friday, 09:00 to 14:00, so remove "Mon".',
    );
    expect(correctionPrompt).toContain('ad "Variation 3": These ads only show Tuesday to Friday, 09:00 to 14:00, so remove "Weekend".');
    expect(result.ad_sets[0]!.ads[0]!.headline).toBe('Lunch now served, Tue to Fri, 12 to 3');
    expect(result.ad_sets[0]!.ads[2]!.description).toBe('Pies from £15');
  });

  it('fails rather than return copy that still names a day outside the schedule', async () => {
    mockCreate.mockResolvedValue(aiResponse(evergreenPayload(OFF_SCHEDULE_ADS)));

    await expect(generateCampaign({ ...baseInput, deliverySchedule: LUNCH })).rejects.toThrow(
      /These ads only show Tuesday to Friday, 09:00 to 14:00, so remove "Mon"\./,
    );
  });

  it('does not apply the check to campaigns without a schedule', async () => {
    mockCreate.mockResolvedValueOnce(aiResponse(evergreenPayload(OFF_SCHEDULE_ADS)));

    const result = await generateCampaign(baseInput);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.ad_sets[0]!.ads[0]!.headline).toBe('Lunch now served, Mon to Fri, 12 to 3');
  });
});

describe('validateCampaignCopy off_schedule_day', () => {
  const payload = evergreenPayload(OFF_SCHEDULE_ADS) as unknown as AiCampaignPayload;

  it('flags each ad that names a day outside the schedule', () => {
    const issues = validateCampaignCopy(payload, { campaignKind: 'evergreen', deliverySchedule: LUNCH })
      .filter((issue) => issue.code === 'off_schedule_day');

    expect(issues).toEqual([
      {
        code: 'off_schedule_day',
        message: 'These ads only show Tuesday to Friday, 09:00 to 14:00, so remove "Mon".',
        adSetName: 'Evergreen Test',
        adName: 'Variation 1',
      },
      {
        code: 'off_schedule_day',
        message: 'These ads only show Tuesday to Friday, 09:00 to 14:00, so remove "Weekend".',
        adSetName: 'Evergreen Test',
        adName: 'Variation 3',
      },
    ]);
  });

  it('raises nothing without a schedule', () => {
    const issues = validateCampaignCopy(payload, { campaignKind: 'evergreen' });
    expect(issues.some((issue) => issue.code === 'off_schedule_day')).toBe(false);
  });
});
