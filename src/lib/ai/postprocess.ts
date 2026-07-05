import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { collapseWhitespacePreservingBreaks, stripMarkdown } from "@/lib/utils/markdown";
import { stripDirectLinks, stripDirectLinkSentences } from "@/lib/utils/social-links";
import {
  cleanCopyArtifacts,
  normalizeHashtags,
  sanitizeCtaText,
  sanitizePublishBody,
} from "@/lib/publishing/copy-rules";
import type { InstantPostInput } from "@/lib/create/schema";
import type { Platform as PublishingPlatform, PlatformCtaLinks } from "@/types/content";

import type { AiGenerationResponse } from "./schemas";

export type Platform = InstantPostInput["platforms"][number];

interface PostProcessOptions {
  body: string;
  platform: Platform;
  input: InstantPostInput;
  scheduledFor?: Date | null;
  context?: Record<string, unknown>;
  bannedTopics?: string[];
  bannedPhrases?: string[];
}

const AM_PM_CASE = /\b(\d{1,2})(?::(\d{2}))?\s?(AM|PM)\b/g;
const ON_THE_HOUR = /\b(\d{1,2}):00\s?(am|pm)\b/gi;
const COUNTDOWN_PATTERNS: RegExp[] = [
  /\bjust\s+(?:one|1|a)\s+week(?:\s+left)?\b/gi,
  /\bonly\s+(?:one|1|a)\s+week(?:\s+left)?\b/gi,
  /\blast\s+few\s+days\b/gi,
  /\b(hurry|rush)\b[^.]*\b(ends|over)\b/gi,
  /\blast\s+chance\b/gi,
  /\bending\s+soon\b/gi,
];

// Newline-safe: only matches spaces/tabs before punctuation, never newlines,
// so paragraph breaks are preserved.
const SPACE_BEFORE_PUNCT = /[^\S\r\n]+([,.;!?])/g;
const LINK_IN_BIO_LANGUAGE_PATTERN = /\b(?:link[-\s]in[-\s](?:our\s+|the\s+)?bio|details? in (?:our\s+|the\s+)?bio)\b/i;
const BOOKING_INTENT_PATTERN = /\b(book|booking|bookings|reserve|reservation|table|tickets?|seats?|spots?)\b/i;
// A standalone imperative booking CTA line, e.g. "Book now!", "Reserve your
// table!", "Book ASAP". Restricted to the unambiguous booking verbs book/reserve
// (not grab/get/claim, which collide with narrative like "Get comfy and grab a
// seat"). Ends on a booking object/timing word, tolerating trailing emoji.
const BARE_BOOKING_CTA_LINE =
  /^(?:book|reserve)\b[^.\n!?]{0,40}?\b(?:now|today|tonight|table|tables|tickets?|seats?|spots?|places?|online|early|ahead|soon|asap)\b[\s!.…️\p{Extended_Pictographic}]*$/iu;

function normaliseTimes(value: string): string {
  let output = value.replace(AM_PM_CASE, (_, hour: string, mins: string | undefined, suffix: string) => {
    const lowered = suffix.toLowerCase();
    if (!mins || mins === "00") {
      return `${hour}${lowered}`;
    }
    return `${hour}:${mins}${lowered}`;
  });
  output = output.replace(ON_THE_HOUR, (_, hour: string, suffix: string) => `${hour}${suffix}`);
  return output;
}

function normaliseWhitespace(value: string): string {
  return collapseWhitespacePreservingBreaks(value.replace(SPACE_BEFORE_PUNCT, "$1"));
}

function parseIsoDate(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCountdownDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB").toFormat("cccc d LLLL");
}

function sanitiseCountdownLanguage(
  value: string,
  scheduledFor: Date | null | undefined,
  promotionEnd: Date | null | undefined,
) {
  if (!promotionEnd) return value;
  const scheduled = scheduledFor ?? null;
  if (!scheduled) return value;

  const diffMs = promotionEnd.getTime() - scheduled.getTime();
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (Number.isNaN(diffDays) || diffDays <= 3) {
    return value;
  }

  let updated = value;
  let matched = false;
  for (const pattern of COUNTDOWN_PATTERNS) {
    if (pattern.test(updated)) {
      matched = true;
      updated = updated.replace(pattern, "");
    }
    pattern.lastIndex = 0;
  }

  if (!matched) return updated;

  const guidance = `It ends on ${formatCountdownDate(promotionEnd)}.`;
  if (!updated.toLowerCase().includes(guidance.toLowerCase())) {
    updated = `${updated.trim()} ${guidance}`.trim();
  }

  return updated.replace(/[^\S\r\n]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
}

function ensureLinkInBioOnce(value: string) {
  const phrase = "See the link in our bio for details.";
  const occurrences =
    value.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))?.length ?? 0;
  if (occurrences <= 1) return value;
  let seen = 0;
  return value.replace(new RegExp(phrase, "gi"), () => {
    seen += 1;
    return seen === 1 ? phrase : "";
  });
}

export function postProcessGeneratedCopy({
  body,
  platform,
  input,
  scheduledFor,
  context,
  bannedTopics,
  bannedPhrases,
}: PostProcessOptions): string {
  let output = body.trim();
  output = stripMarkdown(output);
  output = normaliseWhitespace(output);
  output = normaliseTimes(output);

  if (bannedTopics?.length) {
    output = scrubBannedTopics(output, bannedTopics);
  }

  if (bannedPhrases?.length) {
    output = scrubBannedTopics(output, bannedPhrases);
  }

  const promotionEnd = parseIsoDate(context?.promotionEnd);
  if (promotionEnd) {
    output = sanitiseCountdownLanguage(output, scheduledFor, promotionEnd);
  }

  if (platform === "instagram") {
    output = ensureLinkInBioOnce(output);
  }

  if (!input.includeHashtags && platform !== "instagram") {
    output = output.replace(/#[\p{L}\w]+/gu, "").replace(/\n{3,}/g, "\n\n");
  }

  return normaliseWhitespace(output);
}

function scrubBannedTopics(value: string, topics: string[]) {
  const normalizedTopics = topics.map((topic) => topic.trim()).filter(Boolean);
  if (!normalizedTopics.length) return value;
  let output = value;
  for (const topic of normalizedTopics) {
    const pattern = buildBannedTopicPattern(topic);
    if (!pattern) continue;
    output = output.replace(pattern, "");
  }
  return output.replace(/[^\S\r\n]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBannedTopicPattern(topic: string) {
  const escaped = escapeRegExp(topic);
  if (!escaped.length) return null;
  if (/\s/.test(topic)) {
    return new RegExp(escaped, "gi");
  }
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

// ---------------------------------------------------------------------------
// Multi-platform postprocess pipeline (v2 AI generation)
// ---------------------------------------------------------------------------

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

export interface PostprocessConfig {
  maxHashtags: Record<string, number>;
  maxEmojis: Record<string, number>;
  maxWords: Record<string, number>;
  bannedPhrases: readonly string[];
  platformSignatures: Record<string, string>;
  defaultCta: string | null;
  ctaLinks?: PlatformCtaLinks | null;
}

export interface PostprocessResult {
  copy: AiGenerationResponse;
  warnings: string[];
}

/**
 * Multi-platform post-processing pipeline for AI-generated copy (AI-06).
 *
 * Strips banned phrases, clamps hashtags/emojis/word counts, and appends
 * platform signatures.
 */
export function postprocessCopy(
  raw: AiGenerationResponse,
  config: PostprocessConfig,
): PostprocessResult {
  const warnings: string[] = [];

  const facebookBody = processPlatformBody(
    raw.facebook.body,
    'facebook',
    config,
  );
  const facebookCtaText = sanitizeCtaText(raw.facebook.cta_text);
  // Only strip a bare booking CTA from the body when a replacement CTA will
  // actually be appended at compose time (a cta_text, or a Facebook CTA link).
  // Otherwise the body's CTA is the only one and must be preserved.
  const willAppendFacebookCta = Boolean(facebookCtaText) || Boolean(config.ctaLinks?.facebook?.trim());
  const facebook = willAppendFacebookCta ? stripBareBookingCtaLines(facebookBody) : facebookBody;
  const instagram = processPlatformBody(
    raw.instagram.body,
    'instagram',
    config,
  );

  const hasInstagramLink = Boolean(config.ctaLinks?.instagram?.trim());
  let instagramLinkInBioLine = sanitiseInstagramLinkInBioLine(
    raw.instagram.link_in_bio_line,
    hasInstagramLink,
  );
  const instagramSanitised = sanitiseInstagramBody(
    instagram,
    Boolean(instagramLinkInBioLine),
  );

  if (instagramSanitised.removedDirectLink && hasInstagramLink && !instagramLinkInBioLine) {
    instagramLinkInBioLine = defaultInstagramLinkInBioLine(raw.instagram.body);
  }

  // Clamp and normalise hashtags per platform. The publish composer owns final
  // hashtag placement, so body hashtag blocks are removed separately.
  const fbHashtags = normalizeHashtags(raw.facebook.hashtags, 'facebook', config.maxHashtags['facebook'] ?? 5) ?? [];
  const igHashtags = normalizeHashtags(raw.instagram.hashtags, 'instagram', config.maxHashtags['instagram'] ?? 10) ?? [];

  return {
    copy: {
      facebook: {
        body: facebook,
        cta_text: facebookCtaText,
        hashtags: fbHashtags,
      },
      instagram: {
        body: instagramSanitised.body,
        hashtags: igHashtags,
        link_in_bio_line: instagramLinkInBioLine,
      },
    },
    warnings,
  };
}

/**
 * Process a single platform body: strip banned phrases, clamp emojis,
 * enforce word limit, and append signature.
 */
function processPlatformBody(
  body: string,
  platform: string,
  config: PostprocessConfig,
): string {
  // Strip markdown the platforms would otherwise render literally (e.g. **bold**)
  let output = stripMarkdown(body);

  // Strip banned phrases (case-insensitive)
  for (const phrase of config.bannedPhrases) {
    if (!phrase.trim()) continue;
    const escaped = escapeRegExp(phrase);
    const pattern = new RegExp(escaped, 'gi');
    output = output.replace(pattern, '');
  }

  // Collapse stray spaces from removals while preserving paragraph breaks
  output = collapseWhitespacePreservingBreaks(output);

  // Clamp emoji count
  const maxEmojis = config.maxEmojis[platform] ?? 3;
  output = clampEmojis(output, maxEmojis);

  // Enforce word limit (truncate at sentence boundary)
  const maxWords = config.maxWords[platform];
  if (maxWords) {
    output = truncateAtSentenceBoundary(output, maxWords);
  }

  // Append platform signature if provided
  const signature = config.platformSignatures[platform];
  if (signature) {
    output = `${output}\n${signature}`;
  }

  return sanitizePublishBody(platform as PublishingPlatform, output);
}

/**
 * Remove a standalone bare booking CTA line (e.g. "Book now!") from a Facebook
 * body. The publish composer appends the canonical linked CTA ("Book now:
 * {url}") from the cta_text field, so a bare CTA in the body is a duplicate.
 * Only short (<=6 word) standalone imperative lines are removed; narrative
 * sentences that merely mention booking are preserved.
 */
function stripBareBookingCtaLines(body: string): string {
  const kept = body.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blanks; collapsed below
    if (trimmed.split(/\s+/).length > 6) return true; // too long to be a bare CTA
    return !BARE_BOOKING_CTA_LINE.test(trimmed);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitiseInstagramBody(
  body: string,
  hasSeparateLinkInBioLine: boolean,
): { body: string; removedDirectLink: boolean } {
  const withoutDirectLinks = stripDirectLinkSentences(body);
  const removedDirectLink = withoutDirectLinks !== body;
  let output = withoutDirectLinks;

  if (hasSeparateLinkInBioLine) {
    output = stripLinkInBioSentences(output);
  }

  return {
    body: cleanCopyArtifacts(output),
    removedDirectLink,
  };
}

function sanitiseInstagramLinkInBioLine(value: string | null, hasInstagramLink: boolean): string | null {
  if (!hasInstagramLink) return null;

  const cleaned = stripDirectLinks(stripMarkdown(value ?? ""));
  if (!cleaned) return null;
  if (!LINK_IN_BIO_LANGUAGE_PATTERN.test(cleaned)) {
    return defaultInstagramLinkInBioLine(value ?? "");
  }

  return cleaned;
}

function defaultInstagramLinkInBioLine(source: string): string {
  return BOOKING_INTENT_PATTERN.test(source)
    ? "Link in bio to book."
    : "Details in bio.";
}

function stripLinkInBioSentences(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      if (!LINK_IN_BIO_LANGUAGE_PATTERN.test(line)) return line;
      const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length <= 1) return "";
      return sentences
        .filter((sentence) => !LINK_IN_BIO_LANGUAGE_PATTERN.test(sentence))
        .join(" ");
    })
    .join("\n");
}

/** Clamp emoji count by removing excess emojis from end. */
function clampEmojis(value: string, max: number): string {
  const emojis = value.match(EMOJI_REGEX);
  if (!emojis || emojis.length <= max) return value;

  let count = 0;
  return value.replace(EMOJI_REGEX, (match) => {
    count += 1;
    return count <= max ? match : '';
  });
}

/** Truncate text at sentence boundary nearest to word limit. */
function truncateAtSentenceBoundary(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;

  // Take words up to limit
  const truncated = words.slice(0, maxWords).join(' ');

  // Try to find a sentence boundary
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );

  if (lastSentenceEnd > truncated.length * 0.5) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  // No good sentence boundary -- just truncate at word limit and add period
  const result = truncated.trim();
  if (/[.!?]$/.test(result)) return result;
  return `${result}.`;
}
