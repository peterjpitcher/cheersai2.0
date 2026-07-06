// Bare (scheme-less) domains are only recognised when the final label is a known
// TLD. Matching any `[a-z]{2,}` (with the /i flag) treated ordinary prose with a
// missing space after a full stop — "Sat.Come", "food.Great" — as a domain,
// which wiped whole posts via stripDirectLinkSentences. The `\b` after the TLD
// stops a longer word ("Comedy") matching a TLD prefix ("com"). Any scheme-based
// or www. link still matches regardless of TLD via the first alternative.
const LINK_TLDS =
  "com|co|org|net|io|uk|pub|info|biz|app|dev|shop|store|online|site|live|events|me|tv|xyz|us|eu|ai|link|news|blog";

const DIRECT_LINK_PATTERN = new RegExp(
  `(?:https?:\\/\\/|www\\.)[^\\s<>"']+|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${LINK_TLDS})\\b(?:\\/[^\\s<>"']*)?`,
  "gi",
);

// The same links, but also consuming an immediately-preceding linking
// preposition ("book at <url>", "find us on <url>", "reserve via <url>"), so
// removing the URL does not leave the preposition dangling ("book at."). The
// preposition is only ever stripped when a real link follows it — ordinary copy
// that merely ends in "on"/"at"/"via" ("the match is on", "join us on") is
// left untouched, because the optional prefix matches nothing without a link.
const DIRECT_LINK_WITH_LEADING_PREPOSITION = new RegExp(
  `(?:\\b(?:at|via|on)\\s+)?(?:${DIRECT_LINK_PATTERN.source})`,
  "gi",
);

const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

export function extractDirectLinks(value: string): string[] {
  return (value.match(DIRECT_LINK_PATTERN) ?? []).map(normaliseDirectLinkMatch);
}

export function containsDirectLink(value: string): boolean {
  DIRECT_LINK_PATTERN.lastIndex = 0;
  return DIRECT_LINK_PATTERN.test(value);
}

export function stripDirectLinks(value: string): string {
  return value
    .replace(DIRECT_LINK_WITH_LEADING_PREPOSITION, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripDirectLinkSentences(value: string): string {
  return value
    .split("\n")
    .map((line) => stripDirectLinkSentenceFromLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripDirectLinkSentenceFromLine(line: string): string {
  if (!containsDirectLink(line)) return line;

  const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return "";

  return sentences.filter((sentence) => !containsDirectLink(sentence)).join(" ");
}

function normaliseDirectLinkMatch(value: string): string {
  return value.replace(TRAILING_PUNCTUATION, "");
}
