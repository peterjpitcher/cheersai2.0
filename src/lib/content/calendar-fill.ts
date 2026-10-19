import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { contentBriefSchema, type ContentBrief } from '@/features/create/schemas/content-schemas';
import { importedBriefText, toneAfterImport } from '@/features/create/forms/event-import';
import { resolveCopyModel } from '@/lib/ai/models';
import { toPlatformCopy } from '@/lib/ai/platform-copy';
import {
  openingOf,
  planSlotJobs,
  questionAllowed,
  questionsIn,
  slotJobSignals,
  type CampaignSlotPlan,
  type SlotJob,
} from '@/lib/ai/slot-jobs';
import { loadBrandProfile, loadMediaMetadata, writeCopy, type WriteCopyResult } from '@/lib/ai/write-copy';
import { DEFAULT_TIMEZONE, EVENT_DAY_POST_TIME } from '@/lib/constants';
import { chooseManagementEvent } from '@/lib/content/rewrite-event-posts';
import { buildGenerationTemporalContext } from '@/lib/create/temporal-context';
import type { ManagementEventDetail, ManagementEventListItem } from '@/lib/management-app/client';
import { mapManagementEventToEventCampaignPrefill } from '@/lib/management-app/mappers';
import { beforePromotionWindow, promotionWindowFrom, type PromotionWindow } from '@/lib/management-app/promotion-window';
import { composePublishBody } from '@/lib/publishing/compose-body';
import { readPlatformCtaLinks } from '@/lib/publishing/copy-rules';
import { evaluateTemporalDrift } from '@/lib/publishing/temporal-drift';
import type { PlatformCopy } from '@/types/content';

/**
 * Filling the posting calendar (tasks/SPEC-social-calendar-fill.md).
 *
 * A plan run changes nothing. It reads the schedule and the events system,
 * decides what each day needs, writes the copy and returns a plan for the
 * owner to approve in one go; calendar-fill-apply.ts writes exactly that plan.
 *
 * The rules, in the order they are applied:
 * 1. Build-up posts at 12:00 move to 11:00 the same day. When two posts on one
 *    platform share a minute, the one that is not an event-day post moves to
 *    11:00 (the one for the later event, when neither is). Build-up posts at
 *    7am are listed to move to 11:00 too, where 11:00 is free that day, but
 *    those moves are applied only when the owner agrees to them.
 * 2. An event with no campaign yet gets one when its posts would start in the
 *    period: up to four weekly posts, two days to go, one day to go and the
 *    event day, none before its promotion window opens. A weekly post that
 *    lands on a day that already has a post moves to the nearest empty day
 *    within two days, or is dropped. The countdown and event-day posts may be a
 *    day's second post.
 * 3. Every day still empty gets one post: the Sunday roast on a Saturday (or
 *    the Friday, once a week), weekday lunch Tuesday to Friday, private hire on
 *    the first empty day of each half month, and otherwise a build-up post for
 *    the soonest event open for promotion with no post in the two days before.
 *
 * Build-up and food posts go out at 11:00, event-day posts at 07:00, each with
 * its story at the same minute using the image's upright story version.
 */

export const PLAN_VERSION = 1;
export const BUILD_UP_TIME = '11:00';
const OLD_BUILD_UP_TIME = '12:00';
const EVENT_DAY_TIME = EVENT_DAY_POST_TIME;
/** Posts due sooner than this are never moved or added. */
export const LEAD_MINUTES = 60;
/** How far back the order rule looks for the last event of a type. */
const WINDOW_LOOKBACK_DAYS = 120;
/** How far past the period events and posts are read, so new campaigns see their whole run. */
const HORIZON_DAYS = 70;
/** Posts read before the period, for photo rotation and the build-up gap. */
const HISTORY_DAYS = 35;
const PHOTO_GAP_DAYS = 7;
const BUILD_UP_GAP_DAYS = 2;
const WEEKLY_SHIFTS = [-1, 1, -2, 2];
const MAX_WEEKLY_BEATS = 4;
const SLOT_STEP_MINUTES = 30;
/** Waiting, going out or gone out. "posted" is the live worker's word, "published" the v2 handler's. */
const OCCUPYING_STATUSES = new Set(['scheduled', 'queued', 'publishing', 'posted', 'published']);
const CANCELLED_EVENT = /cancel|postpon/i;

export type FeedPlatform = 'facebook' | 'instagram';
export const FEED_PLATFORMS: FeedPlatform[] = ['facebook', 'instagram'];

// ---------------------------------------------------------------------------
// Venue subjects: what fills a day with no event post
// ---------------------------------------------------------------------------

export const VENUE_SUBJECTS = ['lunch', 'roast', 'private_hire'] as const;
export type VenueSubjectKey = (typeof VENUE_SUBJECTS)[number];

const toneSchema = z.enum(['friendly_warm', 'professional', 'playful', 'sophisticated', 'community_focused']);

const venueSubjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    contentType: z.enum(['weekly_recurring', 'instant_post']),
    /** Weekly subjects: the days the thing happens (0 Sunday to 6 Saturday), not the posting days. */
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    /** Weekly subjects: when it starts on those days, HH:MM. */
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    ctaLabel: z.string().trim().min(1).max(40),
    ctaLinks: z.object({ facebook: z.string().url(), instagram: z.string().url() }),
    tone: toneSchema.default('friendly_warm'),
    /** The facts the copy may use, in the owner's words. */
    notes: z.string().trim().min(1),
    /** Where the facts came from and when they were checked, for the report. */
    source: z.string().trim().min(1),
    /** Library photos to rotate, best first. Empty until the owner approves one: the subject then posts nothing. */
    photos: z.array(z.string().uuid()),
  })
  .refine((subject) => subject.contentType !== 'weekly_recurring' || (subject.daysOfWeek && subject.time), {
    message: 'A weekly subject needs daysOfWeek and time',
  });

export const calendarSubjectsSchema = z.object({
  lunch: venueSubjectSchema.optional(),
  roast: venueSubjectSchema.optional(),
  private_hire: venueSubjectSchema.optional(),
});

export type VenueSubject = z.infer<typeof venueSubjectSchema>;
export type CalendarSubjects = z.infer<typeof calendarSubjectsSchema>;

// ---------------------------------------------------------------------------
// What the decisions work from
// ---------------------------------------------------------------------------

export interface CalendarPost {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  contentType: string;
  platform: string;
  placement: 'feed' | 'story';
  status: string;
  scheduledFor: string;
  slotKey: string | null;
  /** prompt_context.source, for example "tournament". */
  source: string | null;
  eventName: string | null;
  eventDate: string | null;
  mediaIds: string[];
  jobStatuses: string[];
  /** Feed posts: the published text and the brief it was written from (the rewritten one when there is one). */
  body: string | null;
  brief: Record<string, unknown> | null;
}

export interface CalendarEvent {
  id: string;
  name: string;
  slug: string | null;
  date: string;
  time: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  cancelled: boolean;
}

export interface PhotoInfo {
  id: string;
  fileName: string;
}

export interface DecideInput {
  from: string;
  to: string;
  now: Date;
  posts: CalendarPost[];
  events: CalendarEvent[];
  /** Usable photos per configured subject (square, with a story version, not hidden), best first. */
  subjects: Partial<Record<VenueSubjectKey, PhotoInfo[]>>;
}

export interface DayCounts {
  facebook: number;
  instagram: number;
}

export interface PlannedMove {
  campaignId: string | null;
  campaignName: string;
  items: Array<{ contentItemId: string; platform: string; placement: string }>;
  fromIso: string;
  toIso: string;
  /** early_build_up moves are optional: applied only when the owner agrees. */
  reason: 'build_up_time' | 'collision' | 'early_build_up';
}

export type SlotKind = 'weekly' | 'countdown' | 'event_day' | 'build_up' | 'venue';

export interface SlotDecision {
  date: string;
  scheduledAt: string;
  label: string;
  kind: SlotKind;
  dayFeedCounts: DayCounts;
  note?: string;
}

export interface NewCampaignDecision {
  event: CalendarEvent;
  window: PromotionWindow | null;
  slots: SlotDecision[];
}

export interface BuildUpDecision {
  event: CalendarEvent;
  window: PromotionWindow | null;
  campaignId: string;
  campaignName: string;
  slot: SlotDecision;
}

export interface VenueDecision {
  subject: VenueSubjectKey;
  photo: PhotoInfo;
  slot: SlotDecision;
}

export interface RuleBreak {
  campaignName: string;
  date: string;
  opensOn: string;
  afterEvent: string;
}

export interface CalendarDecision {
  moves: PlannedMove[];
  newCampaigns: NewCampaignDecision[];
  buildUps: BuildUpDecision[];
  venue: VenueDecision[];
  unfilled: Array<{ date: string; reason: string }>;
  ruleBreaks: RuleBreak[];
  notes: string[];
  /** Upcoming events with their campaign (when they have one) and window. */
  events: Array<{ event: CalendarEvent; campaignId: string | null; campaignName: string | null; window: PromotionWindow | null }>;
}

// ---------------------------------------------------------------------------
// London dates and times
// ---------------------------------------------------------------------------

function zoned(iso: string): DateTime {
  return DateTime.fromISO(iso, { setZone: true }).setZone(DEFAULT_TIMEZONE);
}

export function londonDate(iso: string): string {
  return zoned(iso).toISODate() ?? '';
}

export function londonTime(iso: string): string {
  return zoned(iso).toFormat('HH:mm');
}

/** The UTC instant of a London wall-clock time; 07:00 and 11:00 exist once on both clock-change days. */
export function atLondon(date: string, time: string): string {
  return DateTime.fromISO(`${date}T${time}`, { zone: DEFAULT_TIMEZONE }).toUTC().toISO() ?? '';
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: DEFAULT_TIMEZONE }).plus({ days }).toISODate() ?? '';
}

/** Luxon weekday: 1 Monday to 7 Sunday. */
function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: DEFAULT_TIMEZONE }).weekday;
}

function daysBetween(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b, { zone: DEFAULT_TIMEZONE }).diff(DateTime.fromISO(a, { zone: DEFAULT_TIMEZONE }), 'days').days);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

function addMinutes(time: string, minutes: number): string {
  return DateTime.fromFormat(time, 'HH:mm').plus({ minutes }).toFormat('HH:mm');
}

export function formatDay(date: string): string {
  return DateTime.fromISO(date, { zone: DEFAULT_TIMEZONE }).toFormat('ccc d LLL');
}

const normalise = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? '';

function isFeedPlatform(platform: string): platform is FeedPlatform {
  return platform === 'facebook' || platform === 'instagram';
}

// ---------------------------------------------------------------------------
// The schedule as slots: a campaign's posts at one time, feed and story
// ---------------------------------------------------------------------------

interface SlotGroup {
  key: string;
  campaignId: string | null;
  campaignName: string;
  scheduledFor: string;
  date: string;
  time: string;
  eventName: string | null;
  eventDate: string | null;
  items: CalendarPost[];
  feedPlatforms: Set<FeedPlatform>;
  movable: boolean;
}

function groupSlots(posts: CalendarPost[], leadMs: number): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();
  for (const post of posts) {
    const owner = post.campaignId ?? post.slotKey ?? post.id;
    const key = `${owner}|${Date.parse(post.scheduledFor)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        campaignId: post.campaignId,
        campaignName: post.campaignName ?? (post.source === 'tournament' ? 'Rugby' : 'Untitled'),
        scheduledFor: post.scheduledFor,
        date: londonDate(post.scheduledFor),
        time: londonTime(post.scheduledFor),
        eventName: post.eventName,
        eventDate: post.eventDate,
        items: [],
        feedPlatforms: new Set(),
        movable: true,
      };
      groups.set(key, group);
    }
    group.items.push(post);
    group.eventName ??= post.eventName;
    group.eventDate ??= post.eventDate;
    if (post.placement === 'feed' && isFeedPlatform(post.platform)) group.feedPlatforms.add(post.platform);
  }
  for (const group of groups.values()) {
    group.movable = group.items.every(
      (item) =>
        item.status === 'scheduled' &&
        item.contentType === 'event' &&
        item.jobStatuses.length > 0 &&
        item.jobStatuses.every((status) => status === 'queued') &&
        Date.parse(item.scheduledFor) > leadMs,
    );
  }
  return [...groups.values()];
}

interface DayEntry {
  time: string;
  eventId: string | null;
  platforms: FeedPlatform[];
  group?: SlotGroup;
}

/** What the plan knows is on each day: the existing slots, as moved, plus the ones it adds. */
class DayBook {
  private readonly byDay = new Map<string, DayEntry[]>();
  private readonly existingCounts = new Map<string, DayCounts>();

  constructor(groups: SlotGroup[], private readonly eventIdOf: (group: SlotGroup) => string | null) {
    for (const group of groups) {
      if (!group.feedPlatforms.size) continue;
      this.entries(group.date).push({ time: group.time, eventId: eventIdOf(group), platforms: [...group.feedPlatforms], group });
      const counts = this.existingCounts.get(group.date) ?? { facebook: 0, instagram: 0 };
      for (const platform of group.feedPlatforms) counts[platform] += 1;
      this.existingCounts.set(group.date, counts);
    }
  }

  private entries(date: string): DayEntry[] {
    let list = this.byDay.get(date);
    if (!list) {
      list = [];
      this.byDay.set(date, list);
    }
    return list;
  }

  /** Feed posts on the day, on whichever platform has more. */
  count(date: string): number {
    const entries = this.byDay.get(date) ?? [];
    return Math.max(0, ...FEED_PLATFORMS.map((platform) => entries.filter((entry) => entry.platforms.includes(platform)).length));
  }

  /** Feed posts already scheduled on the day when the plan was made, per platform. */
  existing(date: string): DayCounts {
    return { ...(this.existingCounts.get(date) ?? { facebook: 0, instagram: 0 }) };
  }

  takenAt(date: string, time: string, except?: SlotGroup): boolean {
    return (this.byDay.get(date) ?? []).some((entry) => entry.time === time && entry.group !== except);
  }

  /** The first free time from `time`, in half-hour steps, or null after a few tries. */
  freeTime(date: string, time: string, except?: SlotGroup): string | null {
    let candidate = time;
    for (let step = 0; step < 4; step += 1) {
      if (!this.takenAt(date, candidate, except)) return candidate;
      candidate = addMinutes(candidate, SLOT_STEP_MINUTES);
    }
    return null;
  }

  add(date: string, time: string, eventId: string | null): void {
    this.entries(date).push({ time, eventId, platforms: [...FEED_PLATFORMS] });
  }

  move(group: SlotGroup, time: string): void {
    const entry = (this.byDay.get(group.date) ?? []).find((candidate) => candidate.group === group);
    if (entry) entry.time = time;
    group.time = time;
  }

  /** Whether the event has a post (existing or planned) on any of the given days. */
  eventPostedOn(eventId: string, days: string[]): boolean {
    return days.some((day) => (this.byDay.get(day) ?? []).some((entry) => entry.eventId === eventId));
  }

  collisions(): Array<{ date: string; time: string; groups: SlotGroup[] }> {
    const found: Array<{ date: string; time: string; groups: SlotGroup[] }> = [];
    for (const [date, entries] of this.byDay) {
      const byTime = new Map<string, SlotGroup[]>();
      for (const entry of entries) {
        if (!entry.group) continue;
        byTime.set(entry.time, [...(byTime.get(entry.time) ?? []), entry.group]);
      }
      for (const [time, groups] of byTime) {
        const shared = FEED_PLATFORMS.some((platform) => groups.filter((group) => group.feedPlatforms.has(platform)).length > 1);
        if (shared) found.push({ date, time, groups });
      }
    }
    return found.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }
}

// ---------------------------------------------------------------------------
// The decisions (pure, so every rule is tested without a database)
// ---------------------------------------------------------------------------

function toListItem(event: CalendarEvent): ManagementEventListItem {
  return { id: event.id, name: event.name, date: event.date, slug: event.slug };
}

function slotMove(group: SlotGroup, time: string, reason: PlannedMove['reason']): PlannedMove {
  return {
    campaignId: group.campaignId,
    campaignName: group.campaignName,
    items: group.items.map((item) => ({ contentItemId: item.id, platform: item.platform, placement: item.placement })),
    fromIso: group.scheduledFor,
    toIso: atLondon(group.date, time),
    reason,
  };
}

/** Decide every move and new post for the period. */
export function decideCalendar(input: DecideInput): CalendarDecision {
  const { from, to } = input;
  const leadMs = input.now.getTime() + LEAD_MINUTES * 60_000;
  const tomorrow = addDays(DateTime.fromJSDate(input.now).setZone(DEFAULT_TIMEZONE).toISODate() ?? from, 1);
  const notes: string[] = [];
  const unfilled: Array<{ date: string; reason: string }> = [];

  const live = input.posts.filter((post) => OCCUPYING_STATUSES.has(post.status));
  const groups = groupSlots(live, leadMs);

  // Each event campaign, matched to its event in the events system.
  const campaigns = new Map<string, { name: string; eventName: string; eventDate: string; groups: SlotGroup[] }>();
  for (const group of groups) {
    if (!group.campaignId || !group.eventName || !group.eventDate) continue;
    const campaign = campaigns.get(group.campaignId) ?? { name: group.campaignName, eventName: group.eventName, eventDate: group.eventDate, groups: [] };
    campaign.groups.push(group);
    campaigns.set(group.campaignId, campaign);
  }
  const listItems = input.events.map(toListItem);
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const campaignOfEvent = new Map<string, string>();
  const eventOfCampaign = new Map<string, CalendarEvent>();
  for (const [campaignId, campaign] of campaigns) {
    const match = chooseManagementEvent(listItems, campaign.eventName, campaign.eventDate);
    const event = match ? eventById.get(match.id) : undefined;
    if (!event) continue;
    eventOfCampaign.set(campaignId, event);
    if (!campaignOfEvent.has(event.id)) campaignOfEvent.set(event.id, campaignId);
  }
  // Event posts kept by name and date too, so an event whose campaign the
  // events system no longer matches is never given a second campaign.
  const promotedEvents = new Set([...campaigns.values()].map((campaign) => `${normalise(campaign.eventName)}|${campaign.eventDate}`));

  const windowEvents = input.events.map((event) => ({
    id: event.id,
    name: event.name,
    date: event.date,
    categoryName: event.categoryName,
    categorySlug: event.categorySlug,
  }));
  const windows = new Map<string, PromotionWindow | null>();
  for (const event of input.events) {
    windows.set(
      event.id,
      promotionWindowFrom(windowEvents, { eventId: event.id, eventDate: event.date, categorySlug: event.categorySlug, categoryName: event.categoryName }),
    );
  }

  const book = new DayBook(groups, (group) => (group.campaignId ? eventOfCampaign.get(group.campaignId)?.id ?? null : null));

  // Posts already scheduled before their window opens: reported, never moved.
  const ruleBreaks: RuleBreak[] = [];
  for (const [campaignId, campaign] of campaigns) {
    const event = eventOfCampaign.get(campaignId);
    const window = event ? windows.get(event.id) : null;
    if (!window) continue;
    for (const group of campaign.groups) {
      if (group.items.some((item) => item.status === 'scheduled' || item.status === 'queued') && beforePromotionWindow(group.date, window)) {
        ruleBreaks.push({ campaignName: campaign.name, date: group.date, opensOn: window.opensOn, afterEvent: window.afterEvent });
      }
    }
  }

  // 1. Build-up posts at 12:00 move to 11:00; then shared minutes are cleared.
  const moves: PlannedMove[] = [];
  for (const group of groups) {
    if (!group.movable || !group.eventDate || group.date === group.eventDate || group.time !== OLD_BUILD_UP_TIME) continue;
    if (group.date < from || group.date > addDays(to, HORIZON_DAYS)) continue;
    if (book.takenAt(group.date, BUILD_UP_TIME, group)) {
      notes.push(`${group.campaignName} on ${formatDay(group.date)} stays at 12:00: 11:00 already has a post.`);
      continue;
    }
    moves.push(slotMove(group, BUILD_UP_TIME, 'build_up_time'));
    book.move(group, BUILD_UP_TIME);
  }
  for (const collision of book.collisions()) {
    if (collision.date < from) continue;
    const eventDayGroups = collision.groups.filter((group) => group.eventDate === group.date);
    const keeper = eventDayGroups[0]
      ?? [...collision.groups].sort((a, b) => Number(a.movable) - Number(b.movable) || (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))[0];
    for (const group of collision.groups) {
      if (group === keeper) continue;
      if (!group.movable || group.eventDate === group.date) {
        notes.push(`${group.campaignName} on ${formatDay(group.date)} at ${collision.time} shares its minute with another post but cannot be moved.`);
        continue;
      }
      const time = book.freeTime(group.date, BUILD_UP_TIME, group);
      if (!time) {
        notes.push(`${group.campaignName} on ${formatDay(group.date)} shares ${collision.time} with another post, and no time from 11:00 is free.`);
        continue;
      }
      const existing = moves.find((move) => move.fromIso === group.scheduledFor && move.campaignId === group.campaignId);
      if (existing) existing.toIso = atLondon(group.date, time);
      else moves.push(slotMove(group, time, 'collision'));
      book.move(group, time);
    }
  }

  const slotDecision = (date: string, time: string, label: string, kind: SlotKind, note?: string): SlotDecision => ({
    date,
    scheduledAt: atLondon(date, time),
    label,
    kind,
    dayFeedCounts: book.existing(date),
    ...(note ? { note } : {}),
  });

  // 2. New campaigns for events with none, when their posts would start in the period.
  const newCampaigns: NewCampaignDecision[] = [];
  const upcoming = input.events
    .filter((event) => event.date >= from && !event.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  for (const event of upcoming) {
    if (campaignOfEvent.has(event.id) || promotedEvents.has(`${normalise(event.name)}|${event.date}`)) continue;
    const window = windows.get(event.id) ?? null;
    const earliest = [from, tomorrow, window?.opensOn ?? from].sort().at(-1) as string;
    const planned: Array<{ slot: SlotDecision }> = [];
    const usedDays = new Set<string>();
    const placeFixed = (date: string, time: string, label: string, kind: SlotKind): void => {
      if (date < earliest) return;
      if (book.count(date) >= 2) {
        notes.push(`${event.name}: no "${label}" post on ${formatDay(date)}, which already has two posts.`);
        return;
      }
      const free = book.freeTime(date, time);
      if (!free) return;
      planned.push({ slot: slotDecision(date, free, label, kind) });
      usedDays.add(date);
    };
    // Tentative: nothing is booked until the campaign is kept.
    placeFixed(event.date, EVENT_DAY_TIME, 'Event day', 'event_day');
    placeFixed(addDays(event.date, -1), BUILD_UP_TIME, '1 day to go', 'countdown');
    placeFixed(addDays(event.date, -2), BUILD_UP_TIME, '2 days to go', 'countdown');
    const countdownStart = addDays(event.date, -2);
    const weeklyTaken = new Set<string>();
    for (let weeks = 1; weeks <= MAX_WEEKLY_BEATS; weeks += 1) {
      const target = addDays(event.date, -7 * weeks);
      if (target < earliest) break;
      const free = (day: string): boolean =>
        day >= earliest && day < countdownStart && !usedDays.has(day) && !weeklyTaken.has(day) && book.count(day) === 0;
      let day: string | null = free(target) ? target : null;
      let note: string | undefined;
      if (!day) {
        day = WEEKLY_SHIFTS.map((shift) => addDays(target, shift)).find(free) ?? null;
        note = day ? `Moved from ${formatDay(target)}, which already has a post.` : undefined;
      }
      if (!day) {
        notes.push(`${event.name}: the post ${weeks === 1 ? 'a week' : `${weeks} weeks`} before (${formatDay(target)}) is dropped; that day and the two either side already have posts.`);
        continue;
      }
      weeklyTaken.add(day);
      planned.push({ slot: slotDecision(day, BUILD_UP_TIME, weeks === 1 ? 'A week to go' : `${weeks} weeks to go`, 'weekly', note) });
    }
    const slots = planned.map((entry) => entry.slot).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    if (!slots.some((slot) => slot.date >= from && slot.date <= to)) continue;
    for (const slot of slots) book.add(slot.date, londonTime(slot.scheduledAt), event.id);
    newCampaigns.push({ event, window, slots });
  }

  // Optional: build-up posts at 7am move to 11:00 too (decision 5), where 11:00
  // is free that day. Listed for the owner, applied only with their yes.
  for (const group of groups) {
    if (!group.movable || !group.eventDate || group.date === group.eventDate || group.time !== EVENT_DAY_TIME) continue;
    if (group.date < from || group.date > addDays(to, HORIZON_DAYS)) continue;
    if (moves.some((move) => move.fromIso === group.scheduledFor && move.campaignId === group.campaignId)) continue;
    if (book.takenAt(group.date, BUILD_UP_TIME, group)) {
      notes.push(`${group.campaignName} on ${formatDay(group.date)} stays at 07:00: 11:00 already has a post that day.`);
      continue;
    }
    moves.push(slotMove(group, BUILD_UP_TIME, 'early_build_up'));
    book.move(group, BUILD_UP_TIME);
  }

  // 3. Every day still empty gets one post.
  const empty = new Set(eachDay([from, tomorrow].sort().at(-1) as string, to).filter((day) => book.count(day) === 0));
  const take = (day: string): void => {
    empty.delete(day);
    book.add(day, BUILD_UP_TIME, null);
  };
  const venueDays: Array<{ subject: VenueSubjectKey; date: string }> = [];
  // A subject with no usable photo steps aside, so its days go to the other
  // rules rather than being held for a post that cannot have an image.
  const usable = (key: VenueSubjectKey): boolean => {
    const photos = input.subjects[key];
    if (photos && !photos.length) notes.push(`No usable ${key.replace('_', ' ')} photo, so no ${key.replace('_', ' ')} posts until one is added.`);
    return Boolean(photos?.length);
  };

  if (usable('roast')) {
    const weeks = new Map<string, string[]>();
    for (const day of empty) {
      const weekStart = DateTime.fromISO(day, { zone: DEFAULT_TIMEZONE }).startOf('week').toISODate() ?? day;
      weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), day]);
    }
    for (const days of weeks.values()) {
      const pick = days.find((day) => weekdayOf(day) === 6) ?? days.find((day) => weekdayOf(day) === 5);
      if (!pick) continue;
      venueDays.push({ subject: 'roast', date: pick });
      take(pick);
    }
  }
  if (usable('lunch')) {
    for (const day of [...empty].sort()) {
      if (weekdayOf(day) < 2 || weekdayOf(day) > 5) continue;
      venueDays.push({ subject: 'lunch', date: day });
      take(day);
    }
  }
  if (usable('private_hire')) {
    const halves = new Map<string, string[]>();
    for (const day of [...empty].sort()) {
      const half = `${day.slice(0, 7)}|${Number(day.slice(8, 10)) <= 15 ? 1 : 2}`;
      halves.set(half, [...(halves.get(half) ?? []), day]);
    }
    for (const days of halves.values()) {
      venueDays.push({ subject: 'private_hire', date: days[0] });
      take(days[0]);
    }
  }

  // Build-up posts for the soonest event open for promotion, with a gap.
  const buildUps: BuildUpDecision[] = [];
  const promotable = [
    ...[...campaignOfEvent.entries()].map(([eventId, campaignId]) => ({ event: eventById.get(eventId) as CalendarEvent, campaignId })),
    ...newCampaigns.map((campaign) => ({ event: campaign.event, campaignId: null as string | null })),
  ].filter((entry) => entry.event && !entry.event.cancelled).sort((a, b) => a.event.date.localeCompare(b.event.date));
  for (const day of [...empty].sort()) {
    const before = Array.from({ length: BUILD_UP_GAP_DAYS }, (_, index) => addDays(day, -(index + 1)));
    const choice = promotable.find(({ event }) => {
      const window = windows.get(event.id) ?? null;
      return event.date > day && !beforePromotionWindow(day, window) && !book.eventPostedOn(event.id, before);
    });
    if (!choice) {
      unfilled.push({ date: day, reason: 'No event is open for promotion without a post in the two days before.' });
      continue;
    }
    const slot = slotDecision(day, BUILD_UP_TIME, 'Build-up', 'build_up');
    empty.delete(day);
    book.add(day, BUILD_UP_TIME, choice.event.id);
    const window = windows.get(choice.event.id) ?? null;
    if (choice.campaignId) {
      buildUps.push({ event: choice.event, window, campaignId: choice.campaignId, campaignName: campaigns.get(choice.campaignId)?.name ?? choice.event.name, slot });
    } else {
      const campaign = newCampaigns.find((entry) => entry.event.id === choice.event.id);
      campaign?.slots.push(slot);
      campaign?.slots.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    }
  }

  // Photos: the least recently used, never one used within a week.
  const photoUses = new Map<string, string[]>();
  for (const post of input.posts) {
    if (post.placement !== 'feed' || !OCCUPYING_STATUSES.has(post.status)) continue;
    for (const mediaId of post.mediaIds) photoUses.set(mediaId, [...(photoUses.get(mediaId) ?? []), londonDate(post.scheduledFor)]);
  }
  const venue: VenueDecision[] = [];
  for (const { subject, date } of venueDays.sort((a, b) => a.date.localeCompare(b.date))) {
    const photos = input.subjects[subject] ?? [];
    const free = photos.filter((photo) => !(photoUses.get(photo.id) ?? []).some((used) => Math.abs(daysBetween(used, date)) < PHOTO_GAP_DAYS));
    const lastUse = (photo: PhotoInfo): string => (photoUses.get(photo.id) ?? []).filter((used) => used < date).sort().at(-1) ?? '';
    const photo = [...free].sort((a, b) => lastUse(a).localeCompare(lastUse(b)) || photos.indexOf(a) - photos.indexOf(b))[0];
    if (!photo) {
      unfilled.push({ date, reason: `No ${subject.replace('_', ' ')} photo that has not been used in the week around it.` });
      continue;
    }
    photoUses.set(photo.id, [...(photoUses.get(photo.id) ?? []), date]);
    venue.push({ subject, photo, slot: slotDecision(date, BUILD_UP_TIME, subject, 'venue') });
  }

  const events = upcoming.map((event) => {
    const campaignId = campaignOfEvent.get(event.id) ?? null;
    return { event, campaignId, campaignName: campaignId ? campaigns.get(campaignId)?.name ?? null : null, window: windows.get(event.id) ?? null };
  });

  return {
    moves,
    newCampaigns,
    buildUps,
    venue,
    unfilled: unfilled.sort((a, b) => a.date.localeCompare(b.date)),
    ruleBreaks,
    notes,
    events,
  };
}

// ---------------------------------------------------------------------------
// The plan: decisions plus the copy for every new post
// ---------------------------------------------------------------------------

export type BatchKind = 'new_campaign' | 'build_up' | VenueSubjectKey;

export interface PlanSlot {
  slotKey: string;
  date: string;
  scheduledAt: string;
  label: string;
  job?: SlotJob;
  copy: PlatformCopy;
  bodies: Record<FeedPlatform, string>;
  mediaIds: string[];
  dayFeedCounts: DayCounts;
  warnings: string[];
  note?: string;
}

export interface PlanBatch {
  key: string;
  kind: BatchKind;
  title: string;
  contentType: 'event' | 'weekly_recurring' | 'instant_post';
  brief: Record<string, unknown>;
  existingCampaignId?: string;
  /** New campaigns: the event's artwork; imported on apply when there is no asset yet. */
  artwork?: { eventId: string; eventName: string; assetId: string | null; fileName: string | null };
  /** File names of the photos used, by media id, for the report. */
  photos: Record<string, string>;
  slots: PlanSlot[];
  notes: string[];
}

export interface CalendarPlan {
  version: typeof PLAN_VERSION;
  planId: string;
  createdAt: string;
  model: string;
  accountId: string;
  from: string;
  to: string;
  moves: PlannedMove[];
  batches: PlanBatch[];
  unfilled: Array<{ date: string; reason: string }>;
  ruleBreaks: RuleBreak[];
  notes: string[];
  /** Every day of the period as planned, for the report. */
  days: Array<{ date: string; entries: Array<{ time: string; title: string; status: 'existing' | 'moved' | 'optional' | 'new' }> }>;
  sources: Array<{ subject: VenueSubjectKey; title: string; source: string; links: Record<FeedPlatform, string> }>;
  events: Array<{ name: string; date: string; category: string | null; campaign: string | null; opensOn: string | null }>;
}

export interface CalendarFillDeps {
  db: SupabaseClient;
  listEvents: (range: { fromDate: string; toDate: string }) => Promise<ManagementEventListItem[]>;
  getEventDetail: (event: { id: string; slug: string | null }) => Promise<ManagementEventDetail>;
  write?: typeof writeCopy;
  now?: () => Date;
  model?: string;
  log?: (line: string) => void;
}

export interface CalendarFillOptions {
  accountId: string;
  from: string;
  to: string;
  subjects: CalendarSubjects;
  concurrency?: number;
}

interface PostRow {
  id: string;
  campaign_id: string | null;
  platform: string;
  placement: string | null;
  status: string;
  scheduled_for: string;
  content_type: string | null;
  prompt_context: Record<string, unknown> | null;
  campaigns: { name: string | null } | Array<{ name: string | null }> | null;
  content_variants: VariantRow | VariantRow[] | null;
}

interface VariantRow {
  body: string | null;
  media_ids: string[] | null;
  preview_data: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The account's posts around the period, with their text, media and publish jobs. */
export async function loadCalendarPosts(db: SupabaseClient, accountId: string, fromIso: string, toIso: string): Promise<CalendarPost[]> {
  const { data, error } = await db
    .from('content_items')
    .select('id, campaign_id, platform, placement, status, scheduled_for, content_type, prompt_context, campaigns(name), content_variants(body, media_ids, preview_data)')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .gte('scheduled_for', fromIso)
    .lte('scheduled_for', toIso)
    .order('scheduled_for', { ascending: true });
  if (error) throw new Error(`Could not load the schedule: ${error.message}`);
  const rows = (data ?? []) as unknown as PostRow[];

  const jobs = new Map<string, string[]>();
  for (let index = 0; index < rows.length; index += 200) {
    const ids = rows.slice(index, index + 200).map((row) => row.id);
    const { data: jobRows, error: jobError } = await db
      .from('publish_jobs')
      .select('content_item_id, status')
      .eq('account_id', accountId)
      .in('content_item_id', ids);
    if (jobError) throw new Error(`Could not load publish jobs: ${jobError.message}`);
    for (const job of (jobRows ?? []) as Array<{ content_item_id: string; status: string }>) {
      jobs.set(job.content_item_id, [...(jobs.get(job.content_item_id) ?? []), job.status]);
    }
  }

  return rows
    .filter((row) => row.scheduled_for)
    .map((row) => {
      const context = asRecord(row.prompt_context);
      const variant = first(row.content_variants);
      const storedBrief = asRecord(context?.brief);
      const rewrittenBrief = asRecord(asRecord(variant?.preview_data)?.brief);
      const brief = rewrittenBrief ?? storedBrief;
      return {
        id: row.id,
        campaignId: row.campaign_id,
        campaignName: text(first(row.campaigns)?.name),
        contentType: row.content_type ?? text(storedBrief?.contentType) ?? 'unknown',
        platform: row.platform,
        placement: row.placement === 'story' ? 'story' : 'feed',
        status: row.status,
        scheduledFor: row.scheduled_for,
        slotKey: text(context?.slotKey),
        source: text(context?.source),
        eventName: text(brief?.eventName),
        eventDate: text(brief?.eventDate),
        mediaIds: variant?.media_ids ?? [],
        jobStatuses: jobs.get(row.id) ?? [],
        body: variant?.body ?? null,
        brief,
      } satisfies CalendarPost;
    });
}

export function toCalendarEvent(item: ManagementEventListItem): CalendarEvent | null {
  const date = text(item.date) ?? text(item.startDate)?.slice(0, 10) ?? null;
  const name = text(item.name);
  if (!date || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id: item.id,
    name,
    slug: text(item.slug),
    date,
    time: text(item.time)?.slice(0, 5) ?? null,
    categoryName: text(item.categoryName),
    categorySlug: text(item.categorySlug),
    cancelled: CANCELLED_EVENT.test(item.event_status ?? ''),
  };
}

interface MediaRow {
  id: string;
  file_name: string | null;
  media_type: string | null;
  aspect_class: string | null;
  derived_variants: Record<string, unknown> | null;
  hidden_at: string | null;
  source_key?: string | null;
}

/** The subject's photos that can carry a feed post and its story: square or landscape, with a story version, not hidden. */
async function loadSubjectPhotos(
  db: SupabaseClient,
  accountId: string,
  subjects: CalendarSubjects,
): Promise<{ photos: Partial<Record<VenueSubjectKey, PhotoInfo[]>>; notes: string[] }> {
  const ids = VENUE_SUBJECTS.flatMap((key) => subjects[key]?.photos ?? []);
  const notes: string[] = [];
  if (!ids.length) return { photos: {}, notes };
  const { data, error } = await db
    .from('media_assets')
    .select('id, file_name, media_type, aspect_class, derived_variants, hidden_at')
    .eq('account_id', accountId)
    .in('id', ids);
  if (error) throw new Error(`Could not load the photos: ${error.message}`);
  const rows = new Map(((data ?? []) as MediaRow[]).map((row) => [row.id, row]));
  const photos: Partial<Record<VenueSubjectKey, PhotoInfo[]>> = {};
  for (const key of VENUE_SUBJECTS) {
    const subject = subjects[key];
    if (!subject) continue;
    photos[key] = subject.photos.flatMap((id) => {
      const row = rows.get(id);
      const problem = !row
        ? 'is not in the library'
        : row.hidden_at
          ? 'is hidden'
          : row.media_type !== 'image'
            ? 'is not an image'
            : row.aspect_class !== 'square' && row.aspect_class !== 'landscape'
              ? 'is not square or landscape, so it would be cropped on the feed'
              : typeof row.derived_variants?.story !== 'string'
                ? 'has no story version'
                : null;
      if (problem) {
        notes.push(`Photo ${row?.file_name ?? id} for ${subject.title} ${problem}, so it is not used.`);
        return [];
      }
      return [{ id, fileName: row?.file_name ?? id }];
    });
  }
  return { photos, notes };
}

/** The event's imported artwork, when the library already has it. */
async function findEventArtwork(db: SupabaseClient, accountId: string, eventId: string): Promise<{ id: string; fileName: string } | null> {
  const { data, error } = await db
    .from('media_assets')
    .select('id, file_name, media_type, aspect_class, derived_variants, hidden_at, source_key')
    .eq('account_id', accountId)
    .like('source_key', `ams:event:${eventId}:%`)
    .is('hidden_at', null);
  if (error) throw new Error(`Could not look up event artwork: ${error.message}`);
  const row = ((data ?? []) as MediaRow[]).find((candidate) => typeof candidate.derived_variants?.story === 'string');
  return row ? { id: row.id, fileName: row.file_name ?? row.id } : null;
}

async function loadDefaultVenue(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db
    .from('posting_defaults')
    .select('default_event_venue')
    .eq('account_id', accountId)
    .maybeSingle<{ default_event_venue: string | null }>();
  if (error) throw new Error(`Could not read the default venue: ${error.message}`);
  return text(data?.default_event_venue);
}

/** Wizard drafts for an event, so the owner is told before a second campaign is made. */
async function loadEventDrafts(db: SupabaseClient, accountId: string): Promise<Array<{ id: string; title: string; createdAt: string }>> {
  const { data, error } = await db
    .from('content_items')
    .select('id, title, created_at')
    .eq('account_id', accountId)
    .eq('status', 'draft')
    .eq('content_type', 'event')
    .is('deleted_at', null);
  if (error) throw new Error(`Could not load drafts: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; title: string | null; created_at: string }>).map((row) => ({
    id: row.id,
    title: row.title ?? '',
    createdAt: row.created_at,
  }));
}

/** The brief a new campaign gets: what the wizard's import would give it. */
export function briefForEvent(detail: ManagementEventDetail, window: PromotionWindow | null, venue: string | null): Record<string, unknown> {
  const { fields } = mapManagementEventToEventCampaignPrefill(detail);
  const facts = fields.facts && Object.keys(fields.facts).length ? fields.facts : undefined;
  const brief: Record<string, unknown> = {
    contentType: 'event',
    title: fields.name,
    eventName: fields.name,
    eventDate: fields.startDate,
    eventTime: fields.startTime,
    platforms: ['facebook', 'instagram'],
    placements: ['feed', 'story'],
    prompt: importedBriefText(fields, Boolean(facts)),
    tone: toneAfterImport({ ownerChoseTone: false, suggestedTone: fields.suggestedTone }) ?? 'friendly_warm',
    toneChosen: false,
    lengthPreference: 'standard',
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: 'default',
    proofPoints: [],
  };
  if (venue) brief.venue = venue;
  if (facts) brief.facts = facts;
  if (fields.ctaLinks && Object.keys(fields.ctaLinks).length) brief.ctaLinks = fields.ctaLinks;
  if (window) brief.promotionWindow = window;
  return brief;
}

/** The brief for a venue subject's posts in this run. */
export function briefForSubject(subject: VenueSubject, slotDates: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    contentType: subject.contentType,
    title: subject.title,
    prompt: subject.notes,
    platforms: ['facebook', 'instagram'],
    placements: ['feed', 'story'],
    tone: subject.tone,
    lengthPreference: 'standard',
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: 'default',
    proofPoints: [],
    ctaLinks: subject.ctaLinks,
    ctaLabel: subject.ctaLabel,
  };
  if (subject.contentType === 'weekly_recurring') {
    return {
      ...base,
      daysOfWeek: subject.daysOfWeek,
      time: subject.time,
      placement: 'feed',
      endDate: [...slotDates].sort().at(-1),
    };
  }
  return { ...base, publishMode: 'schedule' };
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

interface WrittenSlot {
  slot: PlanSlot | null;
  reason?: string;
}

/**
 * Plan the fill for one account and period. Reads only: the schedule, the
 * events system and the library. The copy is written with the configured
 * model and recorded in the usage log as the wizard's is.
 */
export async function planCalendarFill(deps: CalendarFillDeps, options: CalendarFillOptions): Promise<CalendarPlan> {
  const now = deps.now?.() ?? new Date();
  const write = deps.write ?? writeCopy;
  const log = deps.log ?? (() => undefined);
  const { db } = deps;
  const { accountId, from, to, subjects } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('The period needs a start and end date, YYYY-MM-DD, in order.');
  }
  const planId = DateTime.fromJSDate(now).setZone(DEFAULT_TIMEZONE).toFormat('yyyyLLddHHmmss');
  const horizon = addDays(to, HORIZON_DAYS);

  log('Reading the schedule, the events system and the library...');
  const posts = await loadCalendarPosts(db, accountId, atLondon(addDays(from, -HISTORY_DAYS), '00:00'), atLondon(horizon, '23:59'));
  const events = (await deps.listEvents({ fromDate: addDays(from, -WINDOW_LOOKBACK_DAYS), toDate: horizon }))
    .map(toCalendarEvent)
    .filter((event): event is CalendarEvent => Boolean(event));
  const { photos, notes: photoNotes } = await loadSubjectPhotos(db, accountId, subjects);

  const decision = decideCalendar({ from, to, now, posts, events, subjects: photos });
  const notes = [...photoNotes, ...decision.notes];
  const unfilled = [...decision.unfilled];

  const brand = await loadBrandProfile(db, accountId);
  const venueName = await loadDefaultVenue(db, accountId);
  const drafts = await loadEventDrafts(db, accountId);

  const writeOne = async (
    label: string,
    brief: ContentBrief,
    scheduledAt: string,
    slotLabel: string,
    mediaIds: string[],
    extra: { campaign?: CampaignSlotPlan; modifier?: string },
  ): Promise<{ result: WriteCopyResult | null; failure: string }> => {
    const media = mediaIds.length ? await loadMediaMetadata(db, accountId, mediaIds) : [];
    let failure = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await write({ brief, brand, accountId, scheduledAt, slotLabel, media, ...extra });
        log(`Wrote ${label}`);
        return { result, failure: '' };
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        log(`  ${label}: attempt ${attempt} failed: ${failure}`);
      }
    }
    return { result: null, failure };
  };

  /** Compose and check one written slot; null with a reason when it cannot go out. */
  const finish = (
    batchKey: string,
    brief: Record<string, unknown>,
    parsed: ContentBrief,
    decided: SlotDecision,
    result: WriteCopyResult,
    mediaIds: string[],
    job?: SlotJob,
  ): WrittenSlot => {
    const copy = toPlatformCopy(result.processed.copy);
    const ctaLinks = readPlatformCtaLinks(brief);
    const ctaLabel = typeof brief.ctaLabel === 'string' ? brief.ctaLabel : undefined;
    const slotKey = `calendar:${planId}:${batchKey}:${decided.date}`;
    const bodies = {} as Record<FeedPlatform, string>;
    for (const platform of FEED_PLATFORMS) {
      const body = composePublishBody(platform, copy[platform], { ctaLinks, contentType: parsed.contentType, ctaLabel });
      if (!body.trim()) return { slot: null, reason: `the ${platform} text came back empty` };
      const drift = evaluateTemporalDrift({
        body,
        promptContext: {
          slotKey,
          slotLabel: decided.label,
          placement: 'feed',
          ...buildGenerationTemporalContext({ contentType: parsed.contentType, brief, scheduledAt: decided.scheduledAt }),
          brief,
        },
        publishAt: DateTime.fromISO(decided.scheduledAt, { setZone: true }),
      });
      if (drift.stale) return { slot: null, reason: `the ${platform} text says ${drift.untrue.join(', ')}, which is untrue at its time` };
      bodies[platform] = body;
    }
    if (parsed.contentType === 'event' && beforePromotionWindow(decided.date, parsed.promotionWindow)) {
      return { slot: null, reason: 'it falls before the promotion window opens' };
    }
    return {
      slot: {
        slotKey,
        date: decided.date,
        scheduledAt: decided.scheduledAt,
        label: decided.label,
        ...(job ? { job } : {}),
        copy,
        bodies,
        mediaIds,
        dayFeedCounts: decided.dayFeedCounts,
        warnings: result.processed.warnings,
        ...(decided.note ? { note: decided.note } : {}),
      },
    };
  };

  const batches: PlanBatch[] = [];
  const dropped = (date: string, what: string, reason: string): void => {
    unfilled.push({ date, reason: `${what} was not written: ${reason}.` });
  };

  // New campaigns: every post written in order, each with its job (B3).
  const newBatches = await mapWithConcurrency(decision.newCampaigns, options.concurrency ?? 3, async (campaign) => {
    const batchKey = `event-${campaign.event.id.slice(0, 8)}`;
    const batchNotes: string[] = [];
    let detail: ManagementEventDetail;
    try {
      detail = await deps.getEventDetail({ id: campaign.event.id, slug: campaign.event.slug });
    } catch (error) {
      for (const slot of campaign.slots) dropped(slot.date, `${campaign.event.name} (${slot.label})`, `the events system could not send its details (${error instanceof Error ? error.message : String(error)})`);
      return null;
    }
    const brief = briefForEvent(detail, campaign.window, venueName);
    const parsed = contentBriefSchema.safeParse(brief);
    if (!parsed.success || parsed.data.contentType !== 'event') {
      for (const slot of campaign.slots) dropped(slot.date, `${campaign.event.name} (${slot.label})`, `its brief is not valid (${parsed.success ? 'not an event' : parsed.error.issues[0]?.message})`);
      return null;
    }
    const artwork = await findEventArtwork(db, accountId, campaign.event.id);
    if (!artwork) batchNotes.push('Its artwork is imported from the events system when the plan is applied, square for the feed and the designed upright version for the story.');
    const draft = drafts.find((candidate) => normalise(candidate.title) === normalise(campaign.event.name));
    if (draft) batchNotes.push(`A wizard draft for this event exists (started ${formatDay(londonDate(draft.createdAt))}). Delete it after applying, so the event is not scheduled twice.`);
    const host = parsed.data.facts?.host ?? null;
    const jobs = planSlotJobs(
      campaign.slots.map((slot) => slot.scheduledAt),
      { eventDate: parsed.data.eventDate, host, ...slotJobSignals(`${parsed.data.prompt} ${JSON.stringify(parsed.data.facts ?? {})}`) },
    );
    const mediaIds = artwork ? [artwork.id] : [];
    const slots: PlanSlot[] = [];
    const earlierOpenings: string[] = [];
    const earlierQuestions: string[] = [];
    for (const [index, decided] of campaign.slots.entries()) {
      const label = `${campaign.event.name}, ${formatDay(decided.date)}`;
      const { result, failure } = await writeOne(label, parsed.data, decided.scheduledAt, decided.label, mediaIds, {
        campaign: {
          job: jobs[index],
          host,
          position: index + 1,
          total: campaign.slots.length,
          earlierOpenings: [...earlierOpenings],
          earlierQuestions: [...earlierQuestions],
          allowQuestion: questionAllowed(index + 1),
        },
      });
      if (!result) {
        dropped(decided.date, label, `the AI could not write it (${failure})`);
        continue;
      }
      const written = finish(batchKey, brief, parsed.data, decided, result, mediaIds, jobs[index]);
      if (!written.slot) {
        dropped(decided.date, label, written.reason ?? 'unknown');
        continue;
      }
      slots.push(written.slot);
      for (const platform of FEED_PLATFORMS) {
        const body = written.slot.copy[platform].body;
        const opening = openingOf(body);
        if (opening) earlierOpenings.push(opening);
        earlierQuestions.push(...questionsIn(body));
      }
    }
    if (!slots.length) return null;
    return {
      key: batchKey,
      kind: 'new_campaign',
      title: campaign.event.name,
      contentType: 'event',
      brief,
      artwork: { eventId: campaign.event.id, eventName: campaign.event.name, assetId: artwork?.id ?? null, fileName: artwork?.fileName ?? null },
      photos: artwork ? { [artwork.id]: artwork.fileName } : {},
      slots,
      notes: batchNotes,
    } satisfies PlanBatch;
  });
  batches.push(...newBatches.filter((batch): batch is NonNullable<typeof batch> => batch !== null));

  // Build-up posts for campaigns that already exist: a fresh angle, told how the campaign's other posts open.
  const campaignFeed = (campaignId: string): CalendarPost[] =>
    posts.filter((post) => post.campaignId === campaignId && post.placement === 'feed' && OCCUPYING_STATUSES.has(post.status));
  const buildUpBatches = await mapWithConcurrency(decision.buildUps, options.concurrency ?? 3, async (buildUp) => {
    const label = `${buildUp.campaignName}, ${formatDay(buildUp.slot.date)}`;
    const feed = campaignFeed(buildUp.campaignId);
    const template = [...feed].reverse().find((post) => post.brief && contentBriefSchema.safeParse(post.brief).success);
    if (!template?.brief) {
      dropped(buildUp.slot.date, label, 'no valid brief is stored with the campaign');
      return null;
    }
    const brief: Record<string, unknown> = { ...template.brief };
    if (buildUp.window) brief.promotionWindow = buildUp.window;
    const parsed = contentBriefSchema.safeParse(brief);
    if (!parsed.success || parsed.data.contentType !== 'event') {
      dropped(buildUp.slot.date, label, 'its brief is not valid');
      return null;
    }
    const mediaIds = feed.find((post) => post.mediaIds.length)?.mediaIds.slice(0, 1) ?? [];
    if (!mediaIds.length) {
      dropped(buildUp.slot.date, label, 'the campaign has no image to reuse');
      return null;
    }
    const slotTimes = [...new Set([...feed.map((post) => post.scheduledFor), buildUp.slot.scheduledAt])].sort();
    const position = slotTimes.indexOf(buildUp.slot.scheduledAt) + 1;
    const others = feed.filter((post) => post.body);
    const { result, failure } = await writeOne(label, parsed.data, buildUp.slot.scheduledAt, buildUp.slot.label, mediaIds, {
      campaign: {
        job: 'fresh_angle',
        host: parsed.data.facts?.host ?? null,
        position,
        total: slotTimes.length,
        earlierOpenings: others.map((post) => openingOf(post.body ?? '')).filter(Boolean).slice(0, 22),
        earlierQuestions: others.flatMap((post) => questionsIn(post.body ?? '')).slice(0, 22),
        allowQuestion: questionAllowed(position),
      },
    });
    if (!result) {
      dropped(buildUp.slot.date, label, `the AI could not write it (${failure})`);
      return null;
    }
    const batchKey = `build-up-${buildUp.campaignId.slice(0, 8)}`;
    const written = finish(batchKey, brief, parsed.data, buildUp.slot, result, mediaIds, 'fresh_angle');
    if (!written.slot) {
      dropped(buildUp.slot.date, label, written.reason ?? 'unknown');
      return null;
    }
    return {
      key: `${batchKey}-${buildUp.slot.date}`,
      kind: 'build_up',
      title: buildUp.campaignName,
      contentType: 'event',
      brief,
      existingCampaignId: buildUp.campaignId,
      photos: {},
      slots: [written.slot],
      notes: [],
    } satisfies PlanBatch;
  });
  batches.push(...buildUpBatches.filter((batch): batch is NonNullable<typeof batch> => batch !== null));

  // Venue posts: one batch per subject, written in date order, each told how the earlier ones opened.
  for (const key of VENUE_SUBJECTS) {
    const subject = subjects[key];
    const decided = decision.venue.filter((entry) => entry.subject === key);
    if (!subject || !decided.length) continue;
    const brief = briefForSubject(subject, decided.map((entry) => entry.slot.date));
    const parsed = contentBriefSchema.safeParse(brief);
    if (!parsed.success) throw new Error(`The ${subject.title} brief is not valid: ${parsed.error.issues[0]?.message}`);
    const slots: PlanSlot[] = [];
    const openings: string[] = [];
    for (const entry of decided) {
      const label = `${subject.title}, ${formatDay(entry.slot.date)}`;
      const modifier = openings.length
        ? `Earlier posts in this series opened with these lines, so open differently and take another angle: ${openings.map((opening) => `"${opening}"`).join('; ')}.`
        : undefined;
      const slot = { ...entry.slot, label: subject.title };
      const { result, failure } = await writeOne(label, parsed.data, slot.scheduledAt, subject.title, [entry.photo.id], { modifier });
      if (!result) {
        dropped(slot.date, label, `the AI could not write it (${failure})`);
        continue;
      }
      const written = finish(key, brief, parsed.data, slot, result, [entry.photo.id]);
      if (!written.slot) {
        dropped(slot.date, label, written.reason ?? 'unknown');
        continue;
      }
      slots.push(written.slot);
      for (const platform of FEED_PLATFORMS) {
        const opening = openingOf(written.slot.copy[platform].body);
        if (opening) openings.push(opening);
      }
    }
    if (!slots.length) continue;
    const photoNames = Object.fromEntries(decided.map((entry) => [entry.photo.id, entry.photo.fileName]));
    batches.push({
      key,
      kind: key,
      title: subject.title,
      contentType: subject.contentType,
      brief: briefForSubject(subject, slots.map((slot) => slot.date)),
      photos: photoNames,
      slots,
      notes: [],
    });
  }

  batches.sort((a, b) => a.slots[0].scheduledAt.localeCompare(b.slots[0].scheduledAt));

  // The period day by day, as it will look. An optional move shows at the
  // time the post has now; rugby's separate platform posts show once.
  const moveOf = new Map(decision.moves.flatMap((move) => move.items.map((item) => [item.contentItemId, move] as const)));
  const days = eachDay(from, to).map((date) => {
    const entries: Array<{ time: string; title: string; status: 'existing' | 'moved' | 'optional' | 'new' }> = [];
    const seen = new Set<string>();
    for (const post of posts) {
      if (post.placement !== 'feed' || !OCCUPYING_STATUSES.has(post.status) || londonDate(post.scheduledFor) !== date) continue;
      const move = moveOf.get(post.id);
      const optional = move?.reason === 'early_build_up';
      const time = londonTime(move && !optional ? move.toIso : post.scheduledFor);
      const title = post.campaignName ?? (post.source === 'tournament' ? 'Rugby' : 'Post');
      if (seen.has(`${title}|${time}`)) continue;
      seen.add(`${title}|${time}`);
      entries.push({ time, title, status: optional ? 'optional' : move ? 'moved' : 'existing' });
    }
    for (const batch of batches) {
      for (const slot of batch.slots) {
        if (slot.date === date) entries.push({ time: londonTime(slot.scheduledAt), title: `${batch.title} (${slot.label})`, status: 'new' });
      }
    }
    return { date, entries: entries.sort((a, b) => a.time.localeCompare(b.time)) };
  });

  return {
    version: PLAN_VERSION,
    planId,
    createdAt: now.toISOString(),
    model: deps.model ?? resolveCopyModel(),
    accountId,
    from,
    to,
    moves: decision.moves,
    batches,
    unfilled: unfilled.sort((a, b) => a.date.localeCompare(b.date)),
    ruleBreaks: decision.ruleBreaks,
    notes,
    days,
    sources: VENUE_SUBJECTS.flatMap((key) => {
      const subject = subjects[key];
      return subject ? [{ subject: key, title: subject.title, source: subject.source, links: subject.ctaLinks }] : [];
    }),
    events: decision.events.map((entry) => ({
      name: entry.event.name,
      date: entry.event.date,
      category: entry.event.categoryName,
      campaign: entry.campaignName,
      opensOn: entry.window?.opensOn ?? null,
    })),
  };
}
