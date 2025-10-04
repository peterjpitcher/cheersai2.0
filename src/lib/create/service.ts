import { OWNER_ACCOUNT_ID } from "@/lib/constants";
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

type Platform = InstantPostInput["platforms"][number];

interface VariantPlan {
  title: string;
  prompt: string;
  scheduledFor: Date | null;
  platforms: Platform[];
  media?: MediaAssetInput[];
  promptContext?: Record<string, unknown>;
  options?: InstantPostAdvancedOptions;
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
}

const DEFAULT_ADVANCED_OPTIONS: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

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

export async function createInstantPost(input: InstantPostInput) {
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const isScheduled = input.publishMode === "schedule" && Boolean(input.scheduledFor);
  const scheduledForDate = isScheduled ? input.scheduledFor ?? new Date() : null;
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
      },
      options: advancedOptions,
    },
  ];

  return createCampaignFromPlans({
    supabase,
    brand,
    name: input.title,
    type: "instant",
    metadata: {
      prompt: input.prompt,
      createdWith: "instant-post",
      publishMode: input.publishMode,
      advanced: advancedOptions,
    },
    plans,
  });
}

export async function createEventCampaign(input: EventCampaignInput) {
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const eventStart = combineDateAndTime(input.startDate, input.startTime);
  const advancedOptions = extractAdvancedOptions(input);

  const plans: VariantPlan[] = input.scheduleOffsets.map((slot) => {
    const scheduledFor = new Date(eventStart.getTime() + slot.offsetHours * 60 * 60 * 1000);
    const basePrompt =
      input.prompt ??
      `Event: ${input.name} on ${eventStart.toLocaleDateString()} at ${eventStart.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}. ${input.description}`;

    return {
      title: `${input.name} — ${slot.label}`,
      prompt: `${basePrompt}
Slot: ${slot.label}`,
      scheduledFor,
      platforms: input.platforms,
      media: input.heroMedia,
      promptContext: {
        title: input.name,
        description: input.description,
        slot: slot.label,
        eventStart: eventStart.toISOString(),
      },
      options: advancedOptions,
    };
  });

  return createCampaignFromPlans({
    supabase,
    brand,
    name: input.name,
    type: "event",
    metadata: {
      description: input.description,
      eventStart: eventStart.toISOString(),
      offsets: input.scheduleOffsets,
      advanced: advancedOptions,
    },
    plans,
  });
}

export async function createPromotionCampaign(input: PromotionCampaignInput) {
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const start = input.startDate;
  const end = input.endDate;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const mid = new Date(start.getTime() + durationMs / 2);
  let lastChance = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  if (lastChance <= start) {
    lastChance = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  }

  const basePrompt =
    input.prompt ??
    `Promotion: ${input.name}. Offer details: ${input.offerSummary}. Valid ${start.toLocaleDateString()} to ${end.toLocaleDateString()}.`;

  const advancedOptions = extractAdvancedOptions(input);

  const plans: VariantPlan[] = [
    {
      title: `${input.name} — Launch`,
      prompt: `${basePrompt}
Launch day energy — let everyone know it starts now!`,
      scheduledFor: start,
      platforms: input.platforms,
      media: input.heroMedia,
      promptContext: { phase: "launch", start: start.toISOString() },
      options: advancedOptions,
    },
    {
      title: `${input.name} — Mid-run reminder`,
      prompt: `${basePrompt}
Mid-run reminder to keep bookings flowing.`,
      scheduledFor: mid,
      platforms: input.platforms,
      media: input.heroMedia,
      promptContext: { phase: "mid", mid: mid.toISOString() },
      options: advancedOptions,
    },
    {
      title: `${input.name} — Last chance`,
      prompt: `${basePrompt}
Final call urgency — the offer ends soon!`,
      scheduledFor: lastChance,
      platforms: input.platforms,
      media: input.heroMedia,
      promptContext: { phase: "last-chance", end: end.toISOString() },
      options: advancedOptions,
    },
  ];

  return createCampaignFromPlans({
    supabase,
    brand,
    name: input.name,
    type: "promotion",
    metadata: {
      offerSummary: input.offerSummary,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      advanced: advancedOptions,
    },
    plans,
  });
}

export async function createWeeklyCampaign(input: WeeklyCampaignInput) {
  const supabase = createServiceSupabaseClient();
  const { brand } = await getOwnerSettings();

  const firstOccurrence = getFirstOccurrence(input.startDate, input.dayOfWeek, input.time);
  const weeksAhead = input.weeksAhead ?? 4;
  const advancedOptions = extractAdvancedOptions(input);
  const [hourStr = "19", minuteStr = "0"] = input.time.split(":");
  const parsedHour = Number(hourStr);
  const parsedMinute = Number(minuteStr);
  const cadenceHour = Number.isFinite(parsedHour) ? parsedHour : 19;
  const cadenceMinute = Number.isFinite(parsedMinute) ? parsedMinute : 0;
  const cadence = input.platforms.map((platform) => ({
    platform,
    weekday: input.dayOfWeek,
    hour: cadenceHour,
    minute: cadenceMinute,
  }));

  const plans: VariantPlan[] = Array.from({ length: weeksAhead }).map((_, index) => {
    const scheduledFor = new Date(firstOccurrence.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    const promptBase =
      input.prompt ??
      `Weekly feature: ${input.name}. ${input.description}. Happening every ${weekdayLabel(input.dayOfWeek)} at ${input.time}.`;

    return {
      title: `${input.name} — Week ${index + 1}`,
      prompt: `${promptBase}
Week ${index + 1} preview.`,
      scheduledFor,
      platforms: input.platforms,
      media: input.heroMedia,
      promptContext: {
        occurrenceIndex: index + 1,
        dayOfWeek: input.dayOfWeek,
        time: input.time,
      },
      options: advancedOptions,
    };
  });

  return createCampaignFromPlans({
    supabase,
    brand,
    name: input.name,
    type: "weekly",
    metadata: {
      description: input.description,
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      weeksAhead,
      cadence,
      advanced: advancedOptions,
    },
    plans,
  });
}

async function createCampaignFromPlans({
  supabase,
  brand,
  name,
  type,
  metadata,
  plans,
}: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  plans: VariantPlan[];
}) {
  if (!plans.length) {
    throw new Error("Cannot create campaign without plans");
  }

  const variants = await buildVariants({ brand, plans });

  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      account_id: OWNER_ACCOUNT_ID,
      name,
      campaign_type: type,
      status: "scheduled",
      metadata,
    })
    .select("id")
    .single();

  if (campaignError) throw campaignError;

  const nowIso = new Date().toISOString();

  const contentRows = variants.map((variant) => ({
    campaign_id: campaignRow.id,
    account_id: OWNER_ACCOUNT_ID,
    platform: variant.platform,
    scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
    status: variant.scheduledFor ? "scheduled" : "queued",
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
      enqueuePublishJob({
        contentItemId: content.id,
        scheduledFor: variants[index]?.scheduledFor ?? null,
      }),
    ),
  );

  const hasImmediate = variants.some((variant) => !variant.scheduledFor);
  const status = hasImmediate ? "queued" : "scheduled";
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

  for (const plan of plans) {
    const options = resolveAdvancedOptions(plan.options);
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
        },
        options,
        mediaIds: plan.media?.map((asset) => asset.assetId) ?? [],
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
      const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
      const text = response.output_text?.trim();
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
  const result = new Date(start);
  result.setHours(hours, minutes, 0, 0);

  const currentDay = result.getDay();
  let diff = (dayOfWeek - currentDay + 7) % 7;
  if (diff === 0 && result < start) {
    diff = 7;
  }
  result.setDate(result.getDate() + diff);
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
