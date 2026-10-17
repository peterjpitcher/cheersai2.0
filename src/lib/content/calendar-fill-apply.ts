import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  FEED_PLATFORMS,
  LEAD_MINUTES,
  PLAN_VERSION,
  addDays,
  atLondon,
  formatDay,
  londonDate,
  londonTime,
  type CalendarPlan,
  type PlanSlot,
} from '@/lib/content/calendar-fill';
import { scheduleContentBatch } from '@/lib/content/schedule-batch';

/**
 * Writing a reviewed calendar plan (tasks/SPEC-social-calendar-fill.md), and
 * undoing it. Nothing is written unless the day and the posts are still as the
 * plan saw them: a moved post must still be scheduled at its old time and not
 * yet taken by the publisher, and a new post goes only on a day that has had
 * no post added since. New posts go through the wizard's own scheduling step,
 * so they are exactly the rows the wizard makes.
 */

const WAITING_JOB_STATUS = 'queued';
const SENDING_JOB_STATUSES = new Set(['in_progress', 'succeeded', 'publishing', 'published']);

const copyEntrySchema = z.object({ body: z.string() }).passthrough();
const slotSchema = z.object({
  slotKey: z.string().min(1),
  date: z.string().date(),
  scheduledAt: z.string().min(1),
  label: z.string(),
  copy: z.object({ facebook: copyEntrySchema, instagram: copyEntrySchema }).passthrough(),
  bodies: z.object({ facebook: z.string().min(1), instagram: z.string().min(1) }),
  mediaIds: z.array(z.string().uuid()),
  dayFeedCounts: z.object({ facebook: z.number().int().min(0), instagram: z.number().int().min(0) }),
});
const planSchema = z.object({
  version: z.literal(PLAN_VERSION),
  planId: z.string().min(1),
  accountId: z.string().uuid(),
  moves: z.array(
    z.object({
      campaignId: z.string().nullable(),
      campaignName: z.string(),
      items: z.array(z.object({ contentItemId: z.string().uuid(), platform: z.string(), placement: z.string() })).min(1),
      fromIso: z.string().min(1),
      toIso: z.string().min(1),
    }),
  ),
  batches: z.array(
    z.object({
      key: z.string().min(1),
      kind: z.string(),
      title: z.string(),
      contentType: z.enum(['event', 'weekly_recurring', 'instant_post']),
      brief: z.record(z.string(), z.unknown()),
      existingCampaignId: z.string().uuid().optional(),
      artwork: z.object({ eventId: z.string(), eventName: z.string(), assetId: z.string().uuid().nullable() }).passthrough().optional(),
      slots: z.array(slotSchema).min(1),
    }),
  ),
});

/** Read a plan file's contents, refusing anything the apply step cannot trust. */
export function parseCalendarPlan(raw: unknown): CalendarPlan {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a calendar plan: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message ?? ''}`);
  return raw as CalendarPlan;
}

export interface AppliedRecord {
  planId: string;
  accountId: string;
  moved: Array<{ contentItemIds: string[]; fromIso: string; toIso: string }>;
  created: Array<{ batchKey: string; slotKeys: string[]; contentItemIds: string[]; campaignId: string | null; createdCampaign: boolean }>;
  importedArtwork: Array<{ eventId: string; assetId: string }>;
}

export interface ApplyOutcome {
  record: AppliedRecord;
  skipped: Array<{ what: string; reason: string }>;
  failed: Array<{ what: string; error: string }>;
}

export interface ApplyDeps {
  db: SupabaseClient;
  now?: () => Date;
  schedule?: typeof scheduleContentBatch;
  /** Import an event's artwork from the events system; returns the media asset id. */
  importArtwork?: (artwork: { eventId: string; eventName: string }) => Promise<string>;
  log?: (line: string) => void;
}

export function emptyRecord(plan: Pick<CalendarPlan, 'planId' | 'accountId'>): AppliedRecord {
  return { planId: plan.planId, accountId: plan.accountId, moved: [], created: [], importedArtwork: [] };
}

function label(iso: string): string {
  return `${formatDay(londonDate(iso))}, ${londonTime(iso)}`;
}

interface ItemRow {
  id: string;
  status: string;
  scheduled_for: string | null;
  deleted_at: string | null;
  platform: string | null;
  placement: string | null;
  prompt_context?: Record<string, unknown> | null;
}

async function readJobs(db: SupabaseClient, accountId: string, ids: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from('publish_jobs')
    .select('content_item_id, status')
    .eq('account_id', accountId)
    .in('content_item_id', ids);
  if (error) throw new Error(error.message);
  const jobs = new Map<string, string[]>();
  for (const job of (data ?? []) as Array<{ content_item_id: string; status: string }>) {
    jobs.set(job.content_item_id, [...(jobs.get(job.content_item_id) ?? []), job.status]);
  }
  return jobs;
}

/** The account's Facebook and Instagram posts on a London day, other than this plan's own. */
async function postsOnDay(db: SupabaseClient, accountId: string, date: string, planId: string): Promise<ItemRow[]> {
  const { data, error } = await db
    .from('content_items')
    .select('id, status, scheduled_for, deleted_at, platform, placement, prompt_context')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .in('platform', FEED_PLATFORMS)
    .gte('scheduled_for', atLondon(date, '00:00'))
    .lt('scheduled_for', atLondon(addDays(date, 1), '00:00'));
  if (error) throw new Error(error.message);
  const ownPrefix = `calendar:${planId}:`;
  return ((data ?? []) as ItemRow[]).filter((row) => {
    const slotKey = row.prompt_context?.slotKey;
    return !(typeof slotKey === 'string' && slotKey.startsWith(ownPrefix)) && row.status !== 'draft' && row.status !== 'failed';
  });
}

/** Why a new post cannot go out as planned, or null when it can. */
async function slotProblem(db: SupabaseClient, plan: CalendarPlan, slot: PlanSlot, nowMs: number): Promise<string | null> {
  if (Date.parse(slot.scheduledAt) <= nowMs + LEAD_MINUTES * 60_000) return `due within ${LEAD_MINUTES} minutes`;
  const { data: existing, error } = await db
    .from('content_items')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('prompt_context->>slotKey', slot.slotKey)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  if ((existing ?? []).length) return 'already created';
  const day = await postsOnDay(db, plan.accountId, slot.date, plan.planId);
  for (const platform of FEED_PLATFORMS) {
    const feed = day.filter((row) => row.platform === platform && row.placement !== 'story').length;
    if (feed > slot.dayFeedCounts[platform]) return `a ${platform} post has been added to ${formatDay(slot.date)} since the plan was made`;
  }
  if (day.some((row) => row.scheduled_for && Date.parse(row.scheduled_for) === Date.parse(slot.scheduledAt))) {
    return `another post now goes out at ${londonTime(slot.scheduledAt)} that day`;
  }
  return null;
}

/**
 * Write a reviewed plan: first the time moves, then the new posts. Each part is
 * checked against the live schedule just before it is written and skipped,
 * with the reason, when it no longer matches. Pass the record of an earlier
 * run to carry on from it; everything already done is skipped.
 */
export async function applyCalendarPlan(deps: ApplyDeps, plan: CalendarPlan, previous?: AppliedRecord): Promise<ApplyOutcome> {
  const { db } = deps;
  const log = deps.log ?? (() => undefined);
  const schedule = deps.schedule ?? scheduleContentBatch;
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const record: AppliedRecord = previous ? structuredClone(previous) : emptyRecord(plan);
  const skipped: ApplyOutcome['skipped'] = [];
  const failed: ApplyOutcome['failed'] = [];

  for (const move of plan.moves) {
    const what = `${move.campaignName}, ${label(move.fromIso)} to ${londonTime(move.toIso)}`;
    const ids = move.items.map((item) => item.contentItemId);
    try {
      const { data, error } = await db
        .from('content_items')
        .select('id, status, scheduled_for, deleted_at, platform, placement')
        .eq('account_id', plan.accountId)
        .in('id', ids);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as ItemRow[];
      if (rows.length === ids.length && rows.every((row) => row.scheduled_for && Date.parse(row.scheduled_for) === Date.parse(move.toIso))) {
        skipped.push({ what, reason: 'already done' });
        continue;
      }
      const problem =
        rows.length !== ids.length || rows.some((row) => row.deleted_at)
          ? 'a post in this slot no longer exists'
          : rows.some((row) => row.status !== 'scheduled')
            ? 'a post in this slot is no longer waiting to publish'
            : rows.some((row) => !row.scheduled_for || Date.parse(row.scheduled_for) !== Date.parse(move.fromIso))
              ? 'a post in this slot has been moved since the plan was made'
              : Date.parse(move.fromIso) <= nowMs + LEAD_MINUTES * 60_000
                ? `due within ${LEAD_MINUTES} minutes`
                : null;
      if (problem) {
        skipped.push({ what, reason: problem });
        continue;
      }
      const jobs = await readJobs(db, plan.accountId, ids);
      if (ids.some((id) => !(jobs.get(id) ?? []).length || (jobs.get(id) ?? []).some((status) => status !== WAITING_JOB_STATUS))) {
        skipped.push({ what, reason: 'its publish jobs are not all waiting' });
        continue;
      }
      const date = londonDate(move.toIso);
      const platforms = [...new Set(move.items.map((item) => item.platform))];
      const day = await postsOnDay(db, plan.accountId, date, plan.planId);
      if (day.some((row) => !ids.includes(row.id) && platforms.includes(row.platform ?? '') && row.scheduled_for && Date.parse(row.scheduled_for) === Date.parse(move.toIso))) {
        skipped.push({ what, reason: `${londonTime(move.toIso)} has been taken since the plan was made` });
        continue;
      }

      const stamp = new Date(nowMs).toISOString();
      // The old time and status are part of the update, so a post edited or
      // taken by the publisher in the meantime is never moved.
      const { data: updated, error: updateError } = await db
        .from('content_items')
        .update({ scheduled_for: move.toIso, scheduled_at: move.toIso, updated_at: stamp })
        .eq('account_id', plan.accountId)
        .in('id', ids)
        .eq('status', 'scheduled')
        .eq('scheduled_for', move.fromIso)
        .select('id');
      if (updateError) throw new Error(updateError.message);
      const movedIds = ((updated ?? []) as Array<{ id: string }>).map((row) => row.id);
      if (movedIds.length !== ids.length) {
        // Half a slot moved would split a feed post from its story: put them back.
        if (movedIds.length) {
          await db.from('content_items').update({ scheduled_for: move.fromIso, scheduled_at: move.fromIso }).in('id', movedIds).eq('scheduled_for', move.toIso);
        }
        skipped.push({ what, reason: 'a post in this slot changed while this ran' });
        continue;
      }
      const { error: jobError } = await db
        .from('publish_jobs')
        .update({ next_attempt_at: move.toIso, scheduled_at: move.toIso, updated_at: stamp })
        .eq('account_id', plan.accountId)
        .in('content_item_id', ids)
        .eq('status', WAITING_JOB_STATUS);
      if (jobError) throw new Error(jobError.message);
      record.moved.push({ contentItemIds: ids, fromIso: move.fromIso, toIso: move.toIso });
      log(`Moved ${what}`);
    } catch (error) {
      failed.push({ what, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const batch of plan.batches) {
    try {
      let mediaOverride: string[] | null = null;
      if (batch.artwork && !batch.artwork.assetId) {
        const imported = record.importedArtwork.find((entry) => entry.eventId === batch.artwork?.eventId);
        let assetId = imported?.assetId ?? null;
        if (!assetId) {
          if (!deps.importArtwork) throw new Error('its artwork has to be imported and no importer was given');
          assetId = await deps.importArtwork({ eventId: batch.artwork.eventId, eventName: batch.artwork.eventName });
          record.importedArtwork.push({ eventId: batch.artwork.eventId, assetId });
          log(`Imported the artwork for ${batch.artwork.eventName}`);
        }
        mediaOverride = [assetId];
      }

      const ready: PlanSlot[] = [];
      for (const slot of batch.slots) {
        const problem = await slotProblem(db, plan, slot, nowMs);
        if (problem) skipped.push({ what: `${batch.title}, ${label(slot.scheduledAt)}`, reason: problem });
        else ready.push(slot);
      }
      if (!ready.length) continue;

      const result = await schedule(db, plan.accountId, {
        contentType: batch.contentType,
        brief: batch.brief,
        selectedMediaIds: [],
        slotCopies: ready.map((slot) => ({
          slotKey: slot.slotKey,
          scheduledAt: slot.scheduledAt,
          label: slot.label,
          copy: slot.copy,
          mediaIds: mediaOverride ?? slot.mediaIds,
        })),
        platforms: [...FEED_PLATFORMS],
        mode: 'schedule',
        ...(batch.existingCampaignId ? { existingCampaignId: batch.existingCampaignId } : {}),
      });
      if (!result.success || !result.contentItemIds) {
        failed.push({ what: batch.title, error: result.error ?? 'nothing was scheduled' });
        continue;
      }
      record.created.push({
        batchKey: batch.key,
        slotKeys: ready.map((slot) => slot.slotKey),
        contentItemIds: result.contentItemIds,
        campaignId: result.campaignId ?? null,
        createdCampaign: Boolean(result.campaignId) && !batch.existingCampaignId,
      });
      log(`Scheduled ${batch.title}: ${ready.length} post${ready.length === 1 ? '' : 's'}, each with its story`);
    } catch (error) {
      failed.push({ what: batch.title, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { record, skipped, failed };
}

export interface VerifyProblem {
  what: string;
  problem: string;
}

/**
 * Read back what a run wrote: every new post at its time with the planned
 * text, waiting with one job, and a story beside each feed post; every moved
 * post at its new time with its job.
 */
export async function verifyAppliedPlan(db: SupabaseClient, plan: CalendarPlan, record: AppliedRecord): Promise<VerifyProblem[]> {
  const problems: VerifyProblem[] = [];
  const slots = new Map(plan.batches.flatMap((batch) => batch.slots.map((slot) => [slot.slotKey, { batch, slot }] as const)));
  for (const created of record.created) {
    const { data, error } = await db
      .from('content_items')
      .select('id, status, scheduled_for, platform, placement, prompt_context, content_variants(body, media_ids)')
      .eq('account_id', plan.accountId)
      .in('id', created.contentItemIds);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<ItemRow & { content_variants: { body: string | null; media_ids: string[] | null } | Array<{ body: string | null; media_ids: string[] | null }> | null }>;
    const jobs = await readJobs(db, plan.accountId, created.contentItemIds);
    for (const slotKey of created.slotKeys) {
      const planned = slots.get(slotKey);
      if (!planned) continue;
      const what = `${planned.batch.title}, ${label(planned.slot.scheduledAt)}`;
      const items = rows.filter((row) => row.prompt_context?.slotKey === slotKey);
      for (const platform of FEED_PLATFORMS) {
        for (const placement of ['feed', 'story'] as const) {
          const item = items.find((row) => row.platform === platform && row.placement === placement);
          if (!item) {
            problems.push({ what, problem: `no ${platform} ${placement}` });
            continue;
          }
          const variant = Array.isArray(item.content_variants) ? item.content_variants[0] : item.content_variants;
          if (item.status !== 'scheduled') problems.push({ what, problem: `${platform} ${placement} is ${item.status}` });
          if (!item.scheduled_for || Date.parse(item.scheduled_for) !== Date.parse(planned.slot.scheduledAt)) problems.push({ what, problem: `${platform} ${placement} is at the wrong time` });
          if ((jobs.get(item.id) ?? []).join(',') !== WAITING_JOB_STATUS) problems.push({ what, problem: `${platform} ${placement} jobs: ${(jobs.get(item.id) ?? []).join(', ') || 'none'}` });
          if (!variant?.media_ids?.length) problems.push({ what, problem: `${platform} ${placement} has no image` });
          if (placement === 'feed' && (variant?.body ?? '') !== planned.slot.bodies[platform]) problems.push({ what, problem: `${platform} text differs from the plan` });
        }
      }
    }
  }
  for (const moved of record.moved) {
    const { data, error } = await db
      .from('content_items')
      .select('id, status, scheduled_for')
      .eq('account_id', plan.accountId)
      .in('id', moved.contentItemIds);
    if (error) throw new Error(error.message);
    const jobs = await readJobs(db, plan.accountId, moved.contentItemIds);
    const { data: jobRows, error: jobError } = await db
      .from('publish_jobs')
      .select('content_item_id, next_attempt_at')
      .eq('account_id', plan.accountId)
      .in('content_item_id', moved.contentItemIds);
    if (jobError) throw new Error(jobError.message);
    for (const row of (data ?? []) as ItemRow[]) {
      const what = `moved post ${row.id.slice(0, 8)} (${label(moved.toIso)})`;
      if (!row.scheduled_for || Date.parse(row.scheduled_for) !== Date.parse(moved.toIso)) problems.push({ what, problem: 'not at its new time' });
      if ((jobs.get(row.id) ?? []).some((status) => status !== WAITING_JOB_STATUS)) problems.push({ what, problem: 'its job is no longer waiting' });
      const job = ((jobRows ?? []) as Array<{ content_item_id: string; next_attempt_at: string | null }>).find((entry) => entry.content_item_id === row.id);
      if (!job?.next_attempt_at || Date.parse(job.next_attempt_at) !== Date.parse(moved.toIso)) problems.push({ what, problem: 'its job is not at the new time' });
    }
  }
  return problems;
}

/**
 * Undo a run: posts it added go to the bin (only those not yet sent or being
 * sent), and posts it moved go back to their old time (only those still at
 * the new one and waiting). Campaigns it created are left, empty, and listed.
 */
export async function rollbackCalendarPlan(deps: Pick<ApplyDeps, 'db' | 'now' | 'log'>, plan: CalendarPlan, record: AppliedRecord): Promise<ApplyOutcome> {
  const { db } = deps;
  const log = deps.log ?? (() => undefined);
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const skipped: ApplyOutcome['skipped'] = [];
  const failed: ApplyOutcome['failed'] = [];

  for (const created of record.created) {
    try {
      const { data, error } = await db
        .from('content_items')
        .select('id, status, scheduled_for, deleted_at, platform, placement')
        .eq('account_id', plan.accountId)
        .in('id', created.contentItemIds);
      if (error) throw new Error(error.message);
      const jobs = await readJobs(db, plan.accountId, created.contentItemIds);
      for (const row of (data ?? []) as ItemRow[]) {
        const what = `${created.batchKey} ${row.platform} ${row.placement} ${row.scheduled_for ? label(row.scheduled_for) : ''}`;
        if (row.deleted_at) {
          skipped.push({ what, reason: 'already in the bin' });
          continue;
        }
        if (row.status !== 'scheduled' || (jobs.get(row.id) ?? []).some((status) => SENDING_JOB_STATUSES.has(status))) {
          skipped.push({ what, reason: `it is ${row.status} and cannot be taken back` });
          continue;
        }
        const { data: binned, error: binError } = await db
          .from('content_items')
          .update({ deleted_at: nowIso, updated_at: nowIso })
          .eq('account_id', plan.accountId)
          .eq('id', row.id)
          .eq('status', 'scheduled')
          .select('id');
        if (binError) throw new Error(binError.message);
        if (!(binned ?? []).length) {
          skipped.push({ what, reason: 'it changed while this ran' });
          continue;
        }
        // As the planner's bin does: the post's jobs go with it, none of them sending.
        const { error: jobError } = await db
          .from('publish_jobs')
          .delete()
          .eq('account_id', plan.accountId)
          .eq('content_item_id', row.id)
          .in('status', [WAITING_JOB_STATUS, 'failed', 'held']);
        if (jobError) throw new Error(jobError.message);
      }
      log(`Took back ${created.batchKey}`);
    } catch (error) {
      failed.push({ what: created.batchKey, error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const moved of record.moved) {
    const what = `${moved.contentItemIds.length} posts at ${label(moved.toIso)}`;
    try {
      const { data, error } = await db
        .from('content_items')
        .update({ scheduled_for: moved.fromIso, scheduled_at: moved.fromIso, updated_at: nowIso })
        .eq('account_id', plan.accountId)
        .in('id', moved.contentItemIds)
        .eq('status', 'scheduled')
        .eq('scheduled_for', moved.toIso)
        .select('id');
      if (error) throw new Error(error.message);
      const back = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
      if (back.length !== moved.contentItemIds.length) skipped.push({ what, reason: `${moved.contentItemIds.length - back.length} had changed or been sent, and were left` });
      if (!back.length) continue;
      const { error: jobError } = await db
        .from('publish_jobs')
        .update({ next_attempt_at: moved.fromIso, scheduled_at: moved.fromIso, updated_at: nowIso })
        .eq('account_id', plan.accountId)
        .in('content_item_id', back)
        .eq('status', WAITING_JOB_STATUS);
      if (jobError) throw new Error(jobError.message);
      log(`Moved back ${what} to ${londonTime(moved.fromIso)}`);
    } catch (error) {
      failed.push({ what, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { record, skipped, failed };
}
