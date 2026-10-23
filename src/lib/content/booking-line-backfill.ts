/**
 * Name the event in the booking line of Instagram event posts already scheduled
 * (tasks/SPEC-instagram-booking-line-names-event.md, "Scheduled posts").
 *
 * New posts have named their event since #212; the posts scheduled before it
 * still end "Book a place for each person through the link in our bio." This
 * changes that one line and nothing else, in two steps, as the rewrite tool does:
 *
 * 1. A plan run reads every eligible post and works out the new line with the
 *    same rule as new posts (nameEventInBookingLine). It changes no post.
 * 2. Once the owner has approved the list, `--apply --plan <file>` writes exactly
 *    that line, only to posts that still carry the planned text, at the planned
 *    time, waiting to publish and more than an hour away. `--rollback` puts the
 *    old line back on the same terms.
 *
 * The caption (content_variants.body) and the stored copy's linkInBioLine
 * (preview_data.structuredCopy) change together. Stories carry no caption and
 * Facebook posts carry their link, so neither is touched.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { nameEventInBookingLine } from '@/lib/ai/booking-line';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

/** Posts due sooner than this are left alone: the publish worker may be loading them. */
export const BACKFILL_LEAD_MINUTES = 60;
const PLAN_KIND = 'booking-line-backfill';
const PLAN_VERSION = 1;
const WAITING_JOB_STATUSES = new Set(['queued']);
const CHANGEABLE_STATUS = 'scheduled';
const BOOKING_LINE = /link in (?:our |the )?bio/i;

type Row = Record<string, unknown>;

interface ItemRow {
  id: string;
  status: string;
  scheduled_for: string;
  prompt_context: Row | null;
  content_variants: Array<{ id: string; body: string | null; preview_data: Row | null }> | { id: string; body: string | null; preview_data: Row | null } | null;
}

const plannedPostSchema = z.object({
  contentItemId: z.string(),
  variantId: z.string(),
  scheduledFor: z.string(),
  eventName: z.string(),
  oldLine: z.string(),
  newLine: z.string(),
  oldBody: z.string(),
  newBody: z.string(),
  oldPreviewData: z.record(z.string(), z.unknown()),
  newPreviewData: z.record(z.string(), z.unknown()),
});

const planSchema = z.object({
  kind: z.literal(PLAN_KIND),
  version: z.literal(PLAN_VERSION),
  accountId: z.string(),
  createdAt: z.string(),
  posts: z.array(plannedPostSchema),
  skipped: z.array(z.object({ contentItemId: z.string(), scheduledFor: z.string(), reason: z.string() })),
});

export type BookingLinePlan = z.infer<typeof planSchema>;
export type PlannedLineChange = z.infer<typeof plannedPostSchema>;

function asRecord(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function firstVariant(value: ItemRow['content_variants']): { id: string; body: string | null; preview_data: Row | null } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** "Mon 26 Oct 11:00", in London time. */
export function londonLabel(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(DEFAULT_TIMEZONE).toFormat('ccc d LLL HH:mm');
}

/** The new caption and stored copy for one post, or why the post is left alone. */
export function changeForPost(
  body: string,
  previewData: Row | null,
  eventName: string | null,
): { oldLine: string; newLine: string; newBody: string; newPreviewData: Row } | { reason: string } {
  const lines = body.split('\n');
  const indexes = lines.flatMap((line, index) => (BOOKING_LINE.test(line) ? [index] : []));
  if (!indexes.length) return { reason: 'no booking line' };
  if (indexes.length > 1) return { reason: 'more than one booking line' };
  if (!eventName?.trim()) return { reason: 'no event name stored with the post' };

  const oldLine = lines[indexes[0]];
  const newLine = nameEventInBookingLine(oldLine, eventName);
  if (newLine === oldLine.trim()) return { reason: 'the line already names the event' };

  const structured = asRecord(previewData?.structuredCopy);
  if (structured && typeof structured.publishBodyOverride === 'string') {
    return { reason: 'the caption was edited by hand' };
  }
  if (structured && structured.linkInBioLine !== undefined && structured.linkInBioLine !== oldLine.trim()) {
    return { reason: 'the stored booking line does not match the caption' };
  }

  const newLines = [...lines];
  newLines[indexes[0]] = newLine;
  return {
    oldLine,
    newLine,
    newBody: newLines.join('\n'),
    newPreviewData: {
      ...(previewData ?? {}),
      ...(structured ? { structuredCopy: { ...structured, linkInBioLine: newLine } } : {}),
    },
  };
}

/**
 * Work out the new booking line for every eligible scheduled Instagram event
 * post of one account. Reads only.
 */
export async function planBookingLineBackfill(
  db: SupabaseClient,
  options: { accountId: string; now?: Date },
): Promise<BookingLinePlan> {
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() + BACKFILL_LEAD_MINUTES * 60_000;
  const { data, error } = await db
    .from('content_items')
    .select('id, status, scheduled_for, prompt_context, content_variants(id, body, preview_data)')
    .eq('account_id', options.accountId)
    .eq('platform', 'instagram')
    .eq('placement', 'feed')
    .eq('content_type', 'event')
    .eq('status', CHANGEABLE_STATUS)
    .is('deleted_at', null)
    .gt('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true });
  if (error) throw new Error(`Could not load scheduled Instagram event posts: ${error.message}`);
  const rows = (data ?? []) as unknown as ItemRow[];

  const jobs = new Map<string, string[]>();
  if (rows.length) {
    const { data: jobRows, error: jobError } = await db
      .from('publish_jobs')
      .select('content_item_id, status')
      .eq('account_id', options.accountId)
      .in('content_item_id', rows.map((row) => row.id));
    if (jobError) throw new Error(`Could not load publish jobs: ${jobError.message}`);
    for (const job of (jobRows ?? []) as Array<{ content_item_id: string; status: string }>) {
      jobs.set(job.content_item_id, [...(jobs.get(job.content_item_id) ?? []), job.status]);
    }
  }

  const plan: BookingLinePlan = {
    kind: PLAN_KIND,
    version: PLAN_VERSION,
    accountId: options.accountId,
    createdAt: now.toISOString(),
    posts: [],
    skipped: [],
  };
  for (const row of rows) {
    const skip = (reason: string): void => {
      plan.skipped.push({ contentItemId: row.id, scheduledFor: row.scheduled_for, reason });
    };
    const variant = firstVariant(row.content_variants);
    const statuses = jobs.get(row.id) ?? [];
    if (Date.parse(row.scheduled_for) <= cutoffMs) {
      skip(`due within ${BACKFILL_LEAD_MINUTES} minutes`);
      continue;
    }
    if (statuses.some((status) => !WAITING_JOB_STATUSES.has(status))) {
      skip(`publishing has started (${statuses.join(', ')})`);
      continue;
    }
    if (!variant?.body?.trim()) {
      skip('no caption');
      continue;
    }
    const brief = asRecord(asRecord(variant.preview_data)?.brief) ?? asRecord(row.prompt_context?.brief);
    const eventName = typeof brief?.eventName === 'string' ? brief.eventName : null;
    const change = changeForPost(variant.body, variant.preview_data, eventName);
    if ('reason' in change) {
      skip(change.reason);
      continue;
    }
    plan.posts.push({
      contentItemId: row.id,
      variantId: variant.id,
      scheduledFor: row.scheduled_for,
      eventName: eventName!.trim(),
      oldLine: change.oldLine,
      newLine: change.newLine,
      oldBody: variant.body,
      newBody: change.newBody,
      oldPreviewData: variant.preview_data ?? {},
      newPreviewData: change.newPreviewData,
    });
  }
  return plan;
}

export function parseBookingLinePlan(raw: unknown): BookingLinePlan {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a booking-line plan: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
  return parsed.data;
}

export interface BackfillOutcome {
  written: string[];
  skipped: Array<{ contentItemId: string; reason: string }>;
  failed: Array<{ contentItemId: string; error: string }>;
}

/**
 * Write a reviewed plan, or in rollback mode put the old lines back. Each post
 * is re-read first and written only when it still carries the text the plan
 * expects, at the time planned, waiting to publish and more than an hour away.
 * Anything else is left exactly as it is and reported.
 */
export async function applyBookingLinePlan(
  db: SupabaseClient,
  plan: BookingLinePlan,
  options: { mode: 'apply' | 'rollback'; now?: () => Date },
): Promise<BackfillOutcome> {
  const outcome: BackfillOutcome = { written: [], skipped: [], failed: [] };
  const rollback = options.mode === 'rollback';

  for (const post of plan.posts) {
    const expectedBody = rollback ? post.newBody : post.oldBody;
    const targetBody = rollback ? post.oldBody : post.newBody;
    const targetPreview = rollback ? post.oldPreviewData : post.newPreviewData;
    const skip = (reason: string): void => {
      outcome.skipped.push({ contentItemId: post.contentItemId, reason });
    };
    try {
      const { data: item, error: itemError } = await db
        .from('content_items')
        .select('id, status, scheduled_for, deleted_at')
        .eq('id', post.contentItemId)
        .eq('account_id', plan.accountId)
        .maybeSingle<{ id: string; status: string; scheduled_for: string; deleted_at: string | null }>();
      if (itemError) throw new Error(itemError.message);
      if (!item || item.deleted_at) {
        skip('the post no longer exists');
        continue;
      }
      if (item.status !== CHANGEABLE_STATUS) {
        skip(`status is now ${item.status}`);
        continue;
      }
      if (Date.parse(item.scheduled_for) !== Date.parse(post.scheduledFor)) {
        skip('the post has been moved since the plan was made');
        continue;
      }
      const nowMs = (options.now?.() ?? new Date()).getTime();
      if (Date.parse(item.scheduled_for) <= nowMs + BACKFILL_LEAD_MINUTES * 60_000) {
        skip(`due within ${BACKFILL_LEAD_MINUTES} minutes`);
        continue;
      }

      const { data: jobs, error: jobError } = await db
        .from('publish_jobs')
        .select('status')
        .eq('account_id', plan.accountId)
        .eq('content_item_id', post.contentItemId);
      if (jobError) throw new Error(jobError.message);
      const busy = ((jobs ?? []) as Array<{ status: string }>).filter((job) => !WAITING_JOB_STATUSES.has(job.status));
      if (busy.length) {
        skip(`publishing has started (${busy.map((job) => job.status).join(', ')})`);
        continue;
      }

      const { data: variant, error: variantError } = await db
        .from('content_variants')
        .select('id, body')
        .eq('id', post.variantId)
        .eq('content_item_id', post.contentItemId)
        .maybeSingle<{ id: string; body: string | null }>();
      if (variantError) throw new Error(variantError.message);
      if (!variant) {
        skip('the post text record no longer exists');
        continue;
      }
      if ((variant.body ?? '') !== expectedBody) {
        skip(variant.body === targetBody ? 'already done' : 'the caption has been changed since the plan was made');
        continue;
      }

      // The expected caption is part of the update itself, so an edit made between
      // the read above and this write is never overwritten.
      const { data: updated, error: updateError } = await db
        .from('content_variants')
        .update({ body: targetBody, preview_data: targetPreview })
        .eq('id', post.variantId)
        .eq('content_item_id', post.contentItemId)
        .eq('body', expectedBody)
        .select('id');
      if (updateError) throw new Error(updateError.message);
      if (!updated?.length) {
        skip('the caption was changed while this ran');
        continue;
      }

      const { error: touchError } = await db
        .from('content_items')
        .update({ updated_at: new Date(nowMs).toISOString() })
        .eq('id', post.contentItemId)
        .eq('account_id', plan.accountId);
      if (touchError) throw new Error(touchError.message);
      outcome.written.push(post.contentItemId);
    } catch (error) {
      outcome.failed.push({ contentItemId: post.contentItemId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

/** The owner's list: when each post goes out, its event, and the line before and after. */
export function renderBookingLineReport(plan: BookingLinePlan): string {
  const cell = (value: string): string => value.replace(/\|/g, '\\|').trim();
  const lines = [
    '# Instagram booking lines that will name their event',
    '',
    `Plan made ${londonLabel(plan.createdAt)} (London). ${plan.posts.length} posts change, ${plan.skipped.length} left alone. Only the booking line changes; nothing else in the post.`,
    '',
    '| # | Goes out (London) | Event | Old line | New line |',
    '|---|---|---|---|---|',
    ...plan.posts.map((post, index) =>
      `| ${index + 1} | ${londonLabel(post.scheduledFor)} | ${cell(post.eventName)} | ${cell(post.oldLine)} | ${cell(post.newLine)} |`),
  ];
  if (plan.skipped.length) {
    lines.push('', '## Left alone', '', ...plan.skipped.map((post) => `- ${londonLabel(post.scheduledFor)} (${post.contentItemId}): ${post.reason}`));
  }
  return `${lines.join('\n')}\n`;
}
