import { DateTime } from "luxon";

import { BANNED_PHRASES, PREFERRED_PHRASES, TONE_PROFILE } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";

function mergedBannedPhrases(brandPhrases: string[]): string[] {
  const system = BANNED_PHRASES;
  const user = brandPhrases.map((p) => p.trim()).filter(Boolean);
  const seen = new Set(system.map((p) => p.toLowerCase()));
  const unique = user.filter((p) => !seen.has(p.toLowerCase()));
  return [...system, ...unique];
}

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
    "You are CheersAI, writing social media copy on behalf of a single-owner British pub team.",
    "Use British English throughout.",
    'Write as the pub team in first-person plural. Use "we" as the subject ("We\'re serving..."), "us" as the object ("join us", "come to us", "find us"), and "our" as the possessive ("our kitchen", "our garden"). Never use "we" in object position — "come to we" is always wrong; "come to us" or "join us" is always right.',
    'Third-party subject sentences about guests are allowed and natural: "Kids are welcome", "Everyone\'s invited", "All ages welcome", "Bring the whole family" — these do not need to be rewritten into first person.',
    'The venue name may appear in ONLY these three positions: (1) an opening hook where the name reads as an invitation (e.g. "Join us at The Anchor this Sunday"), (2) a location reference where the name is the clearest way to direct someone (e.g. "Find us at The Anchor"), (3) a sign-off or closing tag if a signature is provided.',
    'Never open a body copy sentence with the venue name as the grammatical subject. WRONG: "The Anchor is serving roast beef this Sunday." RIGHT: "We\'re serving roast beef this Sunday."',
    venueName
      ? `The venue is called "${venueName}". Use this name only in the three permitted positions above — never as the subject of a body copy sentence.`
      : "Do not name the venue.",
    "Keep copy warm, human, and helpful.",
    `Tone profile: ${TONE_PROFILE}`,
    "Output only the final caption text. No labels, no quotes, no commentary.",
    "If a price, cost, or specific offer detail is provided, you MUST include it in the final copy.",
    describeToneTargets(brand),
    formatListLine("Do not mention", brand.bannedTopics),
    formatListLine("Avoid these phrases", mergedBannedPhrases(brand.bannedPhrases ?? [])),
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
    input.title?.trim() ? `Title (for context only — do not copy verbatim or use as sentence subject): ${input.title.trim()}` : null,
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
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.facebookSignature),
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
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.instagramSignature),
      ]
        .filter(Boolean)
        .join("\n");
    case "gbp":
      return [
        "Write a concise Google Business Profile update. Keep it under 150 words (hard limit: 900 characters).",
        'Write in first-person plural — "we", "our", "us" — exactly as you would for Facebook or Instagram. GBP copy must also follow the first-person rule.',
        `Include CTA action: ${brand.gbpCta ?? "LEARN_MORE"}.`,
        "Avoid hashtags. Avoid exclamation-heavy hype language. Write as if speaking directly to a local who already knows the pub.",
      ].join("\n");
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
    lines.push(`Campaign timing phase (internal guidance only — never use the word "slot" or this label verbatim in the copy): ${slot}.`);
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
Example 1 (Facebook, Sunday roast event):
Join us for a proper Sunday roast this weekend. We're serving up slow-roasted beef with all the trimmings, including our massive Yorkies. It's the perfect way to gather the family before the week starts again. Book your table now to avoid missing out.

Example 2 (Instagram, sport):
The Six Nations is back on our screens. We'll be showing every match live — grab a pint and settle in for the action. Who are you backing this year?

Example 3 (Facebook, casual midweek):
Looking for the perfect spot for a midweek catch-up? Our burger and pint night is just the ticket. Great food, cold drinks, and even better company. See you at the bar!

Example 4 (GBP, lunch deal):
We're running a two-course lunch deal every weekday — £12.50 per person. Soup, a main from our kitchen, and tea or coffee included. Walk-ins welcome or book ahead for a table.

Grammar rules — strictly follow these:
- "we" is a SUBJECT pronoun: "We're serving...", "We'll be showing..."
- "us" is an OBJECT pronoun: "Join us", "Come to us", "Find us", "See you with us"
- NEVER write "come to we" or "join we" — these are always grammatically wrong
- Third-party subjects about guests are fine: "Kids are welcome", "Bring the whole crew", "All ages welcome"

POV guidance — wrong vs right:
WRONG: "Come to we this Friday for quiz night. The Anchor is hosting a great event. The Anchor welcomes everyone."
RIGHT: "Come to us this Friday for quiz night. We're hosting a great night — everyone's welcome, bring the whole crew."
`.trim();
}
