/**
 * Public-copy rules for the conversion-first optimiser's booking rewrites.
 *
 * A rewrite becomes a live Meta ad, so internal labels (the campaign name), raw data and the ads
 * playbook's banned phrases must never reach it. The rules run twice: when a rewrite is proposed,
 * and again when one is applied, because a stored proposal can predate them.
 */

export const REWRITE_HEADLINE_MAX = 40;
export const REWRITE_PRIMARY_TEXT_MAX = 300;
export const REWRITE_DESCRIPTION_MAX = 25;

/** Generic urgency and adjectives the optimiser treats as weak booking copy. */
export const GENERIC_URGENCY_PHRASES = [
  "don't miss out",
  "don't miss",
  'join the fun',
  'exciting',
  'amazing',
  'hurry',
];

/** tasks/ADS-PLAYBOOK-the-anchor.md, section 5 "Banned phrases". */
const PLAYBOOK_BANNED_PHRASES = [
  'premium dining experience',
  'elevated gastropub',
  'luxury',
  'exclusive',
  'curated experience',
  'fine dining',
  'hidden gem',
  'airport pub',
  'unforgettable night',
  'unforgettable evening',
  'good vibes',
  'avoid disappointment',
  'spaces are limited',
  'epic night',
  'sing your heart out',
  'a night to remember',
];

const BANNED_PUBLIC_PHRASES = [...PLAYBOOK_BANNED_PHRASES, ...GENERIC_URGENCY_PHRASES];

export const WALK_IN_PATTERN = /\bwalk-?ins?\s+(welcome|available|if space allows)\b/i;
const RAW_URL_PATTERN = /(https?:\/\/|\bwww\.)/i;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;

// The old rewrite cut campaign names to 36 characters, so that cut is checked as well.
const LEGACY_NAME_CUT = 36;
// Shorter candidates are too likely to be ordinary words to treat as a name.
const MIN_NAME_CANDIDATE_LENGTH = 4;

export interface RewriteCopyFields {
  headline: string;
  primaryText: string;
  description?: string | null;
}

export interface RewriteCopyContext {
  /** `meta_campaigns.name`: an internal label that must never be published. */
  campaignName: string | null | undefined;
  /**
   * Names that are genuinely public, such as the imported event name. A campaign named exactly
   * after its public event may therefore still use that name.
   */
  publicNames?: Array<string | null | undefined>;
}

/**
 * Returns plain-English reasons the copy cannot go into a public ad; empty when it is safe.
 */
export function findRewriteCopyProblems(copy: RewriteCopyFields, context: RewriteCopyContext): string[] {
  const problems: string[] = [];
  const headline = copy.headline?.trim() ?? '';
  const primaryText = copy.primaryText?.trim() ?? '';
  const description = copy.description?.trim() ?? '';
  const allText = [headline, primaryText, description].join('\n');

  if (!headline) problems.push('the headline is empty');
  if (!primaryText) problems.push('the primary text is empty');
  if (headline.length > REWRITE_HEADLINE_MAX) {
    problems.push(`the headline is longer than ${REWRITE_HEADLINE_MAX} characters`);
  }
  if (primaryText.length > REWRITE_PRIMARY_TEXT_MAX) {
    problems.push(`the primary text is longer than ${REWRITE_PRIMARY_TEXT_MAX} characters`);
  }
  if (description.length > REWRITE_DESCRIPTION_MAX) {
    problems.push(`the description is longer than ${REWRITE_DESCRIPTION_MAX} characters`);
  }

  if (usesInternalCampaignName(allText, context)) problems.push('it uses the internal campaign name');

  const banned = findBannedPhrase(allText);
  if (banned) problems.push(`it uses the banned phrase "${banned}"`);
  if (WALK_IN_PATTERN.test(allText)) problems.push('it says walk-ins are welcome');
  if (RAW_URL_PATTERN.test(allText)) problems.push('it contains a web address');
  if (ISO_DATE_PATTERN.test(allText)) problems.push('it contains an unformatted date');

  return problems;
}

/** The first banned playbook or generic-urgency phrase in the text, or null. */
export function findBannedPhrase(value: string): string | null {
  const text = ` ${normaliseForMatch(value)} `;
  return BANNED_PUBLIC_PHRASES.find((phrase) => text.includes(` ${normaliseForMatch(phrase)} `)) ?? null;
}

function usesInternalCampaignName(text: string, context: RewriteCopyContext): boolean {
  const publicNames = new Set(
    (context.publicNames ?? [])
      .map((name) => normaliseForMatch(name ?? ''))
      .filter(Boolean),
  );
  const haystack = ` ${normaliseForMatch(text)} `;

  return campaignNameCandidates(context.campaignName).some((candidate) => {
    if (publicNames.has(candidate)) return false;
    return haystack.includes(` ${candidate} `);
  });
}

function campaignNameCandidates(campaignName: string | null | undefined): string[] {
  const raw = campaignName?.trim() ?? '';
  if (!raw) return [];

  const beforePipe = raw.replace(/\s*\|\s*.+$/, '').trim();
  return Array.from(new Set([raw, beforePipe, beforePipe.slice(0, LEGACY_NAME_CUT)]))
    .map(normaliseForMatch)
    .filter((candidate) => candidate.length >= MIN_NAME_CANDIDATE_LENGTH);
}

/** Lower case, apostrophes removed, every other run of punctuation or space collapsed to one space. */
function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9£]+/g, ' ')
    .trim();
}
