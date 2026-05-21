/**
 * Plain-text helpers for social copy.
 *
 * Facebook, Instagram and Google Business Profile do not render markdown, so
 * any markdown the model emits would publish literally (e.g. a follower would
 * see "**bold**" with the asterisks). stripMarkdown removes the common markers
 * while leaving hashtags (#tag) and ordinary punctuation untouched.
 */

/** Remove markdown formatting that social platforms render as literal characters. */
export function stripMarkdown(value: string): string {
  return value
    // bold / italic: **text** and __text__ → text
    .replace(/\*\*([^*]+?)\*\*/g, "$1")
    .replace(/__([^_]+?)__/g, "$1")
    // any stray, unmatched bold markers left behind
    .replace(/\*\*/g, "")
    // fenced and inline code
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/`([^`]+)`/g, "$1")
    // markdown links [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // line-start headings ("# ", "## " …) — the required trailing space keeps #hashtags safe
    .replace(/^#{1,6}[ \t]+/gm, "")
    // line-start blockquote markers
    .replace(/^>[ \t]?/gm, "");
}

/**
 * Collapse runs of spaces/tabs to a single space while PRESERVING newlines, so
 * paragraph breaks survive. Trims spaces around newlines and clamps 3+
 * consecutive newlines down to a single blank line.
 */
export function collapseWhitespacePreservingBreaks(value: string): string {
  return value
    .replace(/[^\S\r\n]+/g, " ") // spaces/tabs → single space (newlines untouched)
    .replace(/[ \t]*\n[ \t]*/g, "\n") // trim spaces around each newline
    .replace(/\n{3,}/g, "\n\n") // clamp blank-line runs to a single blank line
    .trim();
}
