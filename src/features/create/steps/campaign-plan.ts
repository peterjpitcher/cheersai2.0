/**
 * Campaign planning in the create wizard (tasks/SPEC-event-copy-engine.md B3).
 *
 * An event campaign's slots are written one at a time, in the order they go
 * out. Each slot is told its job, its place in the campaign, and how the
 * campaign's other posts opened and which questions they asked, so no two
 * posts open the same way. The jobs and the question budget come from
 * src/lib/ai/slot-jobs.ts, as they do for the ops rewrite tool. Other content
 * types are written as before, without a plan.
 */

import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import {
  CAMPAIGN_PLAN_LIMITS,
  openingOf,
  planSlotJobs,
  questionAllowed,
  questionsIn,
  shorten,
  slotJobSignals,
  type CampaignSlotPlan,
  type SlotJob,
} from '@/lib/ai/slot-jobs';
import type { SlotGeneratedCopy } from '@/types/content';

/**
 * Each slot's job, for the slots' times in send order, or null when the slots
 * are written without a plan: any brief that is not an event, or more posts
 * than a campaign can hold.
 */
export function planCampaignJobs(brief: ContentBrief, scheduledAts: string[]): SlotJob[] | null {
  if (brief.contentType !== 'event') return null;
  if (!scheduledAts.length || scheduledAts.length > CAMPAIGN_PLAN_LIMITS.posts) return null;
  return planSlotJobs(scheduledAts, {
    eventDate: brief.eventDate,
    host: brief.facts?.host ?? null,
    ...slotJobSignals(`${brief.prompt ?? ''} ${JSON.stringify(brief.facts ?? {})}`),
  });
}

/**
 * The plan for the slot at `index` of `jobs`. `others` are the campaign's
 * other slots in send order; only those with copy count. When a campaign is
 * written in order they are the earlier slots, and when one slot is rewritten
 * they are all the rest. Copy is read from the platforms the brief posts to,
 * as the owner edited it when they did.
 */
export function campaignSlotPlan(
  brief: ContentBrief,
  jobs: SlotJob[],
  index: number,
  others: Array<SlotGeneratedCopy | undefined>,
): CampaignSlotPlan {
  const openings = new Set<string>();
  const questions = new Set<string>();
  for (const other of others) {
    if (other?.status !== 'ready' || !other.copy) continue;
    for (const platform of brief.platforms ?? []) {
      const post = other.copy[platform];
      const text = post?.publishBodyOverride?.trim() || post?.body || '';
      const opening = openingOf(text);
      if (opening) openings.add(opening);
      for (const question of questionsIn(text)) questions.add(shorten(question, CAMPAIGN_PLAN_LIMITS.questionChars));
    }
  }
  return {
    job: jobs[index],
    position: index + 1,
    total: jobs.length,
    earlierOpenings: [...openings].slice(0, CAMPAIGN_PLAN_LIMITS.openings),
    earlierQuestions: [...questions].slice(0, CAMPAIGN_PLAN_LIMITS.questions),
    allowQuestion: questionAllowed(index + 1),
  };
}
