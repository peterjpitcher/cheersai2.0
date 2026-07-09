import { collapseWhitespacePreservingBreaks, stripMarkdown } from "@/lib/utils/markdown";
import { containsDirectLink, stripDirectLinks, stripDirectLinkSentences } from "@/lib/utils/social-links";
import type { Platform, PlatformCtaLinks } from "@/types/content";

const HASHTAG_TOKEN = /#[\p{L}\p{N}_]+/gu;
const LINK_IN_BIO_SENTENCE =
  /\b(?:see|check|use|tap|visit|head to|go to)?\s*(?:the\s+|our\s+)?link[-\s]in[-\s](?:our\s+|the\s+)?bio[^.!?\n]*(?:[.!?]|$)/gi;

const PLATFORM_HASHTAG_LIMIT: Record<Platform, number> = {
  facebook: 5,
  instagram: 10,
};

export function readPlatformCtaLinks(brief: Record<string, unknown>): PlatformCtaLinks {
  const value = brief.ctaLinks;
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const links: PlatformCtaLinks = {};

  for (const platform of ["facebook", "instagram"] as const) {
    const raw = source[platform];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        links[platform] = trimmed;
      }
    }
  }

  return links;
}

export function resolvePlatformCtaUrl(platform: Platform, links?: PlatformCtaLinks | null): string | null {
  const candidate = links?.[platform]?.trim();
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : null;
}

export function sanitizePublishBody(platform: Platform, value: string): string {
  let output = stripMarkdown(value ?? "");

  // Body URLs are untrusted. Platform CTA URLs are added from structured
  // ctaLinks only, so generated/manual body links cannot override API event URLs.
  output = stripDirectLinkSentences(output);
  if (containsDirectLink(output)) {
    output = stripDirectLinks(output);
  }

  output = stripHashtagsFromBody(output);
  if (platform !== "instagram") {
    output = stripLinkInBioSentences(output);
  }

  return cleanCopyArtifacts(output);
}

export function normalizeHashtags(
  hashtags: string[] | null | undefined,
  platform: Platform,
  max = PLATFORM_HASHTAG_LIMIT[platform],
): string[] | undefined {
  if (!hashtags?.length || max <= 0) return undefined;

  const seen = new Set<string>();
  const normalised: string[] = [];

  for (const raw of hashtags) {
    const candidates = raw
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const tag = normaliseHashtag(candidate);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalised.push(tag);
      if (normalised.length >= max) return normalised;
    }
  }

  return normalised.length ? normalised : undefined;
}

export function sanitizeCtaText(value: string | null | undefined): string | null {
  const cleaned = cleanCopyArtifacts(stripDirectLinks(stripMarkdown(value ?? "")));
  return cleaned || null;
}

export function stripHashtagsFromBody(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(HASHTAG_TOKEN, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanCopyArtifacts(value: string): string {
  // Note: dangling-preposition cleanup after a removed link lives in
  // stripDirectLinks (which only trims "at/via/on" adjacent to an actual link).
  // It must not live here — cleanCopyArtifacts runs on every publish body and
  // CTA, and an unconditional "at/via/on" trim ate legitimate final words
  // ("the match is on" -> "the match is").
  return collapseWhitespacePreservingBreaks(value)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}

function stripLinkInBioSentences(value: string): string {
  return value
    .replace(LINK_IN_BIO_SENTENCE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseHashtag(value: string): string | null {
  let candidate = value.trim();

  // Models sometimes emit a hashtag as a full platform URL, e.g.
  // "https://www.facebook.com/hashtag/BarStaff" or
  // "https://www.instagram.com/explore/tags/BarStaff". Blindly stripping the
  // punctuation would produce "#httpswwwfacebookcomhashtagBarStaff", so pull the
  // real tag out of the URL. Any other bare URL is not a hashtag — drop it rather
  // than turn a link into a garbage tag.
  const hashtagUrl = candidate.match(/\/(?:hashtag|explore\/tags)\/([^/?#\s]+)/i);
  if (hashtagUrl) {
    candidate = hashtagUrl[1];
  } else if (/^https?:\/\//i.test(candidate)) {
    return null;
  }

  const cleaned = candidate
    .replace(/^[#@]+/, "")
    .replace(/[^\p{L}\p{N}_]+/gu, "");

  if (!cleaned) return null;
  return `#${cleaned}`;
}
