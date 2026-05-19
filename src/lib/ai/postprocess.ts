import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { InstantPostInput } from "@/lib/create/schema";

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

const WHITESPACE = /[ \t]+/g;
const MULTI_NEWLINE = /\n{3,}/g;
const TRAILING_SPACE = /[ \t]+\n/g;
const SPACE_BEFORE_PUNCT = /\s+([,.;!?])/g;
const MULTI_SPACE = /\s{2,}/g;

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
  return value
    .replace(WHITESPACE, " ")
    .replace(MULTI_NEWLINE, "\n\n")
    .replace(TRAILING_SPACE, "\n")
    .replace(SPACE_BEFORE_PUNCT, "$1")
    .replace(MULTI_SPACE, " ")
    .replace(/[ \t]+\./g, ".")
    .replace(/\s+\n/g, "\n")
    .trim();
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

  return updated.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
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
  return output.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
}

export interface PostprocessResult {
  copy: AiGenerationResponse;
  warnings: string[];
}

/**
 * Multi-platform post-processing pipeline for AI-generated copy (AI-06).
 *
 * Strips banned phrases, clamps hashtags/emojis/word counts, appends
 * platform signatures, and warns about missing GBP CTAs (AI-08).
 */
export function postprocessCopy(
  raw: AiGenerationResponse,
  config: PostprocessConfig,
): PostprocessResult {
  const warnings: string[] = [];

  const facebook = processPlatformBody(
    raw.facebook.body,
    'facebook',
    config,
  );
  const instagram = processPlatformBody(
    raw.instagram.body,
    'instagram',
    config,
  );
  const gbp = processPlatformBody(raw.gbp.body, 'gbp', config);

  // Clamp hashtags per platform
  const fbHashtags = clampArray(raw.facebook.hashtags, config.maxHashtags['facebook'] ?? 5);
  const igHashtags = clampArray(raw.instagram.hashtags, config.maxHashtags['instagram'] ?? 10);

  // AI-08: Warn when GBP CTA is null and no brand default
  if (!raw.gbp.cta_action && !config.defaultCta) {
    warnings.push(
      'GBP post has no call-to-action. Consider adding one for better engagement.',
    );
  }

  return {
    copy: {
      facebook: {
        body: facebook,
        cta_text: raw.facebook.cta_text,
        hashtags: fbHashtags,
      },
      instagram: {
        body: instagram,
        hashtags: igHashtags,
        link_in_bio_line: raw.instagram.link_in_bio_line,
      },
      gbp: {
        body: gbp,
        cta_action: raw.gbp.cta_action,
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
  let output = body;

  // Strip banned phrases (case-insensitive)
  for (const phrase of config.bannedPhrases) {
    if (!phrase.trim()) continue;
    const escaped = escapeRegExp(phrase);
    const pattern = new RegExp(escaped, 'gi');
    output = output.replace(pattern, '');
  }

  // Clean up double spaces from removals
  output = output.replace(/\s{2,}/g, ' ').trim();

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

  return output.trim();
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

/** Clamp an array to a maximum length, preserving null. */
function clampArray(
  arr: string[] | null,
  max: number,
): string[] | null {
  if (!arr) return arr;
  return arr.slice(0, max);
}
