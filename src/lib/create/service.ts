import { requireAuthContext } from "@/lib/auth/server";
import type {
  EventCampaignInput,
  InstantPostAdvancedOptions,
  InstantPostInput,
  MediaAssetInput,
  PromotionCampaignInput,
  WeeklyCampaignInput,
} from "@/lib/create/schema";
import { buildInstantPostPrompt } from "@/lib/ai/prompts";
import { getOpenAIClient } from "@/lib/ai/client";
import { getOwnerSettings } from "@/lib/settings/data";
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

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
}

interface GeneratedVariantResult {
  platform: Platform;
  body: string;
}

interface BuiltVariant {
  platform: Platform;
  body: string;
  scheduledFor: Date | null;
  promptContext: Record<string, unknown>;
  mediaIds: string[];
  options: InstantPostAdvancedOptions;
  linkInBioUrl?: string | null;
}

const DEFAULT_ADVANCED_OPTIONS: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const MIN_SCHEDULE_OFFSET_MS = 15 * 60 * 1000;

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

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(date);
}

function formatDayMonth(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
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
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const isScheduled = input.publishMode === "schedule" && Boolean(input.scheduledFor);
  const scheduledForDate = isScheduled ? ensureFutureDate(input.scheduledFor ?? new Date()) : null;
  if (isScheduled && (!input.media || input.media.length === 0)) {
    throw new Error("Scheduled posts require at least one media asset.");
  }
  const advancedOptions = extractAdvancedOptions(input);

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
        ctaUrl: input.ctaUrl ?? null,
        linkInBioUrl: input.linkInBioUrl ?? null,
      },
      options: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
    },
  ];

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    name: input.title,
    type: "instant",
    metadata: {
      prompt: input.prompt,
      createdWith: "instant-post",
      publishMode: input.publishMode,
      advanced: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
    },
    plans,
    options: {
      autoSchedule: false,
    },
    linkInBioUrl: input.linkInBioUrl ?? null,
  });
}

export async function createEventCampaign(input: EventCampaignInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const eventStart = combineDateAndTime(input.startDate, input.startTime);
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const advancedOptions = extractAdvancedOptions(input);
  const manualSchedule = input.customSchedule ?? [];
  const usingManualSchedule = manualSchedule.length > 0;

  const basePrompt = composePrompt(
    [
      `Event name: ${input.name}`,
      input.description ? `Event details: ${input.description}` : "",
      `Event starts ${eventStart.toLocaleDateString()} at ${eventStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
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
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
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
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        });
        return acc;
      }, []);

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
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
      ctaUrl: input.ctaUrl ?? null,
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
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const start = input.startDate;
  const end = input.endDate;
  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const mid = new Date(start.getTime() + durationMs / 2);
  let lastChance = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  if (lastChance <= start) {
    lastChance = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  }

  const basePrompt = composePrompt(
    [
      `Promotion: ${input.name}`,
      input.offerSummary ? `Offer details: ${input.offerSummary}` : "",
      `Runs ${start.toLocaleDateString()} to ${end.toLocaleDateString()}.`,
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
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
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
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        });
        return acc;
      }, []);

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
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
      ctaUrl: input.ctaUrl ?? null,
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
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

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

  const promptBase = composePrompt(
    [
      `Weekly feature: ${input.name}`,
      input.description ? `Campaign details: ${input.description}` : "",
      `Occurs every ${weekdayLabel(input.dayOfWeek)} at ${input.time}.`,
    ],
    input.prompt,
  );

  const plans: VariantPlan[] = usingManualSchedule
    ? manualSchedule.map((scheduledFor, index) => {
        const futureSlot = ensureFutureDate(scheduledFor ?? null) ?? new Date(minimumTime);
        return {
          title: `${input.name} — Slot ${index + 1}`,
          prompt: [promptBase, `Focus: Custom slot ${index + 1}.`].filter(Boolean).join("\n\n"),
          scheduledFor: futureSlot,
          platforms: input.platforms,
          media: input.heroMedia,
          promptContext: {
            occurrenceIndex: index + 1,
            custom: true,
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        };
      })
    : Array.from({ length: weeksAhead }).reduce<VariantPlan[]>((acc, _, index) => {
        const candidate = new Date(firstOccurrence.getTime() + index * 7 * 24 * 60 * 60 * 1000);
        if (candidate.getTime() < minimumTime) {
          return acc;
        }
        const futureSlot = ensureFutureDate(candidate) ?? new Date(minimumTime);
        acc.push({
          title: `${input.name} — Week ${index + 1}`,
          prompt: [promptBase, `Focus: Week ${index + 1} preview.`].filter(Boolean).join("\n\n"),
          scheduledFor: futureSlot,
          platforms: input.platforms,
          media: input.heroMedia,
          promptContext: {
            occurrenceIndex: index + 1,
            dayOfWeek: input.dayOfWeek,
            time: input.time,
            ctaUrl: input.ctaUrl ?? null,
            linkInBioUrl: input.linkInBioUrl ?? null,
          },
          options: advancedOptions,
          ctaUrl: input.ctaUrl ?? null,
          linkInBioUrl: input.linkInBioUrl ?? null,
        });
        return acc;
      }, []);

  return createCampaignFromPlans({
    supabase,
    accountId,
    brand,
    name: input.name,
    type: "weekly",
    metadata: {
      description: input.description,
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      weeksAhead,
      cadence,
      manualSchedule: usingManualSchedule
        ? manualSchedule.map((date) => date.toISOString())
        : undefined,
      advanced: advancedOptions,
      ctaUrl: input.ctaUrl ?? null,
      linkInBioUrl: input.linkInBioUrl ?? null,
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
  name,
  type,
  metadata,
  plans,
  options,
  linkInBioUrl,
}: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  accountId: string;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
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

  const variants = await buildVariants({ brand, plans });
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

  await Promise.all(
    (insertedContent ?? []).map((content, index) =>
      supabase
        .from("content_variants")
        .upsert({
          content_item_id: content.id,
          body: variants[index]?.body ?? "",
          media_ids: variants[index]?.mediaIds.length ? variants[index]?.mediaIds : null,
        })
        .then(() => undefined),
    ),
  );

  await Promise.all(
    (insertedContent ?? []).map((content, index) =>
      shouldAutoSchedule
        ? enqueuePublishJob({
            contentItemId: content.id,
            scheduledFor: variants[index]?.scheduledFor ?? null,
          })
        : Promise.resolve(),
    ),
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
  plans,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
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
    };

    const generated = await generateVariants({ brand, input: instantInput });
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
      });
    }
  }

  return variants;
}

async function generateVariants({
  brand,
  input,
}: {
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  input: InstantPostInput;
}): Promise<GeneratedVariantResult[]> {
  let client: ReturnType<typeof getOpenAIClient> | null = null;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof Error && error.message.includes("OPENAI")) {
      return input.platforms.map((platform) => ({
        platform,
        body: fallbackCopy(platform, input),
      }));
    }
    throw error;
  }

  const results: GeneratedVariantResult[] = [];

  for (const platform of input.platforms) {
    try {
      const prompt = buildInstantPostPrompt({ brand, input, platform });
      if (DEBUG_CONTENT_GENERATION) {
        console.debug("[create] openai prompt", {
          platform,
          title: input.title,
          prompt,
        });
      }
      const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
      const text = response.output_text?.trim();
      if (DEBUG_CONTENT_GENERATION) {
        console.debug("[create] openai output", { platform, hasText: Boolean(text), preview: text?.slice(0, 120) });
      }
      results.push({
        platform,
        body: text && text.length > 0 ? text : fallbackCopy(platform, input),
      });
    } catch (error) {
      if (isSchemaMissingError(error)) {
        results.push({ platform, body: fallbackCopy(platform, input) });
        continue;
      }
      console.error("[create] openai generation failed", error);
      results.push({ platform, body: fallbackCopy(platform, input) });
    }
  }

  return results;
}

function fallbackCopy(platform: Platform, input: InstantPostInput) {
  const truncatedPrompt = input.prompt.length > 180 ? `${input.prompt.slice(0, 177)}…` : input.prompt;

  let baseLine = `"${input.title}" — ${truncatedPrompt}`;

  if (input.lengthPreference === "short") {
    const firstSentence = truncatedPrompt.split(/[.!?]/)[0] ?? truncatedPrompt;
    baseLine = `${input.title}: ${firstSentence.trim()}`;
  } else if (input.lengthPreference === "detailed") {
    baseLine = `"${input.title}" — ${truncatedPrompt}\nHere’s what to expect: ${truncateSentence(
      truncatedPrompt,
      90,
    )}`;
  }

  switch (input.toneAdjust) {
    case "more_formal":
      baseLine = baseLine.replace(/!+/g, ".");
      if (!baseLine.includes("We look forward")) {
        baseLine = `${baseLine}\nWe look forward to welcoming you.`;
      }
      break;
    case "more_casual":
      baseLine = `${baseLine}\nPop in and say hi!`;
      break;
    case "more_playful":
      baseLine = `${baseLine}\nLet’s make it a night to remember!`;
      break;
    case "more_serious":
      baseLine = baseLine.replace(/!+/g, ".");
      break;
  }

  const ctaLine = buildFallbackCta(platform, input.ctaStyle);

  const lines: string[] = [baseLine];
  if (platform === "facebook" && input.ctaUrl) {
    lines.push(`Learn more: ${input.ctaUrl}`);
  }
  if (ctaLine) {
    lines.push(ctaLine);
  }

  if (input.includeEmojis) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex]} 🎉`;
  }

  if (input.includeHashtags && platform !== "gbp") {
    const hashtags = platform === "instagram" ? "#cheersai #pubnight" : "#CheersAI";
    lines.push(hashtags);
  }

  return lines.join("\n");
}

function buildFallbackCta(platform: Platform, style: InstantPostAdvancedOptions["ctaStyle"]) {
  switch (style) {
    case "direct":
      return platform === "gbp" ? "Book now to secure your visit." : "Book now to lock in your spot.";
    case "urgent":
      return platform === "gbp"
        ? "Limited slots available — act quickly!"
        : "Spots are limited, grab yours now!";
    default:
      return platform === "instagram" ? "See you at the bar!" : "Can’t wait to host you.";
  }
}

function truncateSentence(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function combineDateAndTime(date: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}

function getFirstOccurrence(startDate: Date, dayOfWeek: number, time: string) {
  const start = new Date(startDate);
  const [hours, minutes] = time.split(":").map(Number);
  let result = new Date(start);
  result.setHours(hours, minutes, 0, 0);

  const currentDay = result.getDay();
  let diff = (dayOfWeek - currentDay + 7) % 7;
  if (diff === 0 && result < start) {
    diff = 7;
  }
  result.setDate(result.getDate() + diff);

  const minimumTime = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  while (result.getTime() < minimumTime) {
    result = new Date(result.getTime() + 7 * DAY_MS);
  }

  return result;
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
