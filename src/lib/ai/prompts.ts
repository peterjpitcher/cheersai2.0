import { DateTime } from "luxon";

import { buildTemporalInstructions } from "@/lib/ai/temporal-instructions";
import { BANNED_PHRASES, PREFERRED_PHRASES, TONE_PROFILE, type BrandVoiceConfig, buildVoiceInstructions } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";
import type { BrandProfile } from "@/lib/settings/data";
import { formatFriendlyTimeFromZoned } from "@/lib/utils/date";

import type { ContentType } from "@/types/content";
import type { ContentBrief } from "@/features/create/schemas/content-schemas";

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
    "Write plain text only — no markdown formatting (no **bold**, *italics*, # headings or backticks). Platforms display these symbols literally.",
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

  const pillarNudge =
    typeof context?.pillarNudge === "string" ? context.pillarNudge.trim() : null;

  const sections: string[] = [
    input.title?.trim() ? `Title (for context only — do not copy verbatim or use as sentence subject): ${input.title.trim()}` : null,
    input.prompt?.trim() ? `Request: ${input.prompt.trim()}` : null,
    brandLines.length ? `Brand voice:\n${brandLines.join("\n")}` : null,
    buildMediaLine(input),
    buildContextBlock({ scheduledFor, context }),
    pillarNudge ? `Content angle advisory:\n${pillarNudge}` : null,
    `Platform guidance:\n${buildPlatformGuidance(platform, brand, input, { venueName, context })}`,
    `Adjustments:\n${describeAdjustments(platform, input, context)}`,
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
  options?: { venueName?: string; context?: Record<string, unknown> },
) {
  switch (platform) {
    case "facebook":
      return [
        "Keep it concise, but feel free to write up to 120 words if the story needs it.",
        input.includeHashtags
          ? "Include a CTA and 2-3 relevant hashtags if it feels natural."
          : "Include a CTA and keep copy hashtag-free.",
        "Where natural, close with a question or opinion prompt that invites comments (e.g., 'What's your order?', 'Who's joining us?'). Facebook rewards posts that generate replies.",
        "Write as if talking to a regular — conversational, not announcement-style.",
        formatOptionalLine("Append this exact signature verbatim at the end if it fits naturally (do not rephrase it)", brand.facebookSignature),
      ]
        .filter(Boolean)
        .join("\n");
    case "instagram": {
      const hasLink = Boolean(input.linkInBioUrl || input.ctaUrl);
      return [
        "The first line must stop the scroll. Front-load the hook — only the first 125 characters show before 'more'.",
        "Aim for 60-80 words with line breaks.",
        "Use line breaks to create scannable structure. One thought per line.",
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
    }
    case "gbp": {
      const lines = [
        "Write a concise Google Business Profile update. Keep it under 150 words (hard limit: 900 characters).",
        'Write in first-person plural — "we", "our", "us" — exactly as you would for Facebook or Instagram. GBP copy must also follow the first-person rule.',
        `Include CTA action: ${brand.gbpCta ?? "LEARN_MORE"}.`,
        "Avoid hashtags. Avoid exclamation-heavy hype language. Write as if speaking directly to a local who already knows the pub.",
        "Write for someone searching Google for a local pub. Include natural local keywords (e.g., the town name, 'pub near [area]').",
        "Lead with the most important fact — what, when, and how to act. No preamble.",
      ];

      const venueName = options?.venueName;
      const venueLocationValue =
        typeof options?.context?.venueLocation === "string"
          ? options.context.venueLocation.trim()
          : null;

      if (venueName) {
        lines.push(`Venue name: <venue_name>${venueName}</venue_name>`);
      }
      if (venueLocationValue) {
        lines.push(`Venue location: <venue_location>${venueLocationValue}</venue_location>`);
      }

      return lines.join("\n");
    }
    default:
      return "";
  }
}

function describeAdjustments(
  platform: "facebook" | "instagram" | "gbp",
  input: InstantPostInput,
  context?: Record<string, unknown>,
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

  // Hook instruction from Copy Intelligence service
  const hookStrategy = extractContextString(context, "hookStrategy");
  if (hookStrategy) {
    const hookInstruction = extractContextString(context, "hookInstruction");
    if (hookInstruction) {
      lines.push(`Hook style: ${hookInstruction}`);
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
  const promotionDateMode = extractContextString(context, "promotionDateMode");
  if (promotionEnd && promotionDateMode === "ends_on") {
    lines.push(`Promotion ends ${formatDate(promotionEnd)}.`);
  } else if (promotionStart && promotionEnd) {
    lines.push(`Promotion runs ${formatDate(promotionStart)} to ${formatDate(promotionEnd)}.`);
  } else if (promotionEnd) {
    lines.push(`Promotion ends ${formatDate(promotionEnd)}.`);
  }

  const toneCue = extractContextString(context, "temporalProximity");
  if (toneCue) {
    lines.push(`Timing tone: ${toneCue}`);
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
  return `${zoned.setLocale("en-GB").toFormat("cccc d LLLL")} at ${formatFriendlyTimeFromZoned(zoned)}`;
}

function formatDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc d LLLL");
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

// ---------------------------------------------------------------------------
// v2 prompt builders (multi-platform structured output generation)
// ---------------------------------------------------------------------------

const CONTENT_TYPE_CONTEXT: Record<ContentType, string> = {
  instant_post: 'This is a standard social media post. Write engaging copy for each platform.',
  story: 'This is for Stories (short, visual-first). Captions must be 125 characters max. Prioritise visual hooks.',
  event: 'This is an event promotion. Build excitement, include event details (name, date, time, venue). Drive attendance.',
  promotion: 'This is a promotional offer. Include offer details, create urgency. Include coupon code if provided.',
  weekly_recurring: 'This is evergreen content for weekly recurring use. Keep it fresh enough to repeat without feeling stale.',
};

const PLATFORM_RULES = [
  'Facebook: up to 300 words, 2-5 hashtags. Include a CTA. Conversational tone.',
  'Instagram: up to 150 words, up to 10 hashtags. First line must hook (125 chars visible). Use line breaks.',
  'GBP: up to 750 words. No hashtags. Lead with the most important fact. Include CTA action.',
].join('\n');

// House style for pub social copy — keeps copy warm, local and plain-speaking,
// and counteracts any "premium/sophisticated" pull from a mis-set tone.
const PUB_WRITING_RULES = [
  'Keep sentences short and easy to read.',
  "Lead with why it'll be a good time — the fun, the atmosphere, the reason to come.",
  'Include the key details clearly: what it is, the date, the time, the price if relevant, and how to book or join.',
  'Sound like a real person talking to a regular — warm, local and plain-speaking.',
  'Do not be posh, corporate or salesy. Avoid words like premium, elevated, curated, sophisticated, exclusive and "hidden gem".',
  'Do not over-explain or pad the copy.',
].join('\n');

/**
 * Build the system prompt for multi-platform AI generation (v2).
 *
 * @param contentType - One of the 5 content types
 * @param tone - Tone profile key (e.g. 'friendly_warm')
 * @param brandVoice - Optional brand voice config from user profile
 */
export function buildSystemPrompt(
  contentType: ContentType,
  tone: string,
  brandVoice?: BrandVoiceConfig,
  brand?: BrandProfile,
): string {
  const lines: string[] = [
    'You are CheersAI, an expert hospitality social media copywriter.',
    'Generate platform-specific copy for Facebook, Instagram, and Google Business Profile from a single brief.',
    'Use British English throughout.',
    'Write in first-person plural ("we", "our", "us"). Never use "we" in object position.',
    'Write plain text only. Do not use markdown formatting — no **bold**, *italics*, _underscores_, # headings or backticks. Social platforms display these symbols literally.',
    'Use short paragraphs separated by line breaks so the copy is easy to scan. Avoid one solid block of text.',
    '',
    `Content type: ${contentType}`,
    CONTENT_TYPE_CONTEXT[contentType] ?? CONTENT_TYPE_CONTEXT.instant_post,
    '',
    'Platform rules:',
    PLATFORM_RULES,
  ];

  // Add voice instructions
  if (brandVoice) {
    lines.push('', 'Brand voice:', buildVoiceInstructions(brandVoice));
  } else {
    const voiceConfig: BrandVoiceConfig = {
      tone,
      style: null,
      defaultCta: null,
      platformSignatures: {},
    };
    lines.push('', 'Tone:', buildVoiceInstructions(voiceConfig));
  }

  lines.push('', 'Writing rules:', PUB_WRITING_RULES);

  // Brand-specific voice configured in Settings → Brand Voice
  if (brand) {
    const brandLines = [
      describeToneTargets(brand),
      formatListLine('Use natural phrases like', brand.keyPhrases),
      formatListLine('Do not mention', brand.bannedTopics),
      formatListLine('Never use these phrases', brand.bannedPhrases),
    ].filter(isNonEmptyString);
    if (brandLines.length) {
      lines.push('', 'Brand specifics:', ...brandLines);
    }
  }

  lines.push('', 'Examples of the right style:', getFewShotExamples());

  lines.push(
    '',
    'Output JSON matching the schema exactly. Do not include any commentary.',
  );

  return lines.join('\n');
}

/**
 * Build the user prompt from a content brief (v2).
 *
 * @param brief - The content brief from the creation wizard
 * @param modifier - Optional regeneration modifier (AI-03)
 * @param context - Optional media + schedule context from the create wizard
 */
export function buildUserPrompt(
  brief: ContentBrief,
  modifier?: string,
  context?: {
    scheduledAt?: string | null;
    eventStart?: string;
    promotionStart?: string;
    promotionEnd?: string;
    promotionDateMode?: 'range' | 'ends_on';
    temporalProximity?: string;
    timingLabel?: string;
    temporalInstruction?: string;
    proximityLabel?: string | null;
    media?: Array<{
      id: string;
      fileName: string;
      mediaType: 'image' | 'video';
      tags: string[];
      aspectClass?: 'square' | 'story' | 'landscape';
    }>;
    slotLabel?: string; // e.g. "Event day", "2 weeks out", "Launch", "Week 3"
  },
): string {
  const sections: string[] = [];

  sections.push(`Title: ${brief.title}`);

  if (brief.prompt) {
    sections.push(`Description: ${brief.prompt}`);
  }

  sections.push(`Platforms: ${brief.platforms.join(', ')}`);
  sections.push(`Tone: ${brief.tone}`);
  sections.push(`Length preference: ${brief.lengthPreference}`);

  if (brief.ctaStyle !== 'default') {
    sections.push(`CTA style: ${brief.ctaStyle}`);
  }

  if (brief.proofPoints.length) {
    sections.push(`Proof points to incorporate: ${brief.proofPoints.join('; ')}`);
  }

  if (brief.includeHashtags) {
    sections.push('Include relevant hashtags per platform.');
  } else {
    sections.push('Do not include hashtags.');
  }

  if (!brief.includeEmojis) {
    sections.push('Avoid emojis entirely.');
  }

  // Content-type-specific fields
  if (brief.contentType === 'event') {
    sections.push(`Event name: ${brief.eventName}`);
    sections.push(`Event date: ${brief.eventDate}`);
    sections.push(`Event time: ${brief.eventTime}`);
    if (brief.venue) sections.push(`Venue: ${brief.venue}`);
    if (brief.eventEndDate) sections.push(`Event end date: ${brief.eventEndDate}`);
  }

  if (brief.contentType === 'promotion') {
    sections.push(`Offer: ${brief.offerSummary}`);
    sections.push(`Offer ends: ${brief.endDate}`);
    if (brief.couponCode) sections.push(`Coupon code: ${brief.couponCode}`);
    if (brief.startDate) sections.push(`Offer starts: ${brief.startDate}`);
  }

  if (brief.contentType === 'weekly_recurring') {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    sections.push(`Day of week: ${dayNames[brief.dayOfWeek] ?? brief.dayOfWeek}`);
    sections.push(`Time: ${brief.time}`);
  }

  // Schedule context — prefer context.scheduledAt over brief.scheduledFor to avoid duplicates
  const scheduleIso = context?.scheduledAt ?? (brief.contentType === 'instant_post' ? brief.scheduledFor : null);
  if (scheduleIso) {
    const scheduleDt = DateTime.fromISO(scheduleIso, { zone: DEFAULT_TIMEZONE });
    if (scheduleDt.isValid) {
      sections.push(
        `Post scheduled for ${scheduleDt.setLocale('en-GB').toFormat("cccc d LLLL 'at' h:mma")} (${DEFAULT_TIMEZONE}).`
      );
    }
  }

  if (context?.eventStart) {
    const eventStart = DateTime.fromISO(context.eventStart, { zone: DEFAULT_TIMEZONE });
    if (eventStart.isValid) {
      sections.push(
        `Event starts ${eventStart.setLocale('en-GB').toFormat("cccc d LLLL 'at' h:mma")} (${DEFAULT_TIMEZONE}).`
      );
    }
  }

  if (context?.promotionStart || context?.promotionEnd) {
    const parts: string[] = [];
    const start = context.promotionStart
      ? DateTime.fromISO(context.promotionStart, { zone: DEFAULT_TIMEZONE })
      : null;
    const end = context.promotionEnd
      ? DateTime.fromISO(context.promotionEnd, { zone: DEFAULT_TIMEZONE })
      : null;
    if (start?.isValid) {
      parts.push(`starts ${start.setLocale('en-GB').toFormat('cccc d LLLL')}`);
    }
    if (end?.isValid) {
      parts.push(`ends ${end.setLocale('en-GB').toFormat('cccc d LLLL')}`);
    }
    if (parts.length) {
      sections.push(`Promotion timing: ${parts.join(', ')}.`);
    }
  }

  if (context?.temporalProximity) {
    sections.push(`Timing tone: ${context.temporalProximity}.`);
  }

  if (context?.timingLabel) {
    sections.push(`Timing label: ${context.timingLabel}.`);
  }

  if (context?.proximityLabel) {
    sections.push(`Overlay label: ${context.proximityLabel}. Match the copy's relative date wording to this label when natural.`);
  }

  if (context?.temporalInstruction) {
    sections.push(`Relative date wording: ${context.temporalInstruction}`);
  }

  // Temporal framing — gives the AI label-specific narrative context for multi-date schedules
  if (context?.slotLabel) {
    const temporal = buildTemporalInstructions(context.slotLabel);
    if (temporal) {
      sections.push(temporal);
    }
  }

  // Media metadata from the create wizard (selected before generation)
  if (context?.media?.length) {
    const mediaLines = context.media.map((m, i) => {
      const parts = [`${i + 1}. ${m.mediaType === 'video' ? 'Video' : 'Image'}: ${m.fileName}`];
      if (m.tags.length) parts.push(`tags: ${m.tags.join(', ')}`);
      if (m.aspectClass) parts.push(`format: ${m.aspectClass}`);
      return parts.join(' — ');
    });
    sections.push(
      `Attached media (${context.media.length} item${context.media.length === 1 ? '' : 's'}):\n${mediaLines.join('\n')}\nUse media metadata only when it is explicit; do not invent visual details that are not present in the filename or tags.`
    );
  }

  // AI-03: Append regeneration modifier
  if (modifier) {
    sections.push(`\nAdditional instruction: ${modifier}`);
  }

  return sections.join('\n');
}
