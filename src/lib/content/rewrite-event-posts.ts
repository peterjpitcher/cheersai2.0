import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { contentBriefSchema, type ContentBrief } from '@/features/create/schemas/content-schemas';
import { resolveCopyModel } from '@/lib/ai/models';
import { toPlatformCopy } from '@/lib/ai/platform-copy';
import {
  SLOT_JOB_LABELS,
  openingOf,
  planSlotJobs,
  questionAllowed,
  questionsIn,
  slotJobSignals,
  type CampaignSlotPlan,
  type SlotJob,
} from '@/lib/ai/slot-jobs';
import { loadBrandProfile, loadMediaMetadata, writeCopy } from '@/lib/ai/write-copy';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ManagementEventDetail, ManagementEventListItem } from '@/lib/management-app/client';
import { stripImportedFormatting, type EventFactSheet } from '@/lib/management-app/event-facts';
import { mapManagementEventToEventCampaignPrefill } from '@/lib/management-app/mappers';
import { buildPreviewData, composePublishBody } from '@/lib/publishing/compose-body';
import { readPlatformCtaLinks } from '@/lib/publishing/copy-rules';
import { evaluateTemporalDrift } from '@/lib/publishing/temporal-drift';
import type { Platform, PlatformCopy } from '@/types/content';

/**
 * Rewriting the copy of event posts that are already scheduled, with the
 * current copy engine (tasks/SPEC-event-copy-engine.md B8): the house-style
 * prompts and checks (B1), the events system's facts (B2) and the configured
 * model (B4).
 *
 * Two steps, so only text the owner has read is ever written:
 * 1. planEventPostRewrites changes no post. It writes each slot's copy afresh
 *    and returns a plan holding, per post, the old text and the new text.
 * 2. applyRewritePlan writes exactly that plan, post by post, and only where
 *    the post is still the one planned: the same text and time, still waiting
 *    to publish, and more than an hour away. In rollback mode it puts the old
 *    text back on the same terms.
 *
 * Stories carry no text and are never touched.
 */

/** Posts due sooner than this are left alone: the publish worker may be loading them. */
export const REWRITE_LEAD_MINUTES = 60;
const PLAN_VERSION = 1;
const WAITING_JOB_STATUSES = new Set(['queued']);
const REWRITABLE_STATUS = 'scheduled';
const DEFAULT_TONE = 'friendly_warm';
const IMPORTED_SUMMARY_LEAD = 'Imported from management app event "';
const CANCELLED_EVENT = /cancel|postpon/i;

type FeedPlatform = Extract<Platform, 'facebook' | 'instagram'>;

export interface PlannedPost {
  contentItemId: string;
  variantId: string;
  platform: FeedPlatform;
  scheduledFor: string;
  oldBody: string;
  newBody: string;
  oldPreviewData: Record<string, unknown> | null;
  newPreviewData: Record<string, unknown>;
}

export interface PlannedSlot {
  campaignId: string | null;
  campaignName: string;
  scheduledFor: string;
  slotLabel: string | null;
  /** The post's job in its campaign (B3). */
  job?: SlotJob;
  posts: PlannedPost[];
  warnings: string[];
}

export interface SkippedPost {
  contentItemId: string;
  campaignName: string;
  platform: string;
  scheduledFor: string;
  reason: string;
}

export interface EventSummary {
  campaignId: string | null;
  campaignName: string;
  eventName: string;
  eventDate: string;
  facts: EventFactSheet | null;
  tone: string | null;
  ownerNote?: string;
  notes: string[];
}

export interface RewritePlan {
  version: typeof PLAN_VERSION;
  createdAt: string;
  model: string;
  accountId: string;
  slots: PlannedSlot[];
  skipped: SkippedPost[];
  storiesLeftAlone: number;
  events: EventSummary[];
}

/** Finds one event in the management app by its name and London date. */
export type FindManagementEvent = (query: { eventName: string; eventDate: string }) => Promise<ManagementEventDetail | null>;

export interface PlanDeps {
  db: SupabaseClient;
  findEvent: FindManagementEvent;
  write?: typeof writeCopy;
  now?: () => Date;
  model?: string;
  log?: (line: string) => void;
}

export interface PlanOptions {
  accountId: string;
  campaignIds?: string[];
  /** Guidance from the owner for this run, added to each brief as owner notes, as typed in the wizard. */
  ownerNote?: string;
  concurrency?: number;
}

interface VariantRow {
  id: string;
  body: string | null;
  media_ids: string[] | null;
  preview_data: Record<string, unknown> | null;
}

interface ItemRow {
  id: string;
  campaign_id: string | null;
  platform: string;
  placement: string | null;
  status: string;
  scheduled_for: string;
  prompt_context: Record<string, unknown> | null;
  campaigns: { name: string | null } | Array<{ name: string | null }> | null;
  content_variants: VariantRow | VariantRow[] | null;
}

interface EligiblePost {
  row: ItemRow;
  variant: VariantRow & { body: string };
  platform: FeedPlatform;
  brief: Record<string, unknown>;
  campaignName: string;
}

interface EventContext {
  summary: EventSummary;
  brief: Record<string, unknown>;
  cancelled: boolean;
}

interface SlotOutcome {
  slot: PlannedSlot | null;
  skipped: SkippedPost[];
  copy?: PlatformCopy;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** "Sat 19 Oct, 07:00" in London. */
export function londonLabel(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone(DEFAULT_TIMEZONE).toFormat('ccc d LLL, HH:mm');
}

/** The venue's own notes from a stored brief, without the import summary line the fact sheet replaces. */
function storedDescription(prompt: unknown): string {
  const value = typeof prompt === 'string' ? prompt : '';
  const index = value.indexOf(IMPORTED_SUMMARY_LEAD);
  return stripImportedFormatting(index >= 0 ? value.slice(0, index) : value);
}

/**
 * The brief a post would get if the owner made it today in the wizard: the
 * events system's current description and fact sheet, and a tone for the kind
 * of event when the owner never chose one. Dates, times and links stay as
 * scheduled; any difference is reported for the owner instead.
 */
export function rebuildEventBrief(
  stored: Record<string, unknown>,
  detail: ManagementEventDetail | null,
): { brief: Record<string, unknown>; facts: EventFactSheet | null; notes: string[]; cancelled: boolean } {
  const storedDate = text(stored.eventDate) ?? '';
  const storedTime = text(stored.eventTime) ?? '';
  if (!detail) {
    return {
      brief: { ...stored, prompt: stripImportedFormatting(typeof stored.prompt === 'string' ? stored.prompt : '') },
      facts: null,
      notes: ['Not found in the events system, so these posts are written from the brief they were made with, without a fact sheet.'],
      cancelled: false,
    };
  }

  const { fields } = mapManagementEventToEventCampaignPrefill(detail);
  const facts = fields.facts && Object.keys(fields.facts).length ? fields.facts : null;
  const notes: string[] = [];
  const status = text(detail.event_status);
  const cancelled = Boolean(status && CANCELLED_EVENT.test(status));
  if (cancelled) notes.push(`The events system marks this event "${status}", so its posts are left alone.`);
  if ((fields.startDate && fields.startDate !== storedDate) || (fields.startTime && fields.startTime !== storedTime)) {
    notes.push(
      `The events system now has this on ${fields.startDate} at ${fields.startTime}; the posts were made for ${storedDate} at ${storedTime}. The rewrite keeps the posts' date and time, so check before approving.`,
    );
  }

  const liveDescription = fields.description ?? '';
  const previous = storedDescription(stored.prompt);
  if (liveDescription && previous && liveDescription !== previous) {
    notes.push('The event description in the events system has changed since these posts were made; the rewrite uses the current one.');
  }

  // The wizard's import rule: with a fact sheet the summary line would only
  // repeat it, so the brief keeps just the venue's own notes.
  const description = liveDescription || previous;
  const prompt = facts
    ? description
    : [description, fields.prompt].filter(Boolean).join('\n\n');
  const storedTone = text(stored.tone) ?? DEFAULT_TONE;
  const tone = storedTone === DEFAULT_TONE && fields.suggestedTone ? fields.suggestedTone : storedTone;

  const brief: Record<string, unknown> = { ...stored, prompt, tone };
  if (facts) brief.facts = facts;
  else delete brief.facts;
  return { brief, facts, notes, cancelled };
}

/**
 * Pick the events-system record behind a campaign: the same name on the same
 * date, else the only event with that name (a moved event, which the report
 * then flags), else nothing. When several events share the name, none is
 * borrowed, so one night of a series never lends its facts to another.
 */
export function chooseManagementEvent(
  events: ManagementEventListItem[],
  eventName: string,
  eventDate: string,
): ManagementEventListItem | null {
  const wanted = eventName.trim().toLowerCase();
  const named = events.filter((event) => event.name?.trim().toLowerCase() === wanted);
  const sameDay = named.find((event) => event.date === eventDate);
  if (sameDay) return sameDay;
  return named.length === 1 ? named[0] : null;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function slotKeyOf(post: EligiblePost): string {
  const slotKey = text(post.row.prompt_context?.slotKey) ?? '';
  return `${post.row.campaign_id ?? ''}|${slotKey}|${Date.parse(post.row.scheduled_for)}`;
}

/** Load the account's future event posts with their text and publish jobs. */
async function loadEventPosts(db: SupabaseClient, accountId: string, fromIso: string, campaignIds?: string[]): Promise<{ rows: ItemRow[]; jobs: Map<string, string[]> }> {
  let query = db
    .from('content_items')
    .select('id, campaign_id, platform, placement, status, scheduled_for, prompt_context, campaigns(name), content_variants(id, body, media_ids, preview_data)')
    .eq('account_id', accountId)
    .eq('content_type', 'event')
    .is('deleted_at', null)
    .gt('scheduled_for', fromIso)
    .order('scheduled_for', { ascending: true });
  if (campaignIds?.length) query = query.in('campaign_id', campaignIds);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load scheduled event posts: ${error.message}`);
  const rows = (data ?? []) as unknown as ItemRow[];

  const jobs = new Map<string, string[]>();
  if (rows.length) {
    const { data: jobRows, error: jobError } = await db
      .from('publish_jobs')
      .select('content_item_id, status')
      .in('content_item_id', rows.map((row) => row.id));
    if (jobError) throw new Error(`Could not load publish jobs: ${jobError.message}`);
    for (const job of (jobRows ?? []) as Array<{ content_item_id: string; status: string }>) {
      jobs.set(job.content_item_id, [...(jobs.get(job.content_item_id) ?? []), job.status]);
    }
  }
  return { rows, jobs };
}

/** Why a post cannot be rewritten, or null when it can. */
function ineligibleReason(row: ItemRow, variant: VariantRow | null, jobStatuses: string[], cutoffMs: number): string | null {
  if (row.status !== REWRITABLE_STATUS) return `status is ${row.status}`;
  if (Date.parse(row.scheduled_for) <= cutoffMs) return `due within ${REWRITE_LEAD_MINUTES} minutes`;
  if (jobStatuses.some((status) => !WAITING_JOB_STATUSES.has(status))) return `publishing has started (${jobStatuses.join(', ')})`;
  if (row.platform !== 'facebook' && row.platform !== 'instagram') return `platform ${row.platform} is not rewritten`;
  if (!variant?.body?.trim()) return 'no text to rewrite';
  const brief = asRecord(row.prompt_context?.brief);
  if (!brief || brief.contentType !== 'event') return 'no event brief stored with the post';
  return null;
}

/**
 * Write new copy for every eligible scheduled event post of one account and
 * return the plan. Changes no post; the AI calls are recorded in the usage
 * log as the wizard's are.
 */
export async function planEventPostRewrites(deps: PlanDeps, options: PlanOptions): Promise<RewritePlan> {
  const now = deps.now?.() ?? new Date();
  const write = deps.write ?? writeCopy;
  const log = deps.log ?? (() => undefined);
  const cutoffMs = now.getTime() + REWRITE_LEAD_MINUTES * 60_000;
  const { rows, jobs } = await loadEventPosts(deps.db, options.accountId, now.toISOString(), options.campaignIds);

  const skipped: SkippedPost[] = [];
  const eligible: EligiblePost[] = [];
  let storiesLeftAlone = 0;
  for (const row of rows) {
    const campaignName = text(first(row.campaigns)?.name) ?? 'Untitled campaign';
    if (row.placement === 'story') {
      storiesLeftAlone += 1;
      continue;
    }
    const variant = first(row.content_variants);
    const reason = ineligibleReason(row, variant, jobs.get(row.id) ?? [], cutoffMs);
    if (reason || !variant?.body) {
      skipped.push({ contentItemId: row.id, campaignName, platform: row.platform, scheduledFor: row.scheduled_for, reason: reason ?? 'no text to rewrite' });
      continue;
    }
    eligible.push({
      row,
      variant: { ...variant, body: variant.body },
      platform: row.platform as FeedPlatform,
      brief: asRecord(row.prompt_context?.brief) ?? {},
      campaignName,
    });
  }

  // One events-system lookup per campaign.
  const events = new Map<string, EventContext>();
  for (const post of eligible) {
    const key = post.row.campaign_id ?? '';
    if (events.has(key)) continue;
    const eventName = text(post.brief.eventName) ?? post.campaignName;
    const eventDate = text(post.brief.eventDate) ?? '';
    let detail: ManagementEventDetail | null = null;
    let lookupNote: string | null = null;
    try {
      detail = await deps.findEvent({ eventName, eventDate });
    } catch (error) {
      lookupNote = `The events system could not be reached (${error instanceof Error ? error.message : String(error)}).`;
    }
    const rebuilt = rebuildEventBrief(post.brief, detail);
    const ownerNote = options.ownerNote?.trim() || undefined;
    if (ownerNote) {
      rebuilt.brief.prompt = [text(rebuilt.brief.prompt), `Owner notes: ${ownerNote}`].filter(Boolean).join('\n\n');
    }
    events.set(key, {
      brief: rebuilt.brief,
      cancelled: rebuilt.cancelled,
      summary: {
        campaignId: post.row.campaign_id,
        campaignName: post.campaignName,
        eventName,
        eventDate,
        facts: rebuilt.facts,
        tone: text(rebuilt.brief.tone),
        ownerNote,
        notes: lookupNote ? [lookupNote, ...rebuilt.notes] : rebuilt.notes,
      },
    });
  }

  const slotGroups = new Map<string, EligiblePost[]>();
  for (const post of eligible) {
    const key = slotKeyOf(post);
    slotGroups.set(key, [...(slotGroups.get(key) ?? []), post]);
  }
  // Each campaign's slots, in the order they go out.
  const campaigns = new Map<string, EligiblePost[][]>();
  for (const posts of slotGroups.values()) {
    const key = posts[0].row.campaign_id ?? '';
    campaigns.set(key, [...(campaigns.get(key) ?? []), posts]);
  }
  for (const campaignSlots of campaigns.values()) {
    campaignSlots.sort((a, b) => Date.parse(a[0].row.scheduled_for) - Date.parse(b[0].row.scheduled_for));
  }

  const brand = await loadBrandProfile(deps.db, options.accountId);
  let done = 0;
  const leaveAlone = (posts: EligiblePost[], reason: string): SkippedPost[] =>
    posts.map((post) => ({ contentItemId: post.row.id, campaignName: post.campaignName, platform: post.platform, scheduledFor: post.row.scheduled_for, reason }));

  /** Write one slot (its Facebook and Instagram posts) and check the result. */
  const writeSlot = async (posts: EligiblePost[], event: EventContext, brief: Extract<ContentBrief, { contentType: 'event' }>, campaign: CampaignSlotPlan): Promise<SlotOutcome> => {
    const lead = posts[0];
    const scheduledFor = lead.row.scheduled_for;
    const label = `${lead.campaignName}, ${londonLabel(scheduledFor)}`;
    const slotLabel = text(lead.row.prompt_context?.slotLabel);
    const slotKey = text(lead.row.prompt_context?.slotKey) ?? undefined;
    const media = await loadMediaMetadata(deps.db, options.accountId, lead.variant.media_ids);
    const input = {
      brief,
      brand,
      accountId: options.accountId,
      scheduledAt: scheduledFor,
      slotLabel: slotLabel ?? undefined,
      media,
      campaign,
    };

    let result: Awaited<ReturnType<typeof writeCopy>> | null = null;
    let failure = '';
    for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
      try {
        result = await write(input);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        log(`  ${label}: attempt ${attempt} failed: ${failure}`);
      }
    }
    done += 1;
    log(`Wrote ${done}/${slotGroups.size}: ${label} (${SLOT_JOB_LABELS[campaign.job]})`);
    if (!result) return { slot: null, skipped: leaveAlone(posts, `the AI could not write it (${failure})`) };

    const copy = toPlatformCopy(result.processed.copy);
    const ctaLinks = readPlatformCtaLinks(event.brief);
    const ctaLabel = typeof event.brief.ctaLabel === 'string' ? event.brief.ctaLabel : undefined;
    const planned: PlannedPost[] = [];
    const slotSkipped: SkippedPost[] = [];
    for (const post of posts) {
      const platformCopy = copy[post.platform];
      const newBody = composePublishBody(post.platform, platformCopy, { ctaLinks, contentType: 'event', ctaLabel });
      const drift = evaluateTemporalDrift({
        body: newBody,
        promptContext: post.row.prompt_context,
        publishAt: DateTime.fromISO(scheduledFor, { setZone: true }),
      });
      if (!newBody.trim()) {
        slotSkipped.push(...leaveAlone([post], 'the new text came back empty'));
        continue;
      }
      if (drift.stale) {
        slotSkipped.push(...leaveAlone([post], `the new text says ${drift.untrue.join(', ')}, which is untrue at its time`));
        continue;
      }
      planned.push({
        contentItemId: post.row.id,
        variantId: post.variant.id,
        platform: post.platform,
        scheduledFor,
        oldBody: post.variant.body,
        newBody,
        oldPreviewData: post.variant.preview_data,
        newPreviewData: buildPreviewData(
          post.platform,
          platformCopy,
          { slotLabel: slotLabel ?? undefined, slotKey, brief: event.brief },
          { ctaLinks, contentType: 'event' },
        ),
      });
    }
    const slot: PlannedSlot | null = planned.length
      ? { campaignId: lead.row.campaign_id, campaignName: lead.campaignName, scheduledFor, slotLabel, job: campaign.job, posts: planned, warnings: result.processed.warnings }
      : null;
    return { slot, skipped: slotSkipped, copy };
  };

  // Campaigns are written side by side; within a campaign the posts are
  // written in order, each told its job and how the earlier posts opened (B3).
  const outcomes = await mapWithConcurrency([...campaigns.entries()], options.concurrency ?? 3, async ([key, campaignSlots]) => {
    const event = events.get(key);
    const all = (reason: string): SlotOutcome[] => campaignSlots.map((posts) => ({ slot: null, skipped: leaveAlone(posts, reason) }));
    if (!event) return all('no event details');
    if (event.cancelled) return all('event cancelled in the events system');
    const parsed = contentBriefSchema.safeParse(event.brief);
    if (!parsed.success || parsed.data.contentType !== 'event') {
      return all(`the rebuilt brief is not valid (${parsed.success ? 'not an event' : parsed.error.issues[0]?.message ?? 'unknown'})`);
    }
    const brief = parsed.data;
    const host = brief.facts?.host ?? null;
    const jobPlan = planSlotJobs(
      campaignSlots.map((posts) => posts[0].row.scheduled_for),
      { eventDate: brief.eventDate, host, ...slotJobSignals(`${brief.prompt} ${JSON.stringify(brief.facts ?? {})}`) },
    );

    const results: SlotOutcome[] = [];
    const earlierOpenings: string[] = [];
    const earlierQuestions: string[] = [];
    for (const [index, posts] of campaignSlots.entries()) {
      const outcome = await writeSlot(posts, event, brief, {
        job: jobPlan[index],
        host,
        position: index + 1,
        total: campaignSlots.length,
        earlierOpenings: [...earlierOpenings],
        earlierQuestions: [...earlierQuestions],
        allowQuestion: questionAllowed(index + 1),
      });
      results.push(outcome);
      for (const body of outcome.copy ? [outcome.copy.facebook.body, outcome.copy.instagram.body] : []) {
        const opening = openingOf(body);
        if (opening) earlierOpenings.push(opening);
        earlierQuestions.push(...questionsIn(body));
      }
    }
    return results;
  });

  const slots: PlannedSlot[] = [];
  for (const outcome of outcomes.flat()) {
    if (outcome.slot) slots.push(outcome.slot);
    skipped.push(...outcome.skipped);
  }
  slots.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor) || a.campaignName.localeCompare(b.campaignName));

  return {
    version: PLAN_VERSION,
    createdAt: now.toISOString(),
    model: deps.model ?? resolveCopyModel(),
    accountId: options.accountId,
    slots,
    skipped,
    storiesLeftAlone,
    events: [...events.values()].map((event) => event.summary),
  };
}

// ---------------------------------------------------------------------------
// Applying a reviewed plan
// ---------------------------------------------------------------------------

const plannedPostSchema = z.object({
  contentItemId: z.string().uuid(),
  variantId: z.string().uuid(),
  platform: z.enum(['facebook', 'instagram']),
  scheduledFor: z.string().min(1),
  oldBody: z.string().min(1),
  newBody: z.string().min(1),
  oldPreviewData: z.record(z.string(), z.unknown()).nullable(),
  newPreviewData: z.record(z.string(), z.unknown()),
});

const rewritePlanSchema = z.object({
  version: z.literal(PLAN_VERSION),
  accountId: z.string().uuid(),
  model: z.string(),
  slots: z.array(z.object({ campaignName: z.string(), posts: z.array(plannedPostSchema) })),
});

/** Read a plan file's contents, refusing anything the apply step cannot trust. */
export function parseRewritePlan(raw: unknown): z.infer<typeof rewritePlanSchema> {
  const parsed = rewritePlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a rewrite plan: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
  return parsed.data;
}

export type ApplyMode = 'apply' | 'rollback';

export interface ApplyOutcome {
  written: string[];
  skipped: Array<{ contentItemId: string; reason: string }>;
  failed: Array<{ contentItemId: string; error: string }>;
}

/**
 * Write a reviewed plan (or, in rollback mode, put the old text back). Each
 * post is re-read first and written only when it still carries the text the
 * plan expects, at the time planned, waiting to publish and more than an hour
 * away. Anything else is left exactly as it is and reported.
 */
export async function applyRewritePlan(
  db: SupabaseClient,
  plan: z.infer<typeof rewritePlanSchema>,
  options: { mode: ApplyMode; now?: () => Date },
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { written: [], skipped: [], failed: [] };
  const rollback = options.mode === 'rollback';

  for (const post of plan.slots.flatMap((slot) => slot.posts)) {
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
      if (item.status !== REWRITABLE_STATUS) {
        skip(`status is now ${item.status}`);
        continue;
      }
      if (Date.parse(item.scheduled_for) !== Date.parse(post.scheduledFor)) {
        skip('the post has been moved since the plan was made');
        continue;
      }
      const nowMs = (options.now?.() ?? new Date()).getTime();
      if (Date.parse(item.scheduled_for) <= nowMs + REWRITE_LEAD_MINUTES * 60_000) {
        skip(`due within ${REWRITE_LEAD_MINUTES} minutes`);
        continue;
      }

      const { data: jobs, error: jobError } = await db
        .from('publish_jobs')
        .select('status')
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
        skip(variant.body === targetBody ? 'already done' : 'the text has been changed since the plan was made');
        continue;
      }

      const { data: updated, error: updateError } = await db
        .from('content_variants')
        .update({ body: targetBody, preview_data: targetPreview })
        .eq('id', post.variantId)
        .eq('content_item_id', post.contentItemId)
        .select('id');
      if (updateError) throw new Error(updateError.message);
      if (!updated?.length) throw new Error('the text record was not updated');

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

// ---------------------------------------------------------------------------
// The owner's before-and-after report
// ---------------------------------------------------------------------------

function quote(body: string): string {
  return body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function describeFacts(facts: EventFactSheet | null): string {
  if (!facts) return 'No fact sheet.';
  const parts = [
    facts.category ? `kind: ${facts.category}` : '',
    facts.times ? `times: ${facts.times}` : '',
    facts.price ? `price: ${facts.price}` : '',
    facts.booking ? `booking: ${facts.booking}` : '',
    facts.host ? `host: ${facts.host}` : '',
    facts.highlights?.length ? `${facts.highlights.length} highlights` : '',
    facts.pastEvent ? 'last time' : '',
    facts.faqs?.length ? `${facts.faqs.length} FAQs` : '',
  ].filter(Boolean);
  return `Facts used: ${parts.join('; ')}.`;
}

const PLATFORM_NAME: Record<FeedPlatform, string> = { facebook: 'Facebook', instagram: 'Instagram' };

/** The before-and-after list the owner approves in one go. */
export function renderRewriteReport(plan: RewritePlan): string {
  const posts = plan.slots.reduce((total, slot) => total + slot.posts.length, 0);
  const lines: string[] = [
    '# Scheduled event posts: before and after',
    '',
    `Written ${londonLabel(plan.createdAt)} (London) with ${plan.model}. ${posts} posts in ${plan.slots.length} slots would change. ${plan.skipped.length} posts are left alone (listed at the end), and ${plan.storiesLeftAlone} stories are untouched because they carry no text.`,
    '',
    'Nothing has changed yet. Applying writes exactly the text below, and only to posts that have not been edited, moved or published since this list was made.',
  ];

  const byCampaign = new Map<string, PlannedSlot[]>();
  for (const slot of plan.slots) byCampaign.set(slot.campaignName, [...(byCampaign.get(slot.campaignName) ?? []), slot]);
  for (const event of plan.events) {
    const slots = byCampaign.get(event.campaignName) ?? [];
    lines.push('', `## ${event.campaignName}`, '', `${event.eventDate}. ${describeFacts(event.facts)} Tone: ${event.tone ?? DEFAULT_TONE}.`);
    if (event.ownerNote) lines.push('', `Owner note used: ${event.ownerNote}`);
    for (const note of event.notes) lines.push('', `**Check:** ${note}`);
    for (const slot of slots) {
      lines.push('', `### ${londonLabel(slot.scheduledFor)}${slot.slotLabel ? ` (${slot.slotLabel})` : ''}`);
      if (slot.job) lines.push('', `Job: ${SLOT_JOB_LABELS[slot.job]}.`);
      for (const post of slot.posts) {
        lines.push('', `**${PLATFORM_NAME[post.platform]}, before**`, '', quote(post.oldBody), '', `**${PLATFORM_NAME[post.platform]}, after**`, '', quote(post.newBody));
      }
      if (slot.warnings.length) lines.push('', `Warnings: ${slot.warnings.join(' ')}`);
    }
  }

  if (plan.skipped.length) {
    lines.push('', '## Left alone', '');
    for (const post of plan.skipped) {
      lines.push(`- ${post.campaignName}, ${londonLabel(post.scheduledFor)}, ${post.platform}: ${post.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
