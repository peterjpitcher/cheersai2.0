/**
 * What the public site's own claims about Cheers must never mention
 * (SPEC-homepage-and-guides §4): paid ads, tournaments and the management-app
 * import are off for new venues, and Cheers posts only to Facebook and
 * Instagram (posting to Google's Business Profile was removed).
 *
 * The content tests apply this list to the homepage, the fixed words on the
 * guide pages, the search titles and descriptions, and every guide's closing
 * (the part that sells Cheers). Guide bodies are left out on purpose: an
 * article may fairly discuss other platforms.
 */
export interface BannedClaim {
  readonly label: string;
  readonly pattern: RegExp;
}

export const BANNED_CLAIMS: readonly BannedClaim[] = [
  { label: 'paid ads', pattern: /\bads?\b|\badvert/i },
  { label: 'campaigns', pattern: /campaign/i },
  { label: 'tournaments', pattern: /tournament/i },
  { label: 'Google or a Business Profile', pattern: /google|business profile/i },
  { label: 'TikTok', pattern: /tiktok/i },
  { label: 'LinkedIn', pattern: /linkedin/i },
  // "X" only as a capital standing alone, so ordinary words are untouched.
  { label: 'Twitter or X', pattern: /twitter|\bX\b/ },
  { label: 'the management app or its import', pattern: /management[- ]app|\bimport(?:s|ed|ing)?\b/i },
];

/** The labels of every banned claim a piece of text makes; empty when it makes none. */
export function bannedClaimsIn(text: string): string[] {
  return BANNED_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}
