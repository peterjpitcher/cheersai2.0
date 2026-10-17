import { describe, expect, it } from 'vitest';

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import { campaignSlotPlan, planCampaignJobs } from '@/features/create/steps/campaign-plan';
import { CAMPAIGN_PLAN_LIMITS, campaignSlotPlanSchema } from '@/lib/ai/slot-jobs';
import type { SlotGeneratedCopy } from '@/types/content';

const eventBrief = {
  contentType: 'event',
  title: 'Disco Night Music Bingo',
  eventName: 'Disco Night Music Bingo',
  eventDate: '2026-11-13',
  eventTime: '19:00',
  prompt: 'Two rounds of 70s disco. Fancy dress encouraged, prizes for the best outfit.',
  platforms: ['facebook', 'instagram'],
  facts: { host: 'Jo', times: 'Kitchen open from 5pm' },
} as unknown as ContentBrief;

function ready(facebook: string, instagram: string, overrides: Partial<SlotGeneratedCopy> = {}): SlotGeneratedCopy {
  return {
    slotKey: 'slot',
    scheduledAt: '2026-11-01T08:00:00.000Z',
    status: 'ready',
    copy: { facebook: { body: facebook }, instagram: { body: instagram } },
    ...overrides,
  };
}

describe('planCampaignJobs', () => {
  it('plans an event from its date, host and the facts and notes it mentions', () => {
    const slots = [
      '2026-10-13T07:00:00+01:00',
      '2026-10-20T07:00:00+01:00',
      '2026-10-27T07:00:00+00:00',
      '2026-11-03T07:00:00+00:00',
      '2026-11-08T07:00:00+00:00',
      '2026-11-11T07:00:00+00:00',
      '2026-11-13T07:00:00+00:00',
    ];
    // The host and the kitchen come from the facts, the prizes from the notes.
    expect(planCampaignJobs(eventBrief, slots)).toEqual([
      'announce',
      'how_it_works',
      'meet_the_host',
      'dress_up_and_prizes',
      'eat_first',
      'last_call',
      'tonight',
    ]);
  });

  it('plans nothing for other content, or for more posts than a campaign holds', () => {
    const promotion = { contentType: 'promotion', platforms: ['facebook'] } as unknown as ContentBrief;
    expect(planCampaignJobs(promotion, ['2026-11-01T08:00:00Z'])).toBeNull();
    expect(planCampaignJobs(eventBrief, [])).toBeNull();
    const thirteen = Array.from({ length: 13 }, (_, day) => `2026-10-${String(day + 10).padStart(2, '0')}T08:00:00Z`);
    expect(planCampaignJobs(eventBrief, thirteen)).toBeNull();
  });
});

describe('campaignSlotPlan', () => {
  const jobs = planCampaignJobs(eventBrief, [
    '2026-10-30T07:00:00+00:00',
    '2026-11-06T07:00:00+00:00',
    '2026-11-11T07:00:00+00:00',
    '2026-11-13T07:00:00+00:00',
  ])!;

  it('gives the slot its job and place, and the openings and questions of the slots with copy', () => {
    const plan = campaignSlotPlan(eventBrief, jobs, 2, [
      ready('Two rounds of 70s disco! Which decade suits you?', 'Two rounds of 70s disco! Book now.'),
      ready('Jo is on the mic.', 'Jo is on the mic. Fancy a dance?'),
      undefined,
      { ...ready('Old failed text.', 'Old failed text.'), status: 'failed' },
    ]);

    expect(plan).toEqual({
      job: 'last_call',
      position: 3,
      total: 4,
      // The same first line on both platforms is listed once.
      earlierOpenings: ['Two rounds of 70s disco!', 'Jo is on the mic.'],
      earlierQuestions: ['Which decade suits you?', 'Fancy a dance?'],
      allowQuestion: false,
    });
  });

  it("reads the owner's edited text and only the platforms the brief posts to", () => {
    const facebookOnly = { ...eventBrief, platforms: ['facebook'] } as unknown as ContentBrief;
    const edited = ready('Generated opening.', 'Instagram opening.');
    edited.copy!.facebook.publishBodyOverride = 'Edited opening by the owner. Who is coming?';

    const plan = campaignSlotPlan(facebookOnly, jobs, 1, [edited]);

    expect(plan.earlierOpenings).toEqual(['Edited opening by the owner.']);
    expect(plan.earlierQuestions).toEqual(['Who is coming?']);
    expect(plan.allowQuestion).toBe(true);
  });

  it('always builds a plan the server accepts, however long the copy', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => `2026-10-${String(index + 10).padStart(2, '0')}T08:00:00Z`);
    const bigJobs = planCampaignJobs({ ...eventBrief, eventDate: '2026-10-21' } as ContentBrief, twelve)!;
    const longQuestion = `${'Which of the many wonderful songs from the seventies '.repeat(6)}will you sing?`;
    const others = Array.from({ length: 11 }, (_, index) =>
      ready(
        `Opening ${index}: ${'a very long sentence about disco '.repeat(5)}tonight. ${longQuestion} Is it ${index}?`,
        `Instagram opening ${index}! Is it really ${index}? Or ${index + 1}?`,
      ),
    );

    const plan = campaignSlotPlan(eventBrief, bigJobs, 11, others);

    expect(campaignSlotPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.earlierOpenings).toHaveLength(CAMPAIGN_PLAN_LIMITS.openings);
    expect(plan.earlierQuestions).toHaveLength(CAMPAIGN_PLAN_LIMITS.questions);
    expect(plan.earlierQuestions[0].length).toBeLessThanOrEqual(CAMPAIGN_PLAN_LIMITS.questionChars);
    expect(plan.earlierQuestions[0].endsWith('...')).toBe(true);
  });
});
