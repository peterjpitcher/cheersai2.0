import { z } from "zod";

export const CONTENT_PILLARS = {
  food_drink: {
    label: "Food & Drink",
    keywords: [
      "food", "menu", "dish", "burger", "roast", "kitchen", "chef",
      "drink", "pint", "cocktail", "wine", "beer", "lunch", "dinner", "breakfast",
    ],
  },
  events: {
    label: "Events & Entertainment",
    keywords: [
      "event", "quiz", "music", "live", "band", "karaoke", "sport",
      "match", "screening", "bingo", "comedy", "dj",
    ],
  },
  people: {
    label: "People & Community",
    keywords: [
      "staff", "team", "manager", "barman", "new starter",
      "anniversary", "charity", "community",
    ],
  },
  behind_scenes: {
    label: "Behind the Scenes",
    keywords: [
      "behind the scenes", "prep", "setup", "delivery",
      "morning", "before we open", "getting ready",
    ],
  },
  customer_love: {
    label: "Customer Love",
    keywords: [
      "review", "favourite", "popular", "most-requested",
      "regulars", "feedback", "thank you",
    ],
  },
  seasonal: {
    label: "Seasonal & Holidays",
    keywords: [
      "christmas", "easter", "bank holiday", "summer", "winter",
      "spring", "autumn", "halloween", "valentine",
      "mother's day", "father's day", "new year",
    ],
  },
} as const;

export type ContentPillar = keyof typeof CONTENT_PILLARS;

export const CONTENT_PILLAR_KEYS = Object.keys(CONTENT_PILLARS) as ContentPillar[];

/** Zod enum for application-layer validation before DB write. */
export const contentPillarSchema = z.enum([
  "food_drink",
  "events",
  "people",
  "behind_scenes",
  "customer_love",
  "seasonal",
]);

/**
 * Pre-compiled regex per pillar. Each pattern uses word-boundary anchors
 * to prevent partial matches (e.g. "sun" must not match "Sunday").
 * Multi-word phrases come before single words in the alternation so they
 * match first (regex alternation is left-to-right).
 */
const PILLAR_PATTERNS: Record<ContentPillar, RegExp> = (() => {
  const result = {} as Record<ContentPillar, RegExp>;
  for (const key of CONTENT_PILLAR_KEYS) {
    const kws = CONTENT_PILLARS[key].keywords;
    // Sort longest-first so multi-word phrases get priority in alternation
    const sorted = [...kws].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((kw) =>
      kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    result[key] = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  }
  return result;
})();

/** Tie-break order: events > seasonal > customer_love > behind_scenes > people > food_drink */
const TIE_BREAK_ORDER: ContentPillar[] = [
  "events",
  "seasonal",
  "customer_love",
  "behind_scenes",
  "people",
  "food_drink",
];

/**
 * Infer the content pillar from the post title and prompt.
 * Uses score-based matching — pillar with the most keyword hits wins.
 * Ties broken by TIE_BREAK_ORDER. Default: food_drink.
 */
export function inferContentPillar(title: string, prompt: string): ContentPillar {
  const text = `${title} ${prompt}`.toLowerCase();
  if (!text.trim()) return "food_drink";

  const scores: Record<ContentPillar, number> = {
    food_drink: 0,
    events: 0,
    people: 0,
    behind_scenes: 0,
    customer_love: 0,
    seasonal: 0,
  };

  for (const key of CONTENT_PILLAR_KEYS) {
    const pattern = PILLAR_PATTERNS[key];
    const matches = text.match(pattern);
    pattern.lastIndex = 0;
    scores[key] = matches?.length ?? 0;
  }

  let best: ContentPillar = "food_drink";
  let bestScore = 0;

  for (const key of TIE_BREAK_ORDER) {
    if (scores[key] > bestScore) {
      best = key;
      bestScore = scores[key];
    }
  }

  return best;
}

/**
 * Build a pillar nudge string if the inferred pillar matches the most recent 2
 * entries in recentPillars. Advisory only — the AI may still write to the
 * inferred pillar if the brief demands it.
 *
 * Returns null if no nudge is needed.
 */
export function buildPillarNudge(
  inferredPillar: ContentPillar,
  recentPillars: string[],
): string | null {
  const validRecent = recentPillars.filter(
    (p): p is ContentPillar => p in CONTENT_PILLARS,
  );
  const lastTwo = validRecent.slice(-2);

  if (lastTwo.length < 2) return null;
  if (!lastTwo.every((p) => p === inferredPillar)) return null;

  // Suggest 2 alternative pillars
  const alternatives = CONTENT_PILLAR_KEYS.filter((k) => k !== inferredPillar).slice(0, 2);
  const altLabels = alternatives.map((k) => CONTENT_PILLARS[k].label);

  return `Recent posts have focused on ${CONTENT_PILLARS[inferredPillar].label}. If possible, try a different angle — e.g., frame this from the ${altLabels.join(" or ")} perspective.`;
}

/**
 * Get the human-readable label for a pillar.
 */
export function getPillarLabel(pillar: ContentPillar): string {
  return CONTENT_PILLARS[pillar].label;
}
