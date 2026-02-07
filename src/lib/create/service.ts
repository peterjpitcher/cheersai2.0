import { DateTime } from "luxon";

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


const DEBUG_CONTENT_GENERATION = process.env.DEBUG_CONTENT_GENERATION === "true";

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

function formatFriendlyTime(date: Date) {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE });
  const hours = zoned.hour;
  const minutes = zoned.minute;
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = ((hours + 11) % 12) + 1;
  if (minutes === 0) {
    return `${hour12}${suffix}`;
  }
  const minuteStr = minutes.toString().padStart(2, "0");
  return `${hour12}:${minuteStr}${suffix}`;
}

function ensureFutureDate(input: Date | null | undefined): Date | null {
  if (!input) return null;
  const candidate = new Date(input);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  if (candidate.getTime() < minimumTime) {
    return new Date(minimumTime);
  }
  return candidate;
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

function describeEventTimingCue(scheduledFor: Date | null, eventStart: Date) {
  if (!scheduledFor) {
    return "Share live highlights and keep guests engaged in real time.";
  }

  const diffMs = eventStart.getTime() - scheduledFor.getTime();
  const diffHours = Math.round(diffMs / HOUR_MS);
  const diffDays = Math.floor(diffMs / DAY_MS);
  const weekday = formatWeekday(eventStart);
  const dayMonth = formatDayMonth(eventStart);
  const timeLabel = formatTime(eventStart);

  if (diffMs <= 0) {
    return "Make it clear the event is underway right now and draw in any last-minute arrivals.";
  }

  if (diffHours <= 3) {
    return `Say it’s happening in just a few hours (tonight at ${timeLabel}) and drive final RSVPs.`;
  }

  if (diffDays === 0) {
    return `Call out that it’s happening today at ${timeLabel}—push final sign-ups and arrivals.`;
  }

  if (diffDays === 1) {
    return `Say it’s tomorrow (${weekday} ${dayMonth}) and stress limited spots before ${timeLabel}.`;
  }

  if (diffDays <= 3) {
    return `Refer to it as this ${weekday} (${dayMonth}) and keep the countdown energy high.`;
  }

  if (diffDays <= 7) {
    return `Mention it’s next ${weekday} (${dayMonth}) at ${timeLabel} and encourage early sign-ups.`;
  }

  return `Highlight the date ${weekday} ${dayMonth} at ${timeLabel} and build anticipation while pushing sign-ups.`;
}

function formatFocusLabel(label: string) {
  const trimmed = label.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildEventFocusLine(label: string, scheduledFor: Date | null, eventStart: Date) {
  const cue = describeEventTimingCue(scheduledFor, eventStart);
  return `Focus: ${formatFocusLabel(label)} ${cue}`;
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
  const { brand, venueName } = await getOwnerSettings();

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
  const { brand, venueName } = await getOwnerSettings();

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
  const { brand, venueName } = await getOwnerSettings();

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
  const { brand, venueName } = await getOwnerSettings();

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
  const { brand, venueName } = await getOwnerSettings();

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

  const plans: VariantPlan[] = usingManualSchedule
    ? sortedManualSchedule.map((scheduledFor, index) => {
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
    })
    : (() => {
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
      return list;
    })();

  const displayEndDateIso = plans.length
    ? plans[plans.length - 1]?.scheduledFor?.toISOString() ?? null
    : null;

  const effectiveWeeksAhead = usingManualSchedule ? sortedManualSchedule.length || weeksAhead : weeksAhead;

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    venueName,
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
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

async function createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
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

  const variants = await buildVariants({ brand, venueName, plans });
  const shouldAutoSchedule = options?.autoSchedule ?? true;

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
  plans,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  plans: VariantPlan[];
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

  for (const plan of plans) {
    const options = resolveAdvancedOptions(plan.options);
    const planCta = plan.ctaUrl ?? (typeof plan.promptContext?.ctaUrl === "string"
      ? (plan.promptContext.ctaUrl as string)
      : undefined);
    const placement = plan.placement ?? "feed";

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
        variants.push({
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
      continue;
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

    const generated = await generateVariants({
      brand,
      venueName,
      input: instantInput,
      scheduledFor: plan.scheduledFor ?? null,
      context: plan.promptContext ?? undefined,
    });
    for (const variant of generated) {
      variants.push({
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
        placement,
        validation: variant.validation,
      });
    }
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

  const results: GeneratedVariantResult[] = [];

  for (const platform of input.platforms) {
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
          results.push({
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
          });
        } else {
          results.push({
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
          });
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

  updated = updated.replace(/The Anchor/gi, "we");

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
