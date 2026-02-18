import { DateTime } from "luxon";

import { applyProofPoints, lintProofPoints, type ProofPointUsage } from "@/lib/ai/proof-points";
import { detectBannedPhrases, reduceHype, scrubBannedPhrases } from "@/lib/ai/voice";
import type { InstantPostAdvancedOptions } from "@/lib/create/schema";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export type Platform = "facebook" | "instagram" | "gbp";
export type Placement = "feed" | "story";

export interface LintIssue {
  code: string;
  message: string;
}

export interface LintResult {
  pass: boolean;
  issues: LintIssue[];
  metrics: {
    wordCount: number;
    charCount: number;
    hashtagCount: number;
    emojiCount: number;
    hasLinkInBio: boolean;
    hasUrl: boolean;
  };
}

export interface ContractContext {
  platform: Platform;
  placement: Placement;
  advanced?: Partial<InstantPostAdvancedOptions> | null;
  context?: Record<string, unknown> | null;
  scheduledFor?: Date | null;
}

export interface ContractResolution {
  platform: Platform;
  placement: Placement;
  includeHashtags: boolean;
  includeEmojis: boolean;
  maxHashtags: number;
  maxEmojis: number;
  maxWords?: number;
  maxChars?: number;
  allowLinkInBio: boolean;
  hasLink: boolean;
}

export interface ChannelRuleResult {
  body: string;
  repairs: string[];
  proofPoint: ProofPointUsage | null;
}

const DEFAULT_ADVANCED: InstantPostAdvancedOptions = {
  toneAdjust: "default",
  lengthPreference: "standard",
  includeHashtags: true,
  includeEmojis: true,
  ctaStyle: "default",
};

const URL_PATTERN = /https?:\/\/\S+/gi;
const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const LINK_IN_BIO_PATTERN = /\blink in (?:our|the)?\s*bio\b/gi;
const DAY_PATTERN = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/gi;

const BLOCKED_WORDS = ["undefined", "null", "nan"];
const BLOCKED_PATTERNS: RegExp[] = [
  /\{\{[^}]*\}\}/g,
  /\[\[[^\]]*\]\]/g,
  /<\s*[a-z][^>]*>/gi,
  /\[object\s+object\]/gi,
  /\bas an ai language model\b/gi,
  /\bas a language model\b/gi,
];

const CLAIM_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  // Price patterns removed to allow user-specified prices to pass through
  // { code: "price", ... } regexes were too aggressive
  { code: "capacity", pattern: /\blimited (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\bspaces are limited\b/gi },
  { code: "capacity", pattern: /\bselling fast\b/gi },
  { code: "capacity", pattern: /\bonly \d+ (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\blast (?:few|remaining) (?:spaces|spots|seats|tables)\b/gi },
  { code: "capacity", pattern: /\bnearly sold out\b/gi },
  { code: "capacity", pattern: /\bsold out\b/gi },
  { code: "end_time", pattern: /\buntil\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi },
  { code: "end_time", pattern: /\btill\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi },
  { code: "end_time", pattern: /\buntil late\b/gi },
  { code: "end_time", pattern: /\btill late\b/gi },
  { code: "end_time", pattern: /\blate[- ]night\b/gi },
  { code: "end_time", pattern: /\bopen late\b/gi },
  { code: "food_time", pattern: /\bfood (?:served|serving|service|available)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "food_time", pattern: /\bkitchen (?:open|serving)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "food_time", pattern: /\bserving (?:food|dinner|lunch)\b[^.]*\b(?:from|until|till|at)\b/gi },
  { code: "age", pattern: /\b18\+\b/gi },
  { code: "age", pattern: /\b21\+\b/gi },
  { code: "age", pattern: /\bover\s+18s?\b/gi },
  { code: "age", pattern: /\badults? only\b/gi },
  { code: "age", pattern: /\bkids? (?:welcome|allowed)\b/gi },
  { code: "age", pattern: /\bfamily friendly\b/gi },
  { code: "age", pattern: /\ball ages\b/gi },
];

export function resolveAdvancedOptions(
  overrides?: Partial<InstantPostAdvancedOptions> | null,
): InstantPostAdvancedOptions {
  return {
    ...DEFAULT_ADVANCED,
    ...(overrides ?? {}),
  };
}

export function resolveContract({
  platform,
  placement,
  advanced,
  context,
}: ContractContext): ContractResolution {
  const resolvedAdvanced = resolveAdvancedOptions(advanced ?? context?.advanced as Partial<InstantPostAdvancedOptions>);
  const includeHashtags = Boolean(resolvedAdvanced.includeHashtags);
  const includeEmojis = Boolean(resolvedAdvanced.includeEmojis);
  const hasLink = Boolean(getContextString(context, "linkInBioUrl") || getContextString(context, "ctaUrl"));

  const maxHashtags =
    platform === "gbp"
      ? 0
      : platform === "instagram"
        ? includeHashtags ? 6 : 0
        : includeHashtags ? 3 : 0;

  const maxEmojis =
    platform === "gbp"
      ? includeEmojis ? 2 : 0
      : includeEmojis ? 3 : 0;

  return {
    platform,
    placement,
    includeHashtags,
    includeEmojis,
    maxHashtags,
    maxEmojis,
    maxWords: platform === "instagram" ? 80 : undefined,
    maxChars: platform === "gbp" ? 900 : undefined,
    allowLinkInBio: platform === "instagram" && hasLink,
    hasLink,
  };
}

export function applyChannelRules({
  body,
  context,
  advanced,
  platform,
  placement,
  scheduledFor,
}: {
  body: string;
  platform: Platform;
  placement: Placement;
  context?: Record<string, unknown> | null;
  advanced?: Partial<InstantPostAdvancedOptions> | null;
  scheduledFor?: Date | null;
}): ChannelRuleResult {
  const repairs: string[] = [];
  const contract = resolveContract({ platform, placement, advanced, context, scheduledFor });
  if (placement === "story") {
    if (body.trim().length) {
      repairs.push("story_caption_removed");
    }
    return { body: "", repairs, proofPoint: null };
  }

  let output = body.replace(/\r\n/g, "\n").trim();

  const blockedFound = findBlockedTokens(output);
  if (blockedFound.length) {
    output = stripBlockedTokens(output);
    repairs.push("blocked_tokens_removed");
  }

  const allowedClaims = resolveAllowedClaimCodes(context);
  const claimRemoval = stripDisallowedClaims(output, allowedClaims);
  if (claimRemoval.removedCodes.length) {
    output = claimRemoval.value;
    repairs.push(...claimRemoval.removedCodes.map((code) => `claims_${code}_removed`));
  }

  const bannedScrub = scrubBannedPhrases(output);
  if (bannedScrub.removed.length) {
    output = bannedScrub.value;
    repairs.push("banned_phrases_removed");
  }

  const hypeReduced = reduceHype(output);
  if (hypeReduced.adjusted.length) {
    output = hypeReduced.value;
    repairs.push("hype_reduced");
  }

  const dayNormalized = normalizeDayNames(output, resolveReferenceDate(context, scheduledFor, output));
  if (dayNormalized.changed && dayNormalized.action) {
    output = dayNormalized.value;
    repairs.push(dayNormalized.action);
  }

  const proofPointResult = applyProofPoints({
    body: output,
    platform,
    context,
  });
  if (proofPointResult.removedIds.length) {
    repairs.push("proof_points_removed");
  }
  if (proofPointResult.used) {
    repairs.push(
      proofPointResult.used.source === "existing" ? "proof_point_preserved" : "proof_point_added",
    );
  }
  output = proofPointResult.value;

  const withoutUrls = output.replace(URL_PATTERN, "");
  if (withoutUrls !== output) {
    output = withoutUrls;
    repairs.push("urls_removed");
  }

  if (!contract.allowLinkInBio) {
    const before = output;
    output = output.replace(LINK_IN_BIO_PATTERN, "");
    if (before !== output) repairs.push("link_in_bio_removed");
  }

  output = normalizePunctuation(output);
  const deduped = collapseRepeatedWords(output);
  if (deduped !== output) {
    output = deduped;
    repairs.push("repetition_trimmed");
  }

  let lines = output
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trim())
    .filter((line) => line.length);

  const { bodyLines, hashtags } = extractHashtags(lines);
  lines = bodyLines;

  if (platform === "instagram" && contract.allowLinkInBio) {
    const hasLinkLine = lines.some((line) => LINK_IN_BIO_PATTERN.test(line));
    LINK_IN_BIO_PATTERN.lastIndex = 0;
    if (!hasLinkLine) {
      lines.push(resolveInstagramLinkLine(context));
      repairs.push("link_in_bio_added");
    }
  }

  if (platform === "facebook") {
    const ctaUrl = getContextString(context, "ctaUrl");
    if (ctaUrl) {
      const ctaLabel = resolveFacebookCtaLabel(context);
      const labelLower = ctaLabel.toLowerCase();
      lines = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed.endsWith(":")) return true;
        return !trimmed.toLowerCase().startsWith(labelLower);
      });
      const expectedLine = `${ctaLabel}: ${ctaUrl}`;
      if (!lines.some((line) => line.includes(ctaUrl))) {
        lines.push(expectedLine);
        repairs.push("facebook_cta_appended");
      }
    }
  }

  const compacted = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  let final = contract.maxWords
    ? enforceWordLimit(
      compacted,
      contract.maxWords,
      contract.allowLinkInBio,
      proofPointResult.used?.text ? [proofPointResult.used.text] : [],
    )
    : compacted;

  if (contract.maxChars && final.length > contract.maxChars) {
    final = final.slice(0, contract.maxChars).trimEnd();
    repairs.push("length_clamped");
  }

  final = removeTrailingEllipses(final);

  if (contract.maxEmojis >= 0) {
    const trimmed = trimEmojis(final, contract.maxEmojis);
    if (trimmed !== final) repairs.push("emojis_trimmed");
    final = trimmed;
  }

  if (contract.maxHashtags === 0) {
    if (hashtags.length) repairs.push("hashtags_removed");
    final = final.replace(HASHTAG_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
  } else if (contract.maxHashtags > 0 && hashtags.length) {
    const unique = dedupeHashtags(hashtags).slice(0, contract.maxHashtags);
    const hashtagLine = unique.join(" ");
    final = final ? `${final}\n${hashtagLine}` : hashtagLine;
    repairs.push("hashtags_clamped");
  }

  final = ensureFinalPunctuation(final);

  if (contract.maxChars && final.length > contract.maxChars) {
    final = final.slice(0, contract.maxChars).trimEnd();
    if (!repairs.includes("length_clamped")) {
      repairs.push("length_clamped");
    }
  }

  return { body: final, repairs, proofPoint: proofPointResult.used };
}

export function lintContent({
  body,
  platform,
  placement,
  context,
  advanced,
  scheduledFor,
}: {
  body: string;
  platform: Platform;
  placement: Placement;
  context?: Record<string, unknown> | null;
  advanced?: Partial<InstantPostAdvancedOptions> | null;
  scheduledFor?: Date | null;
}): LintResult {
  const contract = resolveContract({ platform, placement, advanced, context, scheduledFor });
  const issues: LintIssue[] = [];
  const trimmed = body.trim();
  const withoutHashtags = trimmed.replace(HASHTAG_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  const wordCount = countWords(withoutHashtags);
  const charCount = trimmed.length;
  const hashtags = extractHashtagTokens(trimmed);
  const emojiCount = countEmojis(trimmed);
  const hasLinkInBio = LINK_IN_BIO_PATTERN.test(trimmed);
  LINK_IN_BIO_PATTERN.lastIndex = 0;
  const urls = trimmed.match(URL_PATTERN) ?? [];
  const hasUrl = urls.length > 0;

  if (placement === "story" && trimmed.length) {
    issues.push({ code: "story_caption_present", message: "Stories must not include captions." });
  }

  const blockedTokens = findBlockedTokens(trimmed);
  if (blockedTokens.length) {
    issues.push({ code: "blocked_tokens", message: "Blocked tokens detected in output." });
  }

  const proofPointLint = lintProofPoints({ body: trimmed, platform, context });
  for (const issue of proofPointLint.issues) {
    issues.push({ code: issue, message: "Proof point rules were violated." });
  }

  const bannedPhraseHits = detectBannedPhrases(trimmed);
  if (bannedPhraseHits.length) {
    issues.push({ code: "banned_phrases", message: "Banned phrases detected in output." });
  }

  const allowedClaims = resolveAllowedClaimCodes(context);
  const claimIssues = detectDisallowedClaims(trimmed, allowedClaims);
  for (const issue of claimIssues) {
    issues.push({
      code: `claim_${issue}`,
      message: "Disallowed claim detected for missing field.",
    });
  }

  const dayLint = validateDayNames(trimmed, resolveReferenceDate(context, scheduledFor, trimmed));
  if (!dayLint.pass) {
    issues.push({
      code: "day_name_mismatch",
      message: "Day name does not match the scheduled or event date.",
    });
  }

  if (platform !== "instagram" && hasLinkInBio) {
    issues.push({ code: "link_in_bio_disallowed", message: "Link-in-bio language is only allowed on Instagram." });
  }

  if (platform === "instagram") {
    if (!contract.allowLinkInBio && hasLinkInBio) {
      issues.push({ code: "link_in_bio_unapproved", message: "Instagram link-in-bio used without a link." });
    }
    if (contract.allowLinkInBio && !hasLinkInBio) {
      issues.push({ code: "link_in_bio_missing", message: "Instagram link-in-bio line missing." });
    }
    if (contract.maxWords && wordCount > contract.maxWords) {
      issues.push({ code: "word_limit", message: "Instagram captions must stay within 80 words." });
    }
  }

  if (platform === "gbp" && hasLinkInBio) {
    issues.push({ code: "gbp_link_in_bio", message: "GBP posts cannot mention link-in-bio." });
  }

  if (platform === "gbp" && hashtags.length) {
    issues.push({ code: "gbp_hashtags", message: "GBP posts cannot include hashtags." });
  }

  if (hasUrl) {
    const ctaUrl = getContextString(context, "ctaUrl");
    if (platform === "facebook" && ctaUrl) {
      const onlyCta = urls.every((url) => url === ctaUrl);
      if (!onlyCta) {
        issues.push({ code: "url_disallowed", message: "Only the CTA URL is allowed in Facebook copy." });
      }
    } else {
      issues.push({ code: "url_disallowed", message: "URLs are not allowed in this channel copy." });
    }
  }

  if (platform === "facebook") {
    const ctaUrl = getContextString(context, "ctaUrl");
    if (ctaUrl && !trimmed.includes(ctaUrl)) {
      issues.push({ code: "cta_url_missing", message: "Facebook CTA URL must be appended when provided." });
    }
  }

  if (contract.maxHashtags >= 0 && hashtags.length > contract.maxHashtags) {
    issues.push({ code: "hashtag_limit", message: "Hashtag count exceeds channel limit." });
  }

  if (contract.maxEmojis >= 0 && emojiCount > contract.maxEmojis) {
    issues.push({ code: "emoji_limit", message: "Emoji count exceeds channel limit." });
  }

  if (contract.maxChars && charCount > contract.maxChars) {
    issues.push({ code: "char_limit", message: "GBP copy exceeds the hard length cap." });
  }

  if (/\.\.\.+$/.test(trimmed) || /…$/.test(trimmed)) {
    issues.push({ code: "trailing_ellipsis", message: "Trailing ellipsis is not allowed." });
  }

  if (hasRepeatedWord(trimmed)) {
    issues.push({ code: "repetition", message: "Repeated word sequence detected." });
  }

  const pass = issues.length === 0;

  return {
    pass,
    issues,
    metrics: {
      wordCount,
      charCount,
      hashtagCount: hashtags.length,
      emojiCount,
      hasLinkInBio,
      hasUrl,
    },
  };
}

export function removeTrailingEllipses(value: string) {
  return value.replace(/(\.\.\.|…)+$/g, "").trimEnd();
}

function normalizePunctuation(value: string) {
  return value
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/\.{2,}/g, ".")
    .replace(/,\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function collapseRepeatedWords(value: string) {
  return value.replace(/\b(\w+)(\s+\1){2,}\b/gi, "$1");
}

function extractHashtags(lines: string[]) {
  const bodyLines: string[] = [];
  const hashtags: string[] = [];

  for (const line of lines) {
    const found = line.match(HASHTAG_PATTERN) ?? [];
    if (found.length) {
      hashtags.push(...found.map((tag) => tag.trim()));
    }
    const cleaned = line.replace(HASHTAG_PATTERN, "").replace(/\s{2,}/g, " ").trim();
    if (cleaned.length) {
      bodyLines.push(cleaned);
    }
  }

  return { bodyLines, hashtags };
}

function extractHashtagTokens(value: string) {
  return value.match(HASHTAG_PATTERN) ?? [];
}

function dedupeHashtags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(tag);
  }
  return result;
}

function trimEmojis(value: string, limit: number) {
  if (limit <= 0) {
    return value.replace(EMOJI_PATTERN, "");
  }
  let count = 0;
  return value.replace(EMOJI_PATTERN, (match) => {
    count += 1;
    return count <= limit ? match : "";
  });
}

function enforceWordLimit(
  value: string,
  limit: number,
  hasLinkLine: boolean,
  protectedLines: string[] = [],
) {
  const lines = value.split("\n");
  const linkIndex = hasLinkLine
    ? lines.findIndex((line) => LINK_IN_BIO_PATTERN.test(line))
    : -1;
  LINK_IN_BIO_PATTERN.lastIndex = 0;
  const linkLine = linkIndex >= 0 ? lines[linkIndex] : null;

  const normalizedProtected = protectedLines
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const protectedSet = new Set(normalizedProtected);
  const protectedActual: string[] = [];
  const bodyLines: string[] = [];

  lines.forEach((line, index) => {
    if (linkIndex === index) return;
    const normalized = line.trim().toLowerCase();
    if (protectedSet.has(normalized)) {
      protectedActual.push(line);
      return;
    }
    bodyLines.push(line);
  });

  const protectedWordCount = protectedActual.reduce((sum, line) => sum + countWords(line), 0)
    + (linkLine ? countWords(linkLine) : 0);
  const maxWords = Math.max(limit - protectedWordCount, 0);

  const trimmedBody: string[] = [];
  let remaining = maxWords;

  for (const line of bodyLines) {
    const words = countWords(line);
    if (!words) {
      if (trimmedBody.length) trimmedBody.push("");
      continue;
    }
    if (words <= remaining) {
      trimmedBody.push(line);
      remaining -= words;
      continue;
    }
    if (remaining > 0) {
      const trimmedLine = trimLineToWords(line, remaining);
      if (trimmedLine.length) trimmedBody.push(trimmedLine);
    }
    remaining = 0;
    break;
  }

  const cleanedBody = trimmedBody.filter((line, index) => {
    if (line.trim().length) return true;
    return index > 0 && index < trimmedBody.length - 1;
  });

  const finalLines = [
    ...cleanedBody,
    ...protectedActual,
    ...(linkLine ? [linkLine] : []),
  ];
  return finalLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ensureFinalPunctuation(value: string) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return value;
  const last = lines.length - 1;
  if (lines[last].startsWith("#")) {
    return lines.join("\n");
  }
  if (!/[.!?]$/.test(lines[last])) {
    lines[last] = `${lines[last]}.`;
  }
  return lines.join("\n");
}

function resolveReferenceDate(
  context?: Record<string, unknown> | null,
  scheduledFor?: Date | null,
  body?: string,
) {
  const eventStart = parseIsoDate(getContextString(context, "eventStart"));
  if (eventStart) return eventStart;
  const promotionStart = parseIsoDate(getContextString(context, "promotionStart"));
  const promotionEnd = parseIsoDate(getContextString(context, "promotionEnd"));
  if (promotionStart || promotionEnd) {
    const lower = body?.toLowerCase() ?? "";
    const referencesEnd = /(end|ends|ending|until|last chance|final|wraps|closing)/.test(lower);
    if (referencesEnd && promotionEnd) return promotionEnd;
    if (promotionStart) return promotionStart;
    if (promotionEnd) return promotionEnd;
  }
  if (scheduledFor instanceof Date && !Number.isNaN(scheduledFor.getTime())) {
    return scheduledFor;
  }
  return null;
}

function parseIsoDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDayNames(value: string, referenceDate: Date | null) {
  const matches = Array.from(value.matchAll(DAY_PATTERN)).map((match) => match[0]);
  if (!matches.length) return { value, changed: false };

  if (!referenceDate) {
    const removed = value.replace(DAY_PATTERN, "").replace(/\s{2,}/g, " ").trim();
    return { value: removed, changed: true, action: "day_names_removed" as const };
  }

  const computed = formatDayName(referenceDate);
  const computedLower = computed.toLowerCase();
  const unique = new Set(matches.map((m) => m.toLowerCase()));

  if (unique.size === 1) {
    const current = [...unique][0];
    if (current !== computedLower) {
      const replaced = value.replace(DAY_PATTERN, computed);
      return { value: replaced, changed: true, action: "day_name_replaced" as const };
    }
    return { value, changed: false };
  }

  const removed = value.replace(DAY_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  return { value: removed, changed: true, action: "day_names_removed" as const };
}

function validateDayNames(value: string, referenceDate: Date | null) {
  const matches = Array.from(value.matchAll(DAY_PATTERN)).map((match) => match[0]);
  if (!matches.length) return { pass: true };
  if (!referenceDate) return { pass: false };
  const computed = formatDayName(referenceDate).toLowerCase();
  const unique = new Set(matches.map((m) => m.toLowerCase()));
  if (unique.size === 1) {
    return { pass: unique.has(computed) };
  }
  return { pass: unique.size === 1 && unique.has(computed) };
}

function formatDayName(date: Date) {
  return DateTime.fromJSDate(date, { zone: DEFAULT_TIMEZONE })
    .setLocale("en-GB")
    .toFormat("cccc");
}

function stripDisallowedClaims(value: string, allowedCodes: string[] = []) {
  const allowed = new Set(allowedCodes);
  let output = value;
  const removedCodes: string[] = [];
  for (const rule of CLAIM_PATTERNS) {
    if (allowed.has(rule.code)) continue;
    if (rule.pattern.test(output)) {
      output = output.replace(rule.pattern, "");
      removedCodes.push(rule.code);
    }
    rule.pattern.lastIndex = 0;
  }
  return { value: output.replace(/\s{2,}/g, " ").trim(), removedCodes };
}

function detectDisallowedClaims(value: string, allowedCodes: string[] = []) {
  const allowed = new Set(allowedCodes);
  const hits = new Set<string>();
  for (const rule of CLAIM_PATTERNS) {
    if (allowed.has(rule.code)) continue;
    if (rule.pattern.test(value)) {
      hits.add(rule.code);
    }
    rule.pattern.lastIndex = 0;
  }
  return [...hits];
}

function findBlockedTokens(value: string) {
  const hits: string[] = [];
  const lowered = value.toLowerCase();
  for (const token of BLOCKED_WORDS) {
    if (new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(lowered)) {
      hits.push(token);
    }
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(value)) {
      hits.push(pattern.source);
    }
    pattern.lastIndex = 0;
  }
  return hits;
}

function stripBlockedTokens(value: string) {
  let output = value;
  for (const token of BLOCKED_WORDS) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
    output = output.replace(pattern, "");
  }
  for (const pattern of BLOCKED_PATTERNS) {
    output = output.replace(pattern, "");
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

function hasRepeatedWord(value: string) {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i] && tokens[i] === tokens[i + 1] && tokens[i] === tokens[i + 2]) {
      return true;
    }
  }
  return false;
}

function countWords(value: string) {
  if (!value) return 0;
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function countEmojis(value: string) {
  if (!value) return 0;
  return value.match(EMOJI_PATTERN)?.length ?? 0;
}

function trimLineToWords(line: string, limit: number) {
  if (limit <= 0) return "";
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.slice(0, Math.min(limit, tokens.length)).join(" ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getContextString(context: Record<string, unknown> | null | undefined, key: string) {
  if (!context) return null;
  const candidate = context[key];
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length ? trimmed : null;
}

function getContextStringArray(context: Record<string, unknown> | null | undefined, key: string) {
  if (!context) return [];
  const value = context[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function resolveAllowedClaimCodes(context?: Record<string, unknown> | null) {
  const mode = getContextString(context, "proofPointMode");
  if (!mode || mode === "off") return [];
  const selected = getContextStringArray(context, "proofPointsSelected");
  const intentTags = getContextStringArray(context, "proofPointIntentTags");
  const allowsFamily = selected.includes("family-friendly") || intentTags.includes("family");
  return allowsFamily ? ["age"] : [];
}

function resolveFacebookCtaLabel(context: Record<string, unknown> | null | undefined) {
  const label = getContextString(context, "ctaLabel");
  return label ?? "Learn more";
}

function resolveInstagramLinkLine(context: Record<string, unknown> | null | undefined) {
  const label = getContextString(context, "ctaLabel");
  if (!label) return "See the link in our bio for details.";
  const trimmed = label.trim().replace(/[.!?…]+$/g, "");
  if (!trimmed.length) return "See the link in our bio for details.";
  return `${trimmed} via the link in our bio.`;
}
