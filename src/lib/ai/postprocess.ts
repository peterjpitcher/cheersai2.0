import { DateTime } from "luxon";

import { scrubBannedPhrases } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { formatEventDateLong } from "@/lib/utils/date";
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
  /^(?:book|reserve)\b[^.\n!?]{0,40}?\b(?:now|today|tonight|table|tables|tickets?|seats?|spots?|places?|online|early|ahead|soon|asap)\b[\s!.…️‍⃣\p{Emoji_Modifier}\p{Extended_Pictographic}]*$/iu;

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

const CURLY_APOSTROPHES = /[‘’]/g;

function normaliseApostrophes(value: string): string {
  return value.replace(CURLY_APOSTROPHES, "'");
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Remove whole sentences matched by `shouldRemove`, line by line. If a line
 * matches but none of its individual sentences do (the match spans a sentence
 * boundary), the whole line is dropped.
 */
export function removeSentencesMatching(
  value: string,
  shouldRemove: (text: string) => boolean,
): { value: string; removed: boolean } {
  let removed = false;
  const lines = value.split("\n").map((line) => {
    if (!line.trim() || !shouldRemove(line)) return line;
    const sentences = line.split(SENTENCE_BOUNDARY).filter(Boolean);
    const kept = sentences.filter((sentence) => !shouldRemove(sentence));
    if (kept.length === sentences.length) {
      removed = true;
      return "";
    }
    removed = true;
    return kept.join(" ").trim();
  });
  return { value: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/**
 * Remove whole sentences containing a banned phrase or topic. Deleting just
 * the phrase leaves broken grammar ("Bring your friends and family for. Book
 * now!"), so the containing sentence goes instead. Matching is
 * apostrophe-insensitive (curly vs straight). If sentence removal would empty
 * the copy entirely, falls back to phrase-only deletion so something usable
 * survives.
 */
export function removeBannedPhraseSentences(value: string, phrases: readonly string[]): string {
  const patterns = phrases
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .map((phrase) => buildBannedTopicPattern(normaliseApostrophes(phrase)))
    .filter((pattern): pattern is RegExp => Boolean(pattern));
  if (!patterns.length) return value;

  const matchesAny = (text: string) => {
    const haystack = normaliseApostrophes(text);
    return patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(haystack);
    });
  };

  if (!matchesAny(value)) return value;
  const result = removeSentencesMatching(value, matchesAny);
  if (result.value.length) return result.value;
  return cleanCopyArtifacts(scrubBannedTopics(value, [...phrases]));
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

  // Drop whole sentences with premature countdown language — deleting only the
  // phrase left fragments like " to book!" behind.
  const removal = removeSentencesMatching(value, (text) =>
    COUNTDOWN_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    }),
  );

  if (!removal.removed) return value;
  let updated = removal.value;

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
    output = removeBannedPhraseSentences(output, bannedTopics);
  }

  if (bannedPhrases?.length) {
    output = removeBannedPhraseSentences(output, bannedPhrases);
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

// Collapse apostrophe variants to a class so a phrase stored with a straight
// apostrophe ("you won't regret it") still matches the model's curly output
// ("you won’t regret it") and vice-versa — used everywhere banned phrases are
// matched, including the empty-body fallback in removeBannedPhraseSentences.
const APOSTROPHE_CLASS = "['‘’]";

function buildBannedTopicPattern(topic: string) {
  const escaped = escapeRegExp(topic).replace(/['‘’]/g, APOSTROPHE_CLASS);
  if (!escaped.length) return null;
  if (/\s/.test(topic)) {
    return new RegExp(escaped, "gi");
  }
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

// ---------------------------------------------------------------------------
// Multi-platform postprocess pipeline (v2 AI generation)
// ---------------------------------------------------------------------------

// Matches a full emoji sequence (base pictograph + skin-tone modifiers,
// variation selectors, and ZWJ-joined continuations) so clamping counts and
// removes whole emoji — never leaving orphaned joiners or half a family emoji.
const EMOJI_REGEX =
  /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u20E3)*(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)*)*/gu;

export interface PostprocessConfig {
  maxHashtags: Record<string, number>;
  maxEmojis: Record<string, number>;
  maxWords: Record<string, number>;
  bannedPhrases: readonly string[];
  platformSignatures: Record<string, string>;
  defaultCta: string | null;
  ctaLinks?: PlatformCtaLinks | null;
  /** Event start ISO (when present, event-date phrasing is normalised in the body). */
  eventStartIso?: string | null;
}

/**
 * Deterministically normalise how the event date is written in body copy so the
 * output does not depend on the model following instructions. Rewrites relative
 * ("this/next Friday"), abbreviated ("FRI 17 JUL"), and non-ordinal ("Friday 17
 * July") references to the event's own weekday/date into the canonical absolute
 * form, e.g. "Friday 17th July". Only the event's weekday is targeted, so
 * unrelated mentions ("every Friday") are left untouched.
 */
function normaliseEventDatePhrasing(body: string, eventStartIso: string): string {
  const dt = DateTime.fromISO(eventStartIso, { zone: DEFAULT_TIMEZONE }).setLocale("en-GB");
  if (!dt.isValid) return body;

  const weekdayLong = dt.toFormat("cccc");
  const weekdayShort = weekdayLong.slice(0, 3);
  const monthLong = dt.toFormat("LLLL");
  const monthShort = monthLong.slice(0, 3);
  const absolute = formatEventDateLong(dt);

  const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const weekday = `(?:${esc(weekdayLong)}|${esc(weekdayShort)})`;
  const month = `(?:${esc(monthLong)}|${esc(monthShort)})`;
  const dayNum = `${dt.day}(?:st|nd|rd|th)?`;

  // Rule 1: a relative qualifier + the event weekday (optionally trailed by the
  // date itself) collapses to the absolute date — catches "this Friday",
  // "Next Friday, 17th July", and the "this FRI 17 JUL" overlay-label leak.
  let out = body.replace(
    new RegExp(`\\b(?:this|next)\\s+${weekday}\\b(?:[.,\\s]+${dayNum}\\s+${month})?`, "gi"),
    absolute,
  );

  // Rule 2: an abbreviated or non-ordinal event date normalises to the ordinal
  // absolute form — catches "Friday 17 July" and a bare "FRI 17 JUL". Idempotent
  // on an already-correct "Friday 17th July".
  out = out.replace(new RegExp(`\\b${weekday}\\s+${dayNum}\\s+${month}\\b`, "gi"), absolute);

  return out;
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

  // Whether the publish composer will append a canonical CTA for each platform.
  // When it will, any bare "Book now!" in the body is a duplicate — stripped
  // inside processPlatformBody BEFORE the signature, so a trailing signature
  // line can't hide the CTA from the trailing-sentence strip. Facebook keys off
  // a cta_text or a Facebook link; Instagram keys off a configured link (the
  // composer always adds a link-in-bio line when one is set).
  const facebookCtaText = sanitizeCtaText(raw.facebook.cta_text);
  const willAppendFacebookCta = Boolean(facebookCtaText) || Boolean(config.ctaLinks?.facebook?.trim());
  const hasInstagramLink = Boolean(config.ctaLinks?.instagram?.trim());

  const facebook = processPlatformBody(raw.facebook.body, 'facebook', config, willAppendFacebookCta);
  const instagram = processPlatformBody(raw.instagram.body, 'instagram', config, hasInstagramLink);

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

  const instagramBody = instagramSanitised.body;

  // Clamp and normalise hashtags per platform. The publish composer owns final
  // hashtag placement, so body hashtag blocks are removed separately.
  const fbHashtags = normalizeHashtags(raw.facebook.hashtags, 'facebook', config.maxHashtags['facebook'] ?? 5) ?? [];
  const igHashtags = normalizeHashtags(raw.instagram.hashtags, 'instagram', config.maxHashtags['instagram'] ?? 10) ?? [];

  // Deterministically fix event-date phrasing so the output does not rely on the
  // model following the prompt instructions.
  const eventStartIso = config.eventStartIso;
  const facebookFinal = eventStartIso ? normaliseEventDatePhrasing(facebook, eventStartIso) : facebook;
  const instagramFinal = eventStartIso
    ? normaliseEventDatePhrasing(instagramBody, eventStartIso)
    : instagramBody;

  return {
    copy: {
      facebook: {
        body: facebookFinal,
        cta_text: facebookCtaText,
        hashtags: fbHashtags,
      },
      instagram: {
        body: instagramFinal,
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
  stripBareCta = false,
): string {
  // Strip markdown the platforms would otherwise render literally (e.g. **bold**)
  let output = stripMarkdown(body);

  // Replace known clichés with natural alternatives first (keeps the sentence
  // intact), then drop the whole containing sentence for any banned phrase
  // left over — deleting just the phrase produces broken grammar ("Bring your
  // friends and family for. Book now!").
  output = scrubBannedPhrases(output).value;
  output = removeBannedPhraseSentences(output, config.bannedPhrases);

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

  // Remove a bare booking CTA the composer will re-append — BEFORE the
  // signature, so a trailing signature line can't hide the CTA from the strip.
  if (stripBareCta) {
    output = stripBareBookingCtaLines(output);
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
  return stripTrailingBareBookingCtaSentence(kept.join("\n").replace(/\n{3,}/g, "\n\n").trim());
}

/**
 * The model often tacks the bare CTA onto the end of a longer closing line
 * ("…for a great night. Book now!"), which the line filter above cannot catch
 * (the line as a whole exceeds six words). Drop that trailing sentence too —
 * the composer appends the canonical CTA after the body.
 */
function stripTrailingBareBookingCtaSentence(body: string): string {
  const lines = body.split("\n");
  const lastIndex = lines.length - 1;
  const lastLine = lines[lastIndex]?.trim() ?? "";
  if (!lastLine) return body;
  const sentences = lastLine.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return body;
  const last = sentences[sentences.length - 1].trim();
  if (last.split(/\s+/).length > 6 || !BARE_BOOKING_CTA_LINE.test(last)) return body;
  lines[lastIndex] = sentences.slice(0, -1).join(" ").trim();
  return lines.join("\n").trim();
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

/**
 * Truncate text at sentence boundary nearest to word limit. Slices the
 * original string (rather than re-joining split words) so paragraph breaks
 * survive truncation.
 */
function truncateAtSentenceBoundary(value: string, maxWords: number): string {
  const words = [...value.matchAll(/\S+/g)];
  if (words.length <= maxWords) return value;

  // Slice the original string at the end of the last allowed word
  const cutoff = words[maxWords - 1];
  const truncated = value.slice(0, (cutoff.index ?? 0) + cutoff[0].length);

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
