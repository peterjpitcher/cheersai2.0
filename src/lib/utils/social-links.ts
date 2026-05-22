const DIRECT_LINK_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

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
    .replace(DIRECT_LINK_PATTERN, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\b(?:at|via|on)\s*([.!?])/gi, "$1")
    .replace(/\b(?:at|via|on)$/gi, "")
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
