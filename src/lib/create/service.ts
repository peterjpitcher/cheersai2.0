import { DateTime } from "luxon";
import pLimit from "p-limit";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthContext } from "@/lib/auth/server";
import type {
  EventCampaignInput,
  InstantPostAdvancedOptions,
  InstantPostInput,
  MediaAssetInput,
  PromotionCampaignInput,
  StorySeriesInput,
  WeeklyCampaignInput,
} from "@/lib/create/schema";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { postProcessGeneratedCopy } from "@/lib/ai/postprocess";
import { applyChannelRules, lintContent } from "@/lib/ai/content-rules";
import { getOpenAIClient } from "@/lib/ai/client";
import { getOwnerSettings } from "@/lib/settings/data";
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { formatFriendlyTime } from "@/lib/utils/date";
import { buildSpreadEvenlySlots, getEngagementOptimisedHour } from "@/lib/scheduling/spread";
import { selectHookStrategy, getHookInstruction } from "@/lib/ai/hooks";
import type { HookStrategy } from "@/lib/ai/hooks";
import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";
import type { ContentPillar } from "@/lib/ai/pillars";


const DEBUG_CONTENT_GENERATION = process.env.DEBUG_CONTENT_GENERATION === "true";

/** In-memory batch state for hook + pillar variety tracking. */
interface CopyEngagement {
  recentHooks: string[];
  recentPillars: string[];
}

/**
 * Fetch the last 5 hook_strategy and content_pillar values for this account.
 * Runs ONCE per campaign creation, not per plan.
 * Returns arrays seeded for in-memory batch tracking.
 */
async function fetchRecentCopyHistory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CopyEngagement> {
  const { data, error } = await supabase
    .from("content_items")
    .select("hook_strategy, content_pillar")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    // Non-fatal — fall back to empty history if columns don't exist yet
    console.warn("[create] fetchRecentCopyHistory failed, using empty history:", error.message);
    return { recentHooks: [], recentPillars: [] };
  }

  const recentHooks: string[] = [];
  const recentPillars: string[] = [];

  for (const row of data ?? []) {
    if (typeof row.hook_strategy === "string" && row.hook_strategy) {
      recentHooks.push(row.hook_strategy);
    }
    if (typeof row.content_pillar === "string" && row.content_pillar) {
      recentPillars.push(row.content_pillar);
    }
  }

  // DB query returns newest-first (DESC). Reverse so newest items are at the
  // end of each array — selectHookStrategy uses slice(-3) and buildPillarNudge
  // uses slice(-2) to read the most recent entries from the tail.
  return { recentHooks: recentHooks.reverse(), recentPillars: recentPillars.reverse() };
}

type Platform = InstantPostInput["platforms"][number];

interface VariantPlan {
  title: string;
  prompt: string;
  scheduledFor: Date | null;
  platforms: Platform[];
  media?: MediaAssetInput[];
  promptContext?: Record<string, unknown>;
  options?: InstantPostAdvancedOptions;
  ctaUrl?: string | null;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
}

interface GeneratedVariantResult {
  platform: Platform;
  body: string;
  validation?: BuiltVariant["validation"];
}

interface BuiltVariant {
  platform: Platform;
  body: string;
  scheduledFor: Date | null;
  promptContext: Record<string, unknown>;
  mediaIds: string[];
  options: InstantPostAdvancedOptions;
  linkInBioUrl?: string | null;
  placement: "feed" | "story";
  hookStrategy?: string;
  contentPillar?: string;
  validation?: {
    lintPass: boolean;
    issues: Array<{ code: string; message: string }>;
    repairsApplied: string[];
    metrics: Record<string, unknown>;
    timestamp: string;
  };
}

const DEFAULT_ADVANCED_OPTIONS: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const MIN_SCHEDULE_OFFSET_MS = 15 * 60 * 1000;
const INSTAGRAM_WORD_LIMIT = 80;
const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

function resolveAdvancedOptions(
  overrides?: Partial<InstantPostAdvancedOptions>,
): InstantPostAdvancedOptions {
  return {
    ...DEFAULT_ADVANCED_OPTIONS,
    ...(overrides ?? {}),
  };
}

function extractAdvancedOptions(
  source: {
    toneAdjust?: InstantPostAdvancedOptions["toneAdjust"];
    lengthPreference?: InstantPostAdvancedOptions["lengthPreference"];
    includeHashtags?: boolean;
    includeEmojis?: boolean;
    ctaStyle?: InstantPostAdvancedOptions["ctaStyle"];
  },
): InstantPostAdvancedOptions {
  return resolveAdvancedOptions({
    toneAdjust: source.toneAdjust,
    lengthPreference: source.lengthPreference,
    includeHashtags: source.includeHashtags,
    includeEmojis: source.includeEmojis,
    ctaStyle: source.ctaStyle,
  });
}

function composePrompt(baseSections: string[], userNotes?: string | null) {
  const sections = baseSections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section?.length));
  const trimmedNotes = userNotes?.trim();
  if (trimmedNotes) {
    sections.push(`Creator notes: ${trimmedNotes}`);
  }
  return sections.join("\n");
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function ensureFutureDate(input: Date | null | undefined): Date | null {
  if (!input) return null;
  const candidate = new Date(input);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  if (candidate.getTime() < minimumTime) {
    return new Date(minimumTime);
  }
  return candidate;
}

interface ScheduledSlotRow {
  scheduled_for: string | null;
  platform: Platform | null;
  placement: "feed" | "story" | null;
}

function toScheduleSlot(date: Date) {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).startOf("minute");
  const dayKey = zoned.toISODate();
  if (!zoned.isValid || !dayKey) {
    return null;
  }
  return {
    dayKey,
    startOfDay: zoned.startOf("day"),
    minuteOfDay: zoned.hour * 60 + zoned.minute,
  };
}

function buildScheduleBucketKey(channel: Platform, dayKey: string) {
  return `${channel}|${dayKey}`;
}

function reserveSlotOnSameDay(
  requested: Date,
  channel: Platform,
  occupiedByDay: Map<string, Set<number>>,
) {
  const slot = toScheduleSlot(requested);
  if (!slot) {
    return requested;
  }

  const bucketKey = buildScheduleBucketKey(channel, slot.dayKey);
  const occupied = occupiedByDay.get(bucketKey) ?? new Set<number>();
  let minuteOfDay = slot.minuteOfDay;

  // Search forward first
  let forward = minuteOfDay;
  while (occupied.has(forward)) {
    forward += SLOT_INCREMENT_MINUTES;
    if (forward >= MINUTES_PER_DAY) {
      forward = -1; // Sentinel: forward search exhausted
      break;
    }
  }

  if (forward === -1) {
    // Search backward from the original requested time
    let backward = slot.minuteOfDay - SLOT_INCREMENT_MINUTES;
    while (backward >= 0 && occupied.has(backward)) {
      backward -= SLOT_INCREMENT_MINUTES;
    }
    if (backward < 0) {
      throw new Error(`No open 30-minute schedule slots remain on ${slot.dayKey}.`);
    }
    minuteOfDay = backward;
  } else {
    minuteOfDay = forward;
  }

  occupied.add(minuteOfDay);
  occupiedByDay.set(bucketKey, occupied);

  return slot.startOfDay.plus({ minutes: minuteOfDay }).toUTC().toJSDate();
}

async function resolveScheduleConflicts({
  supabase,
  accountId,
  variants,
}: {
  supabase: SupabaseClient;
  accountId: string;
  variants: BuiltVariant[];
}) {
  const scheduledVariants = variants
    .map((variant, index) => ({ variant, index, date: variant.scheduledFor }))
    .filter((entry): entry is { variant: BuiltVariant; index: number; date: Date } =>
      entry.variant.placement !== "story" &&
      entry.date instanceof Date && !Number.isNaN(entry.date.getTime()),
    );

  if (!scheduledVariants.length) {
    return;
  }

  const slots = scheduledVariants
    .map((entry) => toScheduleSlot(entry.date))
    .filter((slot): slot is NonNullable<ReturnType<typeof toScheduleSlot>> => Boolean(slot));
  if (!slots.length) {
    return;
  }

  let windowStart = slots[0]!.startOfDay;
  let windowEnd = slots[0]!.startOfDay.endOf("day");
  for (const slot of slots.slice(1)) {
    if (slot.startOfDay.toMillis() < windowStart.toMillis()) {
      windowStart = slot.startOfDay;
    }
    const slotEnd = slot.startOfDay.endOf("day");
    if (slotEnd.toMillis() > windowEnd.toMillis()) {
      windowEnd = slotEnd;
    }
  }

  const windowStartIso = windowStart.toUTC().toISO();
  const windowEndIso = windowEnd.toUTC().toISO();
  if (!windowStartIso || !windowEndIso) {
    return;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("content_items")
    .select("scheduled_for, platform, placement")
    .eq("account_id", accountId)
    .gte("scheduled_for", windowStartIso)
    .lte("scheduled_for", windowEndIso)
    .returns<ScheduledSlotRow[]>();

  if (existingError) {
    throw existingError;
  }

  const occupiedByDay = new Map<string, Set<number>>();
  for (const row of existingRows ?? []) {
    if (!row.scheduled_for) continue;
    if (row.placement === "story") continue;
    if (!row.platform) continue;
    const parsed = DateTime.fromISO(row.scheduled_for, { zone: "utc" });
    if (!parsed.isValid) continue;
    const slot = toScheduleSlot(parsed.toJSDate());
    if (!slot) continue;
    const bucketKey = buildScheduleBucketKey(row.platform, slot.dayKey);
    const occupied = occupiedByDay.get(bucketKey) ?? new Set<number>();
    occupied.add(slot.minuteOfDay);
    occupiedByDay.set(bucketKey, occupied);
  }

  const ordered = [...scheduledVariants].sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    return diff === 0 ? a.index - b.index : diff;
  });

  for (const entry of ordered) {
    entry.variant.scheduledFor = reserveSlotOnSameDay(entry.date, entry.variant.platform, occupiedByDay);
  }
}

function formatWeekday(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc");
}

function formatDayMonth(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("d LLLL");
}

function formatTime(date: Date) {
  return formatFriendlyTime(date);
}

function formatFullDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("d LLLL yyyy");
}

export interface EventTimingCue {
  description: string;
  toneCue: string;
  label: string;
}

function describeEventTimingCue(scheduledFor: Date | null, eventStart: Date): EventTimingCue {
  if (!scheduledFor) {
    return {
      description: "Share live highlights and keep guests engaged in real time.",
      toneCue: "energetic, live, in-the-moment",
      label: "today_imminent",
    };
  }

  const diffMs = eventStart.getTime() - scheduledFor.getTime();
  const diffHours = Math.round(diffMs / HOUR_MS);
  const diffDays = Math.floor(diffMs / DAY_MS);
  const weekday = formatWeekday(eventStart);
  const dayMonth = formatDayMonth(eventStart);
  const timeLabel = formatTime(eventStart);

  if (diffMs <= 0) {
    // scheduledFor is at or after eventStart
    const hoursAfterStart = Math.abs(diffMs) / HOUR_MS;
    if (hoursAfterStart > 3) {
      return {
        description: `Share a recap of how the event went — highlights, photos, and a look back at ${weekday}’s ${dayMonth} gathering.`,
        toneCue: "reflective, warm, community pride",
        label: "recap",
      };
    }
    return {
      description: "Make it clear the event is underway right now and draw in any last-minute arrivals.",
      toneCue: "energetic, live, in-the-moment",
      label: "today_imminent",
    };
  }

  if (diffHours <= 3) {
    return {
      description: `Say it’s happening in just a few hours (tonight at ${timeLabel}) and drive final RSVPs.`,
      toneCue: "urgent, exciting, last-chance energy",
      label: "today_imminent",
    };
  }

  if (diffDays === 0) {
    // Same day, before 2pm logic: if scheduledFor hour < 14, morning; else imminent
    const scheduledHour = DateTime.fromJSDate(scheduledFor, { zone: DEFAULT_TIMEZONE }).hour;
    if (scheduledHour < 14) {
      return {
        description: `Call out that it’s happening today at ${timeLabel}—push final sign-ups and arrivals.`,
        toneCue: "bright, reminder, plan-your-day",
        label: "today_morning",
      };
    }
    return {
      description: `Call out that it’s happening today at ${timeLabel}—push final sign-ups and arrivals.`,
      toneCue: "urgent, exciting, last-chance energy",
      label: "today_imminent",
    };
  }

  if (diffDays <= 2) {
    return {
      description: `Say it’s tomorrow (${weekday} ${dayMonth}) and stress limited spots before ${timeLabel}.`,
      toneCue: "anticipation, countdown, don’t miss out",
      label: "tomorrow",
    };
  }

  if (diffDays <= 6) {
    return {
      description: `Refer to it as this ${weekday} (${dayMonth}) and keep the countdown energy high.`,
      toneCue: "building excitement, save the date",
      label: "building",
    };
  }

  return {
    description: `Highlight the date ${weekday} ${dayMonth} at ${timeLabel} and build anticipation while pushing sign-ups.`,
    toneCue: "awareness, curiosity, early-bird appeal",
    label: "early_awareness",
  };
}

function formatFocusLabel(label: string) {
  const trimmed = label.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildEventFocusLine(label: string, scheduledFor: Date | null, eventStart: Date) {
  const cue = describeEventTimingCue(scheduledFor, eventStart);
  return `Focus: ${formatFocusLabel(label)} ${cue.description}`;
}

function describePromotionTimingCue(scheduledFor: Date | null, start: Date, end: Date) {
  if (!scheduledFor) {
    return "Drive immediate interest—invite guests to take advantage right now.";
  }

  const startDiffMs = start.getTime() - scheduledFor.getTime();
  const endDiffMs = end.getTime() - scheduledFor.getTime();
  const startWeekday = formatWeekday(start);
  const startDayMonth = formatDayMonth(start);
  const endWeekday = formatWeekday(end);
  const endDayMonth = formatDayMonth(end);
  const endTime = formatTime(end);

  if (scheduledFor < start) {
    const daysUntilStart = Math.max(0, Math.ceil(startDiffMs / DAY_MS));
    if (daysUntilStart <= 1) {
      return `Tease that it kicks off tomorrow (${startWeekday} ${startDayMonth})—urge followers to be first in.`;
    }
    return `Build anticipation for ${startWeekday} ${startDayMonth}; invite early interest before doors open.`;
  }

  if (scheduledFor >= start && scheduledFor <= new Date(start.getTime() + DAY_MS)) {
    return `Say it starts today (${startWeekday} ${startDayMonth}) and invite guests to claim the offer now.`;
  }

  if (endDiffMs <= 0) {
    return "Wrap up the promotion—thank guests and hint that a new offer is on the way.";
  }

  const hoursUntilEnd = endDiffMs / HOUR_MS;
  if (hoursUntilEnd <= 6) {
    return `Make it crystal clear it ends in just hours (tonight by ${endTime})—push a final rush.`;
  }

  if (hoursUntilEnd <= 24) {
    return `Say it ends today (${endWeekday} ${endDayMonth}) and drive last-chance urgency.`;
  }

  const daysUntilEnd = Math.ceil(hoursUntilEnd / 24);
  if (daysUntilEnd <= 2) {
    return `Stress that it wraps in ${daysUntilEnd === 1 ? "one day" : "two days"} (by ${endWeekday} ${endDayMonth}).`;
  }

  const daysSinceStart = Math.floor((scheduledFor.getTime() - start.getTime()) / DAY_MS);
  if (daysSinceStart <= 6) {
    return `Keep momentum going mid-run and remind guests it ends on ${endWeekday} ${endDayMonth}.`;
  }

  return `Reinforce the value while reminding followers it finishes on ${endWeekday} ${endDayMonth}.`;
}

function buildPromotionFocusLine(label: string, scheduledFor: Date | null, start: Date, end: Date) {
  const cue = describePromotionTimingCue(scheduledFor, start, end);
  return `Focus: ${formatFocusLabel(label)} ${cue}`;
}

export async function createInstantPost(input: InstantPostInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation } = await getOwnerSettings();

  const isScheduled = input.publishMode === "schedule" && Boolean(input.scheduledFor);
  const scheduledForDate = isScheduled ? ensureFutureDate(input.scheduledFor ?? new Date()) : null;
  if (isScheduled && (!input.media || input.media.length === 0)) {
    throw new Error("Scheduled posts require at least one media asset.");
  }
  const advancedOptions = extractAdvancedOptions(input);
  const resolvedCtaLabel = resolveDefaultCtaLabel("instant", input.ctaUrl, input.ctaLabel);

  const plans: VariantPlan[] = [
    {
      title: input.title,
      prompt: input.prompt,
      scheduledFor: scheduledForDate,
      platforms: input.platforms,
      media: input.media,
      promptContext: {
        title: input.title,
        publishMode: input.publishMode,
        useCase: "instant",
        proofPointMode: input.proofPointMode,
        proofPointsSelected: input.proofPointsSelected ?? [],
        proofPointIntentTags: input.proofPointIntentTags ?? [],
        ctaUrl: input.ctaUrl ?? null,
        ctaLabel: resolvedCtaLabel,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: input.placement,
      },
      options: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
      placement: input.placement ?? "feed",
    },
  ];

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.title,
    type: "instant",
    metadata: {
      prompt: input.prompt,
      createdWith: "instant-post",
      publishMode: input.publishMode,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: resolvedCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
      placement: input.placement ?? "feed",
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

export async function createStorySeries(input: StorySeriesInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation } = await getOwnerSettings();

  const trimmedNotes = input.notes?.trim();
  const fallbackDate = new Date(Date.now() + MIN_SCHEDULE_OFFSET_MS);
  const sortedSlots = [...input.slots].sort(
    (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
  );

  const plans: VariantPlan[] = sortedSlots.map((slot, index) => {
    const ensuredDate = ensureFutureDate(slot.scheduledFor) ?? new Date(fallbackDate);
    const planOptions = resolveAdvancedOptions();
    return {
      title: `${input.title} — Story ${index + 1}`,
      prompt: "",
      scheduledFor: ensuredDate,
      platforms: input.platforms,
      media: slot.media,
      promptContext: {
        title: input.title,
        slotIndex: index + 1,
        seriesNotes: trimmedNotes ?? null,
        scheduledFor: ensuredDate.toISOString(),
        placement: "story",
      },
      options: planOptions,
      linkInBioUrl: null,
      placement: "story",
    };
  });

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.title,
    type: "story_series",
    metadata: {
      createdWith: "story-series",
      notes: trimmedNotes ?? null,
      placement: "story",
    },
    plans,
    linkInBioUrl: null,
  });
}

export async function createEventCampaign(input: EventCampaignInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation } = await getOwnerSettings();

  const eventStart = combineDateAndTime(input.startDate, input.startTime);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const advancedOptions = extractAdvancedOptions(input);
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;
  const eventCtaLabel = resolveDefaultCtaLabel("event", input.ctaUrl, input.ctaLabel);

  const basePrompt = composePrompt(
    [
      `Event name: ${input.name}`,
      input.description ? `Event details: ${input.description}` : "",
      `Event starts ${formatFullDate(eventStart)} at ${formatFriendlyTime(eventStart)}.`,
    ],
    input.prompt,
  );

  const plans: VariantPlan[] = usingManualSchedule
    ? manualSchedule.map((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      const timingCue = describeEventTimingCue(futureSlot, eventStart);
      return {
        title: `${input.name} — Slot ${index + 1}`,
        prompt: [
          basePrompt,
          buildEventFocusLine(`Custom slot ${index + 1}`, futureSlot, eventStart),
        ]
          .filter(Boolean)
          .join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          title: input.name,
          description: input.description,
          slot: `manual-${index + 1}`,
          eventStart: eventStart.toISOString(),
          useCase: "event",
          temporalProximity: timingCue.toneCue,
          timingLabel: timingCue.label,
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
          ctaLabel: eventCtaLabel,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      };
    })
    : input.scheduleOffsets.reduce<VariantPlan[]>((acc, slot) => {
      const scheduledFor = new Date(eventStart.getTime() + slot.offsetHours * 60 * 60 * 1000);
      if (scheduledFor.getTime() < minimumTime) {
        return acc;
      }
      const futureSlot = ensureFutureDate(scheduledFor) ?? new Date(minimumTime);
      const timingCue = describeEventTimingCue(futureSlot, eventStart);
      acc.push({
        title: `${input.name} — ${slot.label}`,
        prompt: [basePrompt, buildEventFocusLine(slot.label, futureSlot, eventStart)]
          .filter(Boolean)
          .join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          title: input.name,
          description: input.description,
          slot: slot.label,
          eventStart: eventStart.toISOString(),
          useCase: "event",
          temporalProximity: timingCue.toneCue,
          timingLabel: timingCue.label,
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
          ctaLabel: eventCtaLabel,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      });
      return acc;
    }, []);

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.name,
    type: "event",
    metadata: {
      description: input.description,
      eventStart: eventStart.toISOString(),
      offsets: input.scheduleOffsets,
      manualSchedule: usingManualSchedule
        ? manualSchedule.map((date) => date.toISOString())
        : undefined,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: eventCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

export async function createPromotionCampaign(input: PromotionCampaignInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation } = await getOwnerSettings();

  const start = input.startDate;
  const end = input.endDate;
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const mid = new Date(start.getTime() + durationMs / 2);
  let lastChance = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  if (lastChance <= start) {
    lastChance = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  }

  const resolvedCtaLabel = resolveDefaultCtaLabel("promotion", input.ctaUrl, input.ctaLabel);
  const basePrompt = composePrompt(
    [
      `Promotion: ${input.name}`,
      input.offerSummary ? `Offer details: ${input.offerSummary}` : "",
      `Runs ${formatFullDate(start)} to ${formatFullDate(end)}.`,
    ],
    input.prompt,
  );

  const advancedOptions = extractAdvancedOptions(input);
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;

  const plans: VariantPlan[] = usingManualSchedule
    ? manualSchedule.map((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      return {
        title: `${input.name} — Slot ${index + 1}`,
        prompt: [
          basePrompt,
          buildPromotionFocusLine(`Custom slot ${index + 1}`, futureSlot, start, end),
        ]
          .filter(Boolean)
          .join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          phase: "custom",
          index: index + 1,
          useCase: "promotion",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaUrl: input.ctaUrl ?? null,
          ctaLabel: resolvedCtaLabel,
          linkInBioUrl: input.linkInBioUrl ?? null,
          promotionStart: start.toISOString(),
          promotionEnd: end.toISOString(),
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      };
    })
    : [
      { label: "Launch", slot: start, phase: "launch", context: { start: start.toISOString() } },
      { label: "Mid-run reminder", slot: mid, phase: "mid", context: { mid: mid.toISOString() } },
      { label: "Last chance", slot: lastChance, phase: "last-chance", context: { end: end.toISOString() } },
    ].reduce<VariantPlan[]>((acc, entry) => {
      if (entry.slot.getTime() < minimumTime) {
        return acc;
      }
      const futureSlot = ensureFutureDate(entry.slot) ?? new Date(minimumTime);
      acc.push({
        title: `${input.name} — ${entry.label}`,
        prompt: [
          basePrompt,
          buildPromotionFocusLine(entry.label, futureSlot, start, end),
        ]
          .filter(Boolean)
          .join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          phase: entry.phase,
          ...entry.context,
          useCase: "promotion",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaUrl: input.ctaUrl ?? null,
          ctaLabel: resolvedCtaLabel,
          linkInBioUrl: input.linkInBioUrl ?? null,
          promotionStart: start.toISOString(),
          promotionEnd: end.toISOString(),
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      });
      return acc;
    }, []);

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.name,
    type: "promotion",
    metadata: {
      offerSummary: input.offerSummary,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      manualSchedule: usingManualSchedule
        ? manualSchedule.map((date) => date.toISOString())
        : undefined,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: resolvedCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

export async function createWeeklyCampaign(input: WeeklyCampaignInput) {
  const { accountId, supabase } = await requireAuthContext();
  const { brand, venueName, venueLocation, posting } = await getOwnerSettings();

  // Read spread-evenly fields (added by schema agent; use optional access for safety)
  const inputAny = input as Record<string, unknown>;
  const scheduleMode = (inputAny.scheduleMode as string) ?? "fixed_days";
  const postsPerWeek = (inputAny.postsPerWeek as number) ?? 3;
  const staggerPlatforms = (inputAny.staggerPlatforms as boolean) ?? true;

  const firstOccurrence = getFirstOccurrence(input.startDate, input.dayOfWeek, input.time);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const weeksAhead = input.weeksAhead ?? 4;
  const advancedOptions = extractAdvancedOptions(input);
  const [hourStr = "07", minuteStr = "0"] = input.time.split(":");
  const parsedHour = Number(hourStr);
  const parsedMinute = Number(minuteStr);
  const cadenceHour = Number.isFinite(parsedHour) ? parsedHour : 7;
  const cadenceMinute = Number.isFinite(parsedMinute) ? parsedMinute : 0;
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;
  const cadence = usingManualSchedule
    ? undefined
    : input.platforms.map((platform) => ({
      platform,
      weekday: input.dayOfWeek,
      hour: cadenceHour,
      minute: cadenceMinute,
    }));

  const resolvedCtaLabel = resolveDefaultCtaLabel("weekly", input.ctaUrl, input.ctaLabel);
  const promptBase = composePrompt(
    [
      `Weekly feature: ${input.name}`,
      input.description ? `Campaign details: ${input.description}` : "",
      `Occurs every ${weekdayLabel(input.dayOfWeek)} at ${input.time}.`,
    ],
    input.prompt,
  );

  const focusLineForOccurrence = (occurrenceIndex: number) => {
    const cues = [
      "Lead with a warm invite and the key details.",
      "Lean into the atmosphere and who it’s perfect for (mates, dates, families).",
      "Highlight one specific detail from the description (what guests can expect).",
      "Add a clear, friendly call to action without sounding salesy.",
      "Keep it short, punchy, and upbeat — a quick weekly reminder.",
      "Vary the wording and opening hook so it doesn’t feel copy-pasted from one post to the next.",
    ];
    const cue = cues[(Math.max(1, occurrenceIndex) - 1) % cues.length] ?? cues[0];
    return `Focus: Regular reminder for the upcoming occurrence. Keep it evergreen — do not label it as a numbered instalment or part of a numbered series. ${cue}`;
  };

  const sortedManualSchedule = usingManualSchedule
    ? manualSchedule
      .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())
    : [];

  // --- Spread-evenly mode: build plans from the spread algorithm ---
  let plans: VariantPlan[];

  if (scheduleMode === "spread_evenly" && !usingManualSchedule) {
    plans = await buildSpreadEvenlyPlans({
      supabase,
      accountId,
      input,
      postsPerWeek,
      staggerPlatforms,
      weeksAhead,
      advancedOptions,
      resolvedCtaLabel,
      promptBase,
      focusLineForOccurrence,
      defaultPostingTime: posting.defaultPostingTime ?? null,
    });
  } else if (usingManualSchedule) {
    plans = sortedManualSchedule.map((scheduledFor, index) => {
      const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
      const occurrenceNumber = index + 1;
      return {
        title: input.name,
        prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          occurrenceIndex: occurrenceNumber,
          custom: true,
          useCase: "weekly",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaLabel: resolvedCtaLabel,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      };
    });
  } else {
    // fixed_days mode (existing behaviour)
    const list: VariantPlan[] = [];
    let weekOffset = 0;
    while (list.length < weeksAhead) {
      const candidate = new Date(firstOccurrence.getTime() + weekOffset * 7 * DAY_MS);
      weekOffset += 1;
      const futureSlot = ensureFutureDate(candidate) ?? new Date(minimumTime);
      const occurrenceNumber = list.length + 1;
      list.push({
        title: input.name,
        prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
        scheduledFor: futureSlot,
        platforms: input.platforms,
        media: input.heroMedia,
        promptContext: {
          occurrenceIndex: occurrenceNumber,
          dayOfWeek: input.dayOfWeek,
          time: input.time,
          useCase: "weekly",
          proofPointMode: input.proofPointMode,
          proofPointsSelected: input.proofPointsSelected ?? [],
          proofPointIntentTags: input.proofPointIntentTags ?? [],
          ctaLabel: resolvedCtaLabel,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        },
        options: advancedOptions,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
        placement: "feed",
      });
    }
    plans = list;
  }

  const displayEndDateIso = plans.length
    ? plans[plans.length - 1]?.scheduledFor?.toISOString() ?? null
    : null;

  const effectiveWeeksAhead = usingManualSchedule ? sortedManualSchedule.length || weeksAhead : weeksAhead;

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
    venueLocation,
    name: input.name,
    type: "weekly",
    metadata: {
      description: input.description,
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      weeksAhead: effectiveWeeksAhead,
      cadence,
      manualSchedule: usingManualSchedule
        ? sortedManualSchedule.map((date) => date.toISOString())
        : undefined,
      advanced: advancedOptions,
      proofPointMode: input.proofPointMode,
      proofPointsSelected: input.proofPointsSelected ?? [],
      proofPointIntentTags: input.proofPointIntentTags ?? [],
      ctaUrl: input.ctaUrl ?? null,
      ctaLabel: resolvedCtaLabel,
      linkInBioUrl: input.linkInBioUrl ?? null,
      startDate: input.startDate.toISOString(),
      displayEndDate: displayEndDateIso,
      // Spread-evenly metadata (persisted for read-back)
      ...(scheduleMode === "spread_evenly" ? {
        scheduleMode,
        postsPerWeek,
        staggerPlatforms,
      } : {}),
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

/**
 * Build variant plans using the spread-evenly algorithm.
 *
 * 1. Query existing content_items for the account in the scheduling window.
 * 2. Call buildSpreadEvenlySlots() with the config.
 * 3. Apply engagement-optimised time selection to each slot.
 * 4. Build VariantPlan[] from the resulting slots.
 */
async function buildSpreadEvenlyPlans({
  supabase,
  accountId,
  input,
  postsPerWeek,
  staggerPlatforms,
  weeksAhead,
  advancedOptions,
  resolvedCtaLabel,
  promptBase,
  focusLineForOccurrence,
  defaultPostingTime,
}: {
  supabase: SupabaseClient;
  accountId: string;
  input: WeeklyCampaignInput;
  postsPerWeek: number;
  staggerPlatforms: boolean;
  weeksAhead: number;
  advancedOptions: InstantPostAdvancedOptions;
  resolvedCtaLabel: string | null;
  promptBase: string;
  focusLineForOccurrence: (index: number) => string;
  defaultPostingTime: string | null;
}): Promise<VariantPlan[]> {
  const windowStart = DateTime.fromJSDate(input.startDate, { zone: DEFAULT_TIMEZONE })
    .startOf("day");
  const windowEnd = windowStart.plus({ weeks: weeksAhead });

  const windowStartIso = windowStart.toUTC().toISO();
  const windowEndIso = windowEnd.toUTC().toISO();

  // Query existing scheduled feed posts for the account in the window
  let existingPosts: Array<{ scheduledFor: Date; platform: string; placement: string }> = [];
  if (windowStartIso && windowEndIso) {
    const { data: existingRows } = await supabase
      .from("content_items")
      .select("scheduled_for, platform, placement")
      .eq("account_id", accountId)
      .gte("scheduled_for", windowStartIso)
      .lte("scheduled_for", windowEndIso)
      .returns<ScheduledSlotRow[]>();

    existingPosts = (existingRows ?? [])
      .filter((row): row is { scheduled_for: string; platform: Platform; placement: "feed" | "story" } =>
        !!row.scheduled_for && !!row.platform && !!row.placement)
      .map((row) => ({
        scheduledFor: new Date(row.scheduled_for),
        platform: row.platform,
        placement: row.placement,
      }));
  }

  // Build spread-evenly slots
  const slots = buildSpreadEvenlySlots(
    {
      postsPerWeek,
      platforms: input.platforms,
      staggerPlatforms,
      windowStart: windowStart.toJSDate(),
      windowEnd: windowEnd.toJSDate(),
      timezone: DEFAULT_TIMEZONE,
    },
    existingPosts,
  );

  // Convert slots to VariantPlans with engagement-optimised times
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  return slots.map((slot, index) => {
    const { hour, minute } = getEngagementOptimisedHour(slot.date, null, defaultPostingTime, DEFAULT_TIMEZONE);
    const scheduledDateTime = DateTime.fromJSDate(slot.date, { zone: DEFAULT_TIMEZONE })
      .set({ hour, minute, second: 0, millisecond: 0 });
    const futureSlot = ensureFutureDate(scheduledDateTime.toJSDate()) ?? new Date(minimumTime);
    const occurrenceNumber = index + 1;

    return {
      title: input.name,
      prompt: [promptBase, focusLineForOccurrence(occurrenceNumber)].filter(Boolean).join("\n\n"),
      scheduledFor: futureSlot,
      platforms: [slot.platform], // Each slot targets one platform
      media: input.heroMedia,
      promptContext: {
        occurrenceIndex: occurrenceNumber,
        useCase: "weekly",
        scheduleMode: "spread_evenly" as const,
        proofPointMode: input.proofPointMode,
        proofPointsSelected: input.proofPointsSelected ?? [],
        proofPointIntentTags: input.proofPointIntentTags ?? [],
        ctaLabel: resolvedCtaLabel,
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
      },
      options: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
      placement: "feed" as const,
    };
  });
}

async function createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
  venueLocation,
  name,
  type,
  metadata,
  plans,
  options,
  linkInBioUrl,
}: {
  supabase: SupabaseClient;
  accountId: string;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  plans: VariantPlan[];
  options?: {
    autoSchedule?: boolean;
  };
  linkInBioUrl?: string | null;
}) {
  if (!plans.length) {
    throw new Error("Cannot create campaign without plans");
  }

  // Hoisted copy history — runs ONCE per campaign, not per plan
  const engagement = await fetchRecentCopyHistory(supabase, accountId);

  const variants = await buildVariants({ brand, venueName, venueLocation, plans, engagement });
  const shouldAutoSchedule = options?.autoSchedule ?? true;
  await resolveScheduleConflicts({ supabase, accountId, variants });

  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      account_id: accountId,
      name,
      campaign_type: type,
      status: "scheduled",
      metadata,
      link_in_bio_url: linkInBioUrl ?? null,
    })
    .select("id")
    .single();

  if (campaignError) throw campaignError;

  const nowIso = new Date().toISOString();

  const contentRows = variants.map((variant) => ({
    campaign_id: campaignRow.id,
    account_id: accountId,
    platform: variant.platform,
    placement: variant.placement,
    scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
    status: shouldAutoSchedule
      ? variant.scheduledFor
        ? "scheduled"
        : "queued"
      : "draft",
    prompt_context: variant.promptContext,
    auto_generated: true,
    hook_strategy: variant.hookStrategy ?? null,
    content_pillar: variant.contentPillar ?? null,
  }));

  const { data: insertedContent, error: contentError } = await supabase
    .from("content_items")
    .insert(contentRows)
    .select("id, platform");

  if (contentError) throw contentError;

  const variantPayloads = (insertedContent ?? []).map((content, index) => ({
    content_item_id: content.id,
    body: variants[index]?.body ?? "",
    media_ids: variants[index]?.mediaIds.length ? variants[index]?.mediaIds : null,
    validation: variants[index]?.validation ?? null,
  }));

  const { data: upsertedVariants, error: variantError } = await supabase
    .from("content_variants")
    .upsert(variantPayloads, { onConflict: "content_item_id" })
    .select("id, content_item_id");

  if (variantError) throw variantError;

  const variantIdByContent = new Map<string, string>();
  for (const row of upsertedVariants ?? []) {
    variantIdByContent.set(row.content_item_id, row.id);
  }

  await Promise.all(
    (insertedContent ?? []).map((content, index) => {
      if (!shouldAutoSchedule) return Promise.resolve();
      const variantId = variantIdByContent.get(content.id);
      if (!variantId) {
        return Promise.reject(new Error(`Variant id missing for content ${content.id}`));
      }
      return enqueuePublishJob({
        contentItemId: content.id,
        variantId,
        placement: variants[index]?.placement ?? "feed",
        scheduledFor: variants[index]?.scheduledFor ?? null,
      });
    }),
  );

  const hasImmediate = variants.some((variant) => !variant.scheduledFor);
  const status = shouldAutoSchedule ? (hasImmediate ? "queued" : "scheduled") : "draft";
  const scheduledDates = variants
    .map((variant) => variant.scheduledFor?.getTime())
    .filter((timestamp): timestamp is number => Boolean(timestamp));
  const earliest = scheduledDates.length ? new Date(Math.min(...scheduledDates)).toISOString() : null;

  return {
    campaignId: campaignRow.id,
    contentItemIds: insertedContent?.map((row) => row.id) ?? [],
    status,
    scheduledFor: earliest,
  } as const;
}

async function buildVariants({
  brand,
  venueName,
  venueLocation,
  plans,
  engagement,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  venueLocation?: string;
  plans: VariantPlan[];
  engagement?: CopyEngagement;
}): Promise<BuiltVariant[]> {
  const variants: BuiltVariant[] = [];

  if (DEBUG_CONTENT_GENERATION) {
    console.debug("[create] buildVariants", plans.map((plan, index) => ({
      index,
      title: plan.title,
      scheduledFor: plan.scheduledFor ? plan.scheduledFor.toISOString() : null,
      platforms: plan.platforms,
      mediaIds: (plan.media ?? []).map((asset) => asset.assetId),
      promptContextKeys: plan.promptContext ? Object.keys(plan.promptContext) : [],
    })));
  }

  const limit = pLimit(4);

  const planResults = await Promise.all(
    plans.map((plan) => limit(async (): Promise<BuiltVariant[]> => {
      const planVariants: BuiltVariant[] = [];
      const options = resolveAdvancedOptions(plan.options);
      const planCta = plan.ctaUrl ?? (typeof plan.promptContext?.ctaUrl === "string"
        ? (plan.promptContext.ctaUrl as string)
        : undefined);
      const placement = plan.placement ?? "feed";

      // --- Hook + pillar selection (feed posts only) ---
      let hookStrategy: HookStrategy | undefined;
      let hookInstruction: string | undefined;
      let contentPillar: ContentPillar | undefined;
      let pillarNudge: string | null = null;

      if (placement === "feed" && engagement) {
        hookStrategy = selectHookStrategy(engagement.recentHooks);
        hookInstruction = getHookInstruction(hookStrategy);
        engagement.recentHooks.push(hookStrategy);

        contentPillar = inferContentPillar(plan.title, plan.prompt);
        pillarNudge = buildPillarNudge(contentPillar, engagement.recentPillars);
        engagement.recentPillars.push(contentPillar);
      }

      if (placement === "story") {
        const mediaIds = plan.media?.map((asset) => asset.assetId) ?? [];
        for (const platform of plan.platforms) {
          const lint = lintContent({
            body: "",
            platform,
            placement,
            context: {
              ...(plan.promptContext ?? {}),
              advanced: options,
              ctaUrl: planCta ?? null,
              linkInBioUrl: plan.linkInBioUrl ?? null,
            },
            advanced: options,
            scheduledFor: plan.scheduledFor ?? null,
          });
          if (!lint.pass) {
            throw new Error(`Generated content failed lint for ${platform}.`);
          }
          planVariants.push({
            platform,
            body: "",
            scheduledFor: plan.scheduledFor,
            promptContext: {
              ...(plan.promptContext ?? {}),
              advanced: options,
              ctaUrl: planCta ?? null,
              linkInBioUrl: plan.linkInBioUrl ?? null,
            },
            options,
            mediaIds,
            linkInBioUrl: plan.linkInBioUrl ?? null,
            placement,
            validation: {
              lintPass: lint.pass,
              issues: lint.issues,
              repairsApplied: ["story_no_caption"],
              metrics: {
                ...lint.metrics,
                proofPointUsed: false,
                proofPointId: null,
                proofPointSource: null,
              },
              timestamp: new Date().toISOString(),
            },
          });
        }
        return planVariants;
      }

      const instantInput: InstantPostInput = {
        title: plan.title,
        prompt: plan.prompt,
        publishMode: plan.scheduledFor ? "schedule" : "now",
        scheduledFor: plan.scheduledFor ?? undefined,
        platforms: plan.platforms,
        media: plan.media,
        toneAdjust: options.toneAdjust,
        lengthPreference: options.lengthPreference,
        includeHashtags: options.includeHashtags,
        includeEmojis: options.includeEmojis,
        ctaStyle: options.ctaStyle,
        ctaUrl: planCta,
        linkInBioUrl: plan.linkInBioUrl ?? undefined,
        placement,
        proofPointMode: typeof plan.promptContext?.proofPointMode === "string"
          ? (plan.promptContext.proofPointMode as InstantPostInput["proofPointMode"])
          : "off",
        proofPointsSelected: Array.isArray(plan.promptContext?.proofPointsSelected)
          ? (plan.promptContext.proofPointsSelected as string[])
          : [],
        proofPointIntentTags: Array.isArray(plan.promptContext?.proofPointIntentTags)
          ? (plan.promptContext.proofPointIntentTags as string[])
          : [],
      };

      // Merge hook/pillar engagement into prompt context for prompts.ts to read
      const enrichedContext: Record<string, unknown> = {
        ...(plan.promptContext ?? {}),
        ...(hookStrategy ? { hookStrategy, hookInstruction } : {}),
        ...(pillarNudge ? { pillarNudge } : {}),
        ...(venueLocation ? { venueLocation } : {}),
      };

      const generated = await generateVariants({
        brand,
        venueName,
        input: instantInput,
        scheduledFor: plan.scheduledFor ?? null,
        context: enrichedContext,
      });
      for (const variant of generated) {
        planVariants.push({
          platform: variant.platform,
          body: variant.body,
          scheduledFor: plan.scheduledFor,
          promptContext: {
            ...(plan.promptContext ?? {}),
            advanced: options,
            ctaUrl: planCta ?? null,
            linkInBioUrl: plan.linkInBioUrl ?? null,
          },
          options,
          mediaIds: plan.media?.map((asset) => asset.assetId) ?? [],
          linkInBioUrl: plan.linkInBioUrl ?? null,
          hookStrategy,
          contentPillar,
          placement,
          validation: variant.validation,
        });
      }
      return planVariants;
    })),
  );

  for (const planVariants of planResults) {
    variants.push(...planVariants);
  }

  return variants;
}

async function generateVariants({
  brand,
  venueName,
  input,
  scheduledFor,
  context,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  input: InstantPostInput;
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
}): Promise<GeneratedVariantResult[]> {
  let client: ReturnType<typeof getOpenAIClient> | null = null;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof Error && error.message.includes("OPENAI")) {
      throw new Error("Content generation is unavailable (missing OpenAI credentials).");
    }
    throw error;
  }

  const platformResults = await Promise.allSettled(
    input.platforms.map(async (platform): Promise<GeneratedVariantResult> => {
      try {
        const prompt = buildInstantPostPrompt({ brand, venueName, input, platform, scheduledFor, context });
        if (DEBUG_CONTENT_GENERATION) {
          console.debug("[create] openai prompt", {
            platform,
            title: input.title,
            prompt,
          });
        }
        const response = await client.responses.create({
          model: "gpt-4.1-mini",
          input: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          temperature: 0.7,
        });
        const text = response.output_text?.trim();
        if (DEBUG_CONTENT_GENERATION) {
          console.debug("[create] openai output", { platform, hasText: Boolean(text), preview: text?.slice(0, 120) });
        }
        if (text && text.length > 0) {
          const processed = postProcessGeneratedCopy({
            body: text,
            platform,
            input,
            scheduledFor,
            context,
            bannedTopics: brand.bannedTopics,
            bannedPhrases: brand.bannedPhrases,
          });
          if (containsBannedTopic(processed, brand.bannedTopics)) {
            if (DEBUG_CONTENT_GENERATION) {
              console.warn("[create] openai output still contains banned topic after scrub", {
                platform,
                preview: processed.slice(0, 140),
              });
            }
            throw new Error(`Generated content contains banned topics for ${platform}.`);
          }
          const { body: finalBody, repairs, proofPoint } = finaliseCopy(
            platform,
            processed,
            input,
            context,
            scheduledFor ?? null,
          );
          if ((input.placement ?? "feed") === "feed" && !finalBody.trim().length) {
            throw new Error(`Generated content is empty for ${platform}.`);
          }
          const lint = lintContent({
            body: finalBody,
            platform,
            placement: input.placement ?? "feed",
            context,
            advanced: input,
            scheduledFor: scheduledFor ?? null,
          });
          if (!lint.pass) {
            const { body: repairedBody, repairs: extraRepairs, proofPoint: repairedProofPoint } = finaliseCopy(
              platform,
              finalBody,
              input,
              context,
              scheduledFor ?? null,
            );
            const retry = lintContent({
              body: repairedBody,
              platform,
              placement: input.placement ?? "feed",
              context,
              advanced: input,
              scheduledFor: scheduledFor ?? null,
            });
            if (!retry.pass) {
              throw new Error(`Generated content failed lint for ${platform}.`);
            }
            return {
              platform,
              body: repairedBody,
              validation: {
                lintPass: true,
                issues: retry.issues,
                repairsApplied: [...repairs, ...extraRepairs],
                metrics: {
                  ...retry.metrics,
                  proofPointUsed: Boolean(repairedProofPoint),
                  proofPointId: repairedProofPoint?.id ?? null,
                  proofPointSource: repairedProofPoint?.source ?? null,
                },
                timestamp: new Date().toISOString(),
              },
            };
          } else {
            return {
              platform,
              body: finalBody,
              validation: {
                lintPass: true,
                issues: lint.issues,
                repairsApplied: repairs,
                metrics: {
                  ...lint.metrics,
                  proofPointUsed: Boolean(proofPoint),
                  proofPointId: proofPoint?.id ?? null,
                  proofPointSource: proofPoint?.source ?? null,
                },
                timestamp: new Date().toISOString(),
              },
            };
          }
        } else {
          throw new Error(`No content generated for ${platform}.`);
        }
      } catch (error) {
        if (isSchemaMissingError(error)) {
          throw new Error(`Content generation failed for ${platform} (schema unavailable).`);
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error("[create] openai generation failed", error);
        throw new Error(`Content generation failed for ${platform}: ${message}`);
      }
    }),
  );

  // Collect successful results, log failures individually
  const results: GeneratedVariantResult[] = [];
  for (const result of platformResults) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      console.warn(`[create] Platform generation failed: ${result.reason}`);
    }
  }

  // Only throw if ALL platforms failed
  if (results.length === 0) {
    throw new Error("Content generation failed for all platforms.");
  }

  return results;
}

function containsBannedTopic(value: string, topics: string[]) {
  const normalizedTopics = topics.map((topic) => topic.trim()).filter(Boolean);
  if (!normalizedTopics.length) return false;
  return normalizedTopics.some((topic) => {
    const pattern = buildBannedTopicPattern(topic);
    return pattern ? pattern.test(value) : false;
  });
}

function buildBannedTopicPattern(topic: string) {
  const escaped = escapeRegExp(topic);
  if (!escaped.length) return null;
  if (/\s/.test(topic)) {
    return new RegExp(escaped, "i");
  }
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function finaliseCopy(
  platform: Platform,
  body: string,
  input?: InstantPostInput,
  context?: Record<string, unknown>,
  scheduledFor?: Date | null,
) {
  let updated = body.replace(/\r\n/g, "\n").trim();

  if (input?.ctaUrl) {
    const escaped = input.ctaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    updated = updated.replace(new RegExp(escaped, "gi"), "");
  }

  const lines = updated
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim())
    .map((line) => line.replace(/\s{2,}/g, " ").trimEnd())
    .filter((line) => line.length);

  if (context?.promotionEnd && typeof context.promotionEnd === "string") {
    const endDate = new Date(context.promotionEnd);
    const scheduled = scheduledFor ?? null;
    if (!Number.isNaN(endDate.getTime()) && scheduled) {
      const diffMs = endDate.getTime() - scheduled.getTime();
      const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays > 3) {
        const formatted = `${formatWeekday(endDate)} ${formatDayMonth(endDate)}`;
        const alreadyPresent = lines.some((line) =>
          line.toLowerCase().includes(formatted.toLowerCase()),
        );
        if (!alreadyPresent) {
          lines.push(`Available until ${formatted}.`);
        }
      }
    }
  }

  const compacted = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n/g, "\n")
    .trim();

  const { body: finalBody, repairs, proofPoint } = applyChannelRules({
    body: compacted,
    platform,
    placement: input?.placement ?? "feed",
    context: {
      ...(context ?? {}),
      ctaUrl: input?.ctaUrl ?? context?.ctaUrl ?? null,
      linkInBioUrl: input?.linkInBioUrl ?? context?.linkInBioUrl ?? null,
    },
    advanced: input,
    scheduledFor: scheduledFor ?? null,
  });

  return { body: finalBody, repairs, proofPoint };
}

function resolveFacebookCtaLabel(context?: Record<string, unknown>) {
  const contextual = extractContextString(context, "ctaLabel");
  return contextual ?? "Learn more";
}

function extractContextString(context: Record<string, unknown> | undefined, key: string) {
  if (!context) return null;
  const candidate = context[key];
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length ? trimmed : null;
}

function resolveDefaultCtaLabel(
  flow: "instant" | "event" | "promotion" | "weekly",
  ctaUrl?: string | null,
  ctaLabel?: string | null,
) {
  if (!ctaUrl) return null;
  if (ctaLabel && ctaLabel.trim().length) return ctaLabel;
  switch (flow) {
    case "event":
      return "Book now";
    case "promotion":
      return "Learn more";
    case "weekly":
      return "Book a table";
    case "instant":
    default:
      return "Learn more";
  }
}

function enforceInstagramLength(value: string) {
  const lines = value.split("\n");
  const hashtagIndex = lines.findIndex((line) => line.trim().startsWith("#"));
  const hashtagLines = hashtagIndex >= 0 ? lines.slice(hashtagIndex) : [];
  const bodyLines = hashtagIndex >= 0 ? lines.slice(0, hashtagIndex) : [...lines];
  const originalWordCount = countWords(bodyLines.join(" "));
  if (originalWordCount <= INSTAGRAM_WORD_LIMIT) {
    return value;
  }

  const workingBody = [...bodyLines];
  const linkIndex = workingBody.findIndex((line) => line.toLowerCase().includes("link in our bio"));
  const linkLine = linkIndex >= 0 ? workingBody.splice(linkIndex, 1)[0] : null;
  const linkWords = linkLine ? countWords(linkLine) : 0;
  let remainingWords = Math.max(INSTAGRAM_WORD_LIMIT - linkWords, 0);

  const trimmedBody: string[] = [];
  for (const line of workingBody) {
    const wordsInLine = countWords(line);
    if (!wordsInLine) {
      if (trimmedBody.length) {
        trimmedBody.push("");
      }
      continue;
    }
    if (wordsInLine <= remainingWords) {
      trimmedBody.push(line);
      remainingWords -= wordsInLine;
      continue;
    }
    if (remainingWords > 0) {
      const trimmedLine = trimLineToWords(line, remainingWords);
      if (trimmedLine.length) {
        trimmedBody.push(trimmedLine);
      }
    }
    remainingWords = 0;
    break;
  }

  const cleanedBody =
    trimmedBody.length === 0
      ? []
      : trimmedBody.filter((line, index) => {
        if (line.trim().length) return true;
        return index > 0 && index < trimmedBody.length - 1;
      });

  const finalLines = linkLine ? [...cleanedBody, linkLine] : cleanedBody;
  if (hashtagLines.length) {
    finalLines.push(...hashtagLines);
  }

  return finalLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function countWords(value: string) {
  if (!value) return 0;
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function trimLineToWords(line: string, limit: number) {
  if (limit <= 0) return "";
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.slice(0, Math.min(limit, tokens.length)).join(" ");
}

export const __testables = {
  finaliseCopyForTest: (...args: Parameters<typeof finaliseCopy>) => finaliseCopy(...args).body,
  enforceInstagramLengthForTest: enforceInstagramLength,
  resolveFacebookCtaLabelForTest: resolveFacebookCtaLabel,
  reserveSlotOnSameDayForTest: reserveSlotOnSameDay,
  describeEventTimingCueForTest: (scheduledFor: Date | null, eventStart: Date) =>
    describeEventTimingCue(scheduledFor, eventStart),
  fetchRecentCopyHistoryForTest: fetchRecentCopyHistory,
};

function combineDateAndTime(date: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE })
    .set({ hour: safeHours, minute: safeMinutes, second: 0, millisecond: 0 })
    .toJSDate();
}

function getFirstOccurrence(startDate: Date, dayOfWeek: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const startBaseline = DateTime.fromJSDate(startDate, { zone: DEFAULT_TIMEZONE });
  let candidate = startBaseline.set({
    hour: Number.isFinite(hours) ? hours : 0,
    minute: Number.isFinite(minutes) ? minutes : 0,
    second: 0,
    millisecond: 0,
  });

  const normalizedCurrent = candidate.weekday % 7; // Luxon: 1-7 (Mon-Sun), mod 7 -> 0-6 with 0 as Sunday
  const targetDay = ((dayOfWeek % 7) + 7) % 7;

  let diff = (targetDay - normalizedCurrent + 7) % 7;
  if (diff === 0 && candidate.toMillis() < startBaseline.toMillis()) {
    diff = 7;
  }
  candidate = candidate.plus({ days: diff });

  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  while (candidate.toMillis() < minimumTime) {
    candidate = candidate.plus({ weeks: 1 });
  }

  return candidate.toJSDate();
}

function weekdayLabel(day: number) {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][day];
}
