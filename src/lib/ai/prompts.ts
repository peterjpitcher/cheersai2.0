import { DateTime } from "luxon";

import { BANNED_PHRASES, PREFERRED_PHRASES, TONE_PROFILE } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";

interface PromptContext {
  brand: BrandProfile;
  input: InstantPostInput;
  platform: "facebook" | "instagram" | "gbp";
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  venueName?: string;
}

interface PromptMessages {
  system: string;
  user: string;
}

export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName }: PromptContext): PromptMessages {
  const systemLines = [
    "You are CheersAI, crafting social content for a single-owner pub.",
    "Use British English.",
    'Write as the venue team using "we" or "us".',
    venueName ? `Refer to the venue as "${venueName}" when appropriate, but don't overuse it.` : "Never name the venue explicitly.",
    "Keep copy warm, human, and helpful.",
    `Tone profile: ${TONE_PROFILE}`,
    "Output only the final caption text. No labels, no quotes, no commentary.",
    describeToneTargets(brand),
    formatListLine("Do not mention", brand.bannedTopics),
    formatListLine("Avoid these phrases", BANNED_PHRASES),
  ].filter(isNonEmptyString);

  const brandLines = [
    formatListLine("Key phrases to weave in if natural", brand.keyPhrases),
    formatListLine("Preferred phrases when natural", PREFERRED_PHRASES),
    input.includeHashtags && platform !== "instagram" && platform !== "gbp"
      ? formatListLine("Default hashtags", brand.defaultHashtags, " ")
      : null,
    input.includeEmojis ? formatListLine("Preferred emojis", brand.defaultEmojis, " ") : null,
  ].filter(isNonEmptyString);

  const sections: string[] = [
    input.title?.trim() ? `Title: ${input.title.trim()}` : null,
    input.prompt?.trim() ? `Request: ${input.prompt.trim()}` : null,
    brandLines.length ? `Brand voice:\n${brandLines.join("\n")}` : null,
    buildMediaLine(input),
    buildContextBlock({ scheduledFor, context }),
    `Platform guidance:\n${buildPlatformGuidance(platform, brand, input)}`,
    `Adjustments:\n${describeAdjustments(platform, input)}`,
    `Examples of good style (British English, warm, no hashtags in body):\n${getFewShotExamples()}`,
  ].filter(isNonEmptyString);

  return {
    system: systemLines.join("\n"),
    user: sections.join("\n\n"),
  };
}

function buildPlatformGuidance(
  platform: "facebook" | "instagram" | "gbp",
  brand: BrandProfile,
  input: InstantPostInput,
) {
  switch (platform) {
    case "facebook":
      return [
        "Keep it concise, but feel free to write up to 120 words if the story needs it.",
        input.includeHashtags
          ? "Include a CTA and 2-3 relevant hashtags if it feels natural."
          : "Include a CTA and keep copy hashtag-free.",
        formatOptionalLine("Optional signature", brand.facebookSignature),
      ]
        .filter(Boolean)
        .join("\n");
    case "instagram":
      const hasLink = Boolean(input.linkInBioUrl || input.ctaUrl);
      return [
        "Write up to 80 words with line breaks.",
        "Do not include URLs.",
        hasLink
          ? "Finish with a natural link-in-bio line (e.g. 'Link in bio to book', 'Check the link in our bio', 'Details in bio')."
          : "Do not mention link in bio unless a link is provided.",
        input.includeHashtags
          ? formatHashtagGuidance(brand)
          : "Do not add hashtags; rely on copy only.",
        formatOptionalLine("Optional signature", brand.instagramSignature),
      ]
        .filter(Boolean)
        .join("\n");
    case "gbp":
      return `Write concise GBP update under 250 words. Include CTA ${brand.gbpCta ?? "LEARN_MORE"}. Avoid hashtags.`;
    default:
      return "";
  }
}

function describeAdjustments(
  platform: "facebook" | "instagram" | "gbp",
  input: InstantPostInput,
) {
  const lines: string[] = [];

  switch (input.toneAdjust) {
    case "more_formal":
      lines.push("Lean more formal than usual while staying warm and welcoming.");
      break;
    case "more_casual":
      lines.push("Use extra casual phrasing and relaxed contractions.");
      break;
    case "more_serious":
      lines.push("Dial down jokes or slang; focus on trust and credibility.");
      break;
    case "more_playful":
      lines.push("Amp up playful wording and energy without sounding forced.");
      break;
  }

  switch (input.lengthPreference) {
    case "short":
      lines.push("Keep it to one or two punchy sentences.");
      break;
    case "detailed":
      lines.push("Offer a richer description with specific details that help guests imagine the experience.");
      break;
  }

  if (!input.includeEmojis) {
    lines.push("Avoid emojis entirely.");
  } else {
    lines.push("Use emojis sparingly and only where they enhance the message.");
  }

  if (!input.includeHashtags || platform === "gbp") {
    lines.push("Do not include hashtags in the copy.");
  }

  switch (input.ctaStyle) {
    case "direct":
      if (platform !== "instagram") {
        lines.push("Close with a clear, direct call to action (e.g. Book now, Reserve your table).");
      }
      break;
    case "urgent":
      if (platform !== "instagram") {
        lines.push("Close with an urgent CTA highlighting limited availability or time.");
      }
      break;
  }

  lines.push("Format any times like 6pm or 7:30pm (no spaces, lowercase am/pm).");

  if (platform === "facebook") {
    if (input.ctaUrl) {
      lines.push(
        "If a CTA URL is provided, include a clear call to action aligned with the CTA label/objective, but do not include the URL—our system appends it.",
      );
    } else {
      lines.push("Include a clear CTA suited to the venue (link optional).");
    }
  } else if (platform === "instagram") {
    if (input.linkInBioUrl || input.ctaUrl) {
      lines.push("Do not include any URLs—reference our link in bio instead.");
      lines.push("If a CTA label is provided, align the final link-in-bio line with it (e.g. Book now, Find out more).");
    } else {
      lines.push("Do not include URLs or link-in-bio language.");
    }
  }

  if (!lines.length) {
    lines.push("Follow the brand defaults for tone, pacing, and CTA style.");
  }

  return lines.join("\n");
}

function describeToneTargets(brand: BrandProfile) {
  const formal = describeSlider(brand.toneFormal, "very casual", "balanced", "formal");
  const playful = describeSlider(brand.tonePlayful, "straightforward", "lightly playful", "playful and lively");
  return `Tone targets: Formality is ${formal}; Playfulness is ${playful}.`;
}

function describeSlider(value: number, low: string, mid: string, high: string) {
  const normalized = clamp01(value);
  if (normalized >= 0.7) return high;
  if (normalized <= 0.3) return low;
  return mid;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function isNonEmptyString(value: string | null | undefined | false): value is string {
  return Boolean(value);
}

function formatListLine(label: string, items: string[], joiner = ", ") {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return `${label}: ${cleaned.join(joiner)}.`;
}

function formatOptionalLine(label: string, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withPunctuation = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${label}: ${withPunctuation}`;
}

function formatHashtagGuidance(brand: BrandProfile) {
  const defaults = brand.defaultHashtags.map((tag) => tag.trim()).filter(Boolean);
  if (!defaults.length) {
    return "Include up to 10 relevant hashtags.";
  }
  return `Include up to 10 hashtags. Prefer these defaults: ${defaults.join(" ")}.`;
}

function buildMediaLine(input: InstantPostInput) {
  if (!input.media?.length) {
    return "Media: none provided.";
  }
  const entries = input.media.map((asset) => {
    const label = asset.mediaType === "video" ? "Video" : "Image";
    const fileName = asset.fileName?.trim();
    return fileName ? `${label}: ${fileName}` : `${label}: attached`;
  });
  return `Media: ${entries.join("; ")}.`;
}

function buildContextBlock({
  scheduledFor,
  context,
}: {
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
}) {
  const lines: string[] = [];

  if (scheduledFor) {
    lines.push(`Post scheduled for ${formatDateTime(scheduledFor)} (local time).`);
  }

  const eventStart = parseIsoDate(context?.eventStart);
  if (eventStart) {
    lines.push(`Event starts ${formatDateTime(eventStart)}.`);
  }

  const promotionStart = parseIsoDate(context?.promotionStart);
  const promotionEnd = parseIsoDate(context?.promotionEnd);
  if (promotionStart && promotionEnd) {
    lines.push(`Promotion runs ${formatDate(promotionStart)} to ${formatDate(promotionEnd)}.`);
  } else if (promotionEnd) {
    lines.push(`Promotion ends ${formatDate(promotionEnd)}.`);
  }

  const ctaLabel = extractContextString(context, "ctaLabel");
  if (ctaLabel) {
    lines.push(`CTA label to use: ${ctaLabel}.`);
  }

  const phase = extractContextString(context, "phase");
  if (phase && phase !== "custom") {
    lines.push(`Campaign phase: ${phase}.`);
  }

  const slot = extractContextString(context, "slot");
  if (slot && !/^manual-\d+$/i.test(slot) && !/^custom-\d+$/i.test(slot)) {
    lines.push(`Slot focus: ${slot}.`);
  }

  if (!lines.length) return null;
  return `Timing and context:\n${lines.join("\n")}`;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractContextString(context: Record<string, unknown> | undefined, key: string) {
  if (!context) return null;
  const value = context[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatDateTime(date: Date) {
  const zoned = DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE });
  return `${zoned.setLocale("en-GB").toFormat("cccc d LLLL")} at ${formatFriendlyTime(zoned)}`;
}

function formatDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc d LLLL");
}

function formatFriendlyTime(zoned: DateTime) {
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

function getFewShotExamples() {
  return `
Example 1:
Join us for a proper Sunday roast this weekend. We're serving up slow-roasted beef with all the trimmings, including our massive Yorkies. It's the perfect way to gather the family before the week starts again. Book your table now to avoid missing out.

Example 2:
The Six Nations is back on our screens! We'll be showing every match live, so grab a pint of Guinness and settle in for the action. Atmosphere guaranteed. Who are you backing this year?

Example 3:
Looking for the perfect spot for a midweek catch-up? Our burger and pint night is just the ticket. Great food, cold drinks, and even better company. See you at the bar!
`.trim();
}
