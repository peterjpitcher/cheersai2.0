import { DateTime } from 'luxon';
import { z } from 'zod';

import { DEFAULT_TIMEZONE } from '@/lib/constants';

/**
 * Campaign planning for event posts (tasks/SPEC-event-copy-engine.md B3).
 *
 * Written one at a time, a campaign's posts all led with the same detail: in
 * the 17 October 2026 rewrite plan, 7 of 7 Tinsel & Tipples Facebook posts
 * opened "Hot mulled cider on..." and every Sparks & Sparklers post led with
 * the host. Each post now gets its own job, chosen in code from the number of
 * posts and the facts available, and is written knowing how the earlier posts
 * opened and which questions they asked. A question is allowed in at most half
 * the posts.
 */

export const SLOT_JOBS = [
  'announce',
  'how_it_works',
  'meet_the_host',
  'dress_up_and_prizes',
  'eat_first',
  'last_call',
  'tonight',
  'fresh_angle',
] as const;

export type SlotJob = (typeof SLOT_JOBS)[number];

export interface SlotJobContext {
  /** The event's date in London, YYYY-MM-DD. */
  eventDate: string;
  host?: string | null;
  /** The brief mentions food, a menu or the kitchen. */
  hasFood: boolean;
  /** The brief mentions dressing up, a theme or prizes. */
  hasDressUpOrPrizes: boolean;
}

export interface CampaignSlotPlan {
  job: SlotJob;
  host?: string | null;
  /** 1-based place of this post in the campaign. */
  position: number;
  total: number;
  /**
   * First lines of the campaign's other posts that are already written: the
   * earlier ones when a campaign is written in order, all the rest when one
   * post is rewritten on its own.
   */
  earlierOpenings: string[];
  /** Questions those posts asked. */
  earlierQuestions: string[];
  allowQuestion: boolean;
}

/**
 * Limits on a campaign plan, shared by the create wizard that builds one and
 * the server action that checks it.
 */
export const CAMPAIGN_PLAN_LIMITS = {
  /** Posts in one campaign: the schedule step and createScheduledBatch allow 12. */
  posts: 12,
  /** One per platform for each of the other 11 posts. */
  openings: 22,
  questions: 22,
  openingChars: 140,
  questionChars: 200,
} as const;

/**
 * A campaign plan as the create wizard sends it. The host is left out: the
 * server takes it from the brief, so the prompt never names anyone else.
 */
export const campaignSlotPlanSchema = z
  .object({
    job: z.enum(SLOT_JOBS),
    position: z.number().int().min(1).max(CAMPAIGN_PLAN_LIMITS.posts),
    total: z.number().int().min(1).max(CAMPAIGN_PLAN_LIMITS.posts),
    earlierOpenings: z
      .array(z.string().trim().min(1).max(CAMPAIGN_PLAN_LIMITS.openingChars))
      .max(CAMPAIGN_PLAN_LIMITS.openings),
    earlierQuestions: z
      .array(z.string().trim().min(1).max(CAMPAIGN_PLAN_LIMITS.questionChars))
      .max(CAMPAIGN_PLAN_LIMITS.questions),
    allowQuestion: z.boolean(),
  })
  .refine((plan) => plan.position <= plan.total, { message: 'The post is placed after the last post.', path: ['position'] });

/** Days before the event within which the last pre-event post is a last call. */
const LAST_CALL_DAYS = 3;
const FOOD = /\b(food|menu|kitchen|dinner|lunch|eat|eating|dining|roast|pizza|burger|meal)\b/i;
const DRESS_UP_OR_PRIZES = /\b(prizes?|fancy dress|dress(?:ed)? up|dress code|costumes?|themed|sequins?|glitter|win)\b/i;

/** Whether the brief's text supports the food and dressing-up jobs. */
export function slotJobSignals(text: string): Pick<SlotJobContext, 'hasFood' | 'hasDressUpOrPrizes'> {
  return { hasFood: FOOD.test(text), hasDressUpOrPrizes: DRESS_UP_OR_PRIZES.test(text) };
}

function londonDate(iso: string): string | null {
  return DateTime.fromISO(iso, { setZone: true }).setZone(DEFAULT_TIMEZONE).toISODate();
}

/**
 * One job per post, in the order the posts go out. Posts on the event day are
 * "tonight"; the first earlier post announces; the last post before the day,
 * when it is within three days, is the last call; the posts between take the
 * content jobs the facts support, then fresh angles. A post after the event
 * day is a fresh angle: the timing rules write it as a recap, so no job meant
 * for before the event fits it.
 */
export function planSlotJobs(scheduledAts: string[], context: SlotJobContext): SlotJob[] {
  const jobs = new Array<SlotJob>(scheduledAts.length);
  const before: number[] = [];
  scheduledAts.forEach((iso, index) => {
    const date = londonDate(iso);
    if (date === context.eventDate) jobs[index] = 'tonight';
    // Both are YYYY-MM-DD London dates, so comparing the strings compares the days.
    else if (date && date > context.eventDate) jobs[index] = 'fresh_angle';
    else before.push(index);
  });
  if (!before.length) return jobs;

  jobs[before[0]] = 'announce';
  const lastIndex = before[before.length - 1];
  const event = DateTime.fromISO(context.eventDate, { zone: DEFAULT_TIMEZONE });
  const last = DateTime.fromISO(scheduledAts[lastIndex], { setZone: true }).setZone(DEFAULT_TIMEZONE).startOf('day');
  const middle = before.slice(1);
  if (middle.length && event.isValid && event.diff(last, 'days').days <= LAST_CALL_DAYS) {
    jobs[lastIndex] = 'last_call';
    middle.pop();
  }

  const pool: SlotJob[] = [
    'how_it_works',
    ...(context.host?.trim() ? (['meet_the_host'] as const) : []),
    ...(context.hasDressUpOrPrizes ? (['dress_up_and_prizes'] as const) : []),
    ...(context.hasFood ? (['eat_first'] as const) : []),
  ];
  middle.forEach((index, position) => {
    jobs[index] = pool[position] ?? 'fresh_angle';
  });
  return jobs;
}

/** A question in at most half the posts: the second, fourth and so on. */
export function questionAllowed(position: number): boolean {
  return position % 2 === 0;
}

export function describeSlotJob(job: SlotJob, host?: string | null): string {
  switch (job) {
    case 'announce':
      return 'Announce the event to people hearing about it for the first time: what it is, when, and the one detail that makes it worth booking.';
    case 'how_it_works':
      return 'Explain how the night works for someone who has never been: what happens, how long it runs, what it costs and how to book.';
    case 'meet_the_host':
      return `Lead with the host, ${host?.trim() || 'the host'}, and what they bring to the night, saying nothing about them that the brief does not.`;
    case 'dress_up_and_prizes':
      return 'Lead with dressing up and the prizes, using only what the brief says about them.';
    case 'eat_first':
      return 'Lead with eating here before or during the event, using only the food details in the brief.';
    case 'last_call':
      return 'A last call before the day: what is left to know and how to book.';
    case 'tonight':
      return 'It is the day of the event: lead with today and the start time, and the one thing not to miss.';
    case 'fresh_angle':
      return 'Lead with a detail from the brief that none of the earlier posts led with.';
  }
}

/** Short label for the owner's report and the create wizard. */
export const SLOT_JOB_LABELS: Record<SlotJob, string> = {
  announce: 'Announce',
  how_it_works: 'How it works',
  meet_the_host: 'Meet the host',
  dress_up_and_prizes: 'Dress-up and prizes',
  eat_first: 'Eat first',
  last_call: 'Last call',
  tonight: 'Tonight',
  fresh_angle: 'Fresh angle',
};

/** The campaign-plan block of the user prompt. */
export function renderCampaignPlan(plan: CampaignSlotPlan): string {
  const lines = [
    `Campaign plan: this is post ${plan.position} of ${plan.total} for this event.`,
    `This post's job: ${describeSlotJob(plan.job, plan.host)}`,
  ];
  // "Other", not "earlier": a post rewritten on its own is shown the later posts too.
  if (plan.earlierOpenings.length) {
    lines.push(
      'Other posts in this campaign opened like this. Start differently, and do not lead with the same detail:',
      ...plan.earlierOpenings.map((opening) => `- "${opening}"`),
    );
  }
  if (plan.earlierQuestions.length) {
    lines.push(`Questions other posts in this campaign asked (do not ask these again): ${plan.earlierQuestions.map((question) => `"${question}"`).join('; ')}`);
  }
  lines.push(plan.allowQuestion
    ? 'You may ask one question, only if it is about the event and new.'
    : 'Do not ask a question in this post.');
  return lines.join('\n');
}

/** Text cut at a word to at most `max` characters, ending "..." when cut. */
export function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).replace(/\s+\S*$/, '')}...` : text;
}

/** The first sentence of a post body, for the next posts' prompts. */
export function openingOf(body: string): string {
  const line = body.trim().split('\n')[0] ?? '';
  // A sentence ends at its mark even when an emoji follows with no space ("Big night!🎉").
  const first = (line.match(/^.*?[.!?]+/u)?.[0] ?? line).trim();
  return shorten(first, CAMPAIGN_PLAN_LIMITS.openingChars);
}

/**
 * Every question a post body asks, including ones followed straight away by an
 * emoji ("Which song?🎶 Which outfit?🕺" is two questions).
 */
export function questionsIn(body: string): string[] {
  return (body.match(/[^.!?\n]*\?+/gu) ?? [])
    .map((question) => question.replace(/^[^\p{L}\p{N}"'\u2018\u201C(]+/u, '').trim())
    .filter(Boolean);
}
