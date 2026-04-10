import { z } from "zod";

/**
 * Eight hook strategies — each has a prompt instruction that tells the AI
 * how to open the post.
 */
export const HOOK_STRATEGIES = {
  question: "Open with a question that invites a response from the reader.",
  bold_statement: "Open with a confident, opinionated statement — own it.",
  direct_address:
    "Open by speaking directly to a specific group (e.g., families, dog owners, rugby fans).",
  curiosity_gap:
    "Open by teasing something without revealing it all — make them want to read on.",
  seasonal:
    "Open with a reference to the weather, season, time of year, or a timely local moment.",
  scarcity:
    "Open by highlighting limited availability, time pressure, or high demand.",
  behind_scenes:
    "Open as if sharing an insider glimpse — something the reader wouldn't normally see.",
  social_proof:
    "Open by referencing popularity, customer love, or high demand for this.",
} as const;

export type HookStrategy = keyof typeof HOOK_STRATEGIES;

export const HOOK_STRATEGY_KEYS = Object.keys(HOOK_STRATEGIES) as HookStrategy[];

/** Zod enum for application-layer validation before DB write. */
export const hookStrategySchema = z.enum([
  "question",
  "bold_statement",
  "direct_address",
  "curiosity_gap",
  "seasonal",
  "scarcity",
  "behind_scenes",
  "social_proof",
]);

/** How many recent hooks to avoid when selecting the next one. */
const LOOKBACK = 3;

/**
 * Pick a hook strategy that avoids the last `LOOKBACK` entries in `recentHooks`.
 *
 * - Filters the 8 strategies to exclude the last 3 in `recentHooks`
 * - Picks one at random from the remaining
 * - If all 8 are exhausted within the lookback window (impossible with 8 strategies
 *   and lookback of 3, but defensive), falls back to full random
 */
export function selectHookStrategy(recentHooks: string[]): HookStrategy {
  const validRecent = recentHooks.filter(
    (h): h is HookStrategy => h in HOOK_STRATEGIES,
  );
  const avoid = new Set(validRecent.slice(-LOOKBACK));
  const candidates = HOOK_STRATEGY_KEYS.filter((k) => !avoid.has(k));

  if (candidates.length === 0) {
    // Defensive fallback — should never happen with 8 strategies and lookback 3
    return HOOK_STRATEGY_KEYS[Math.floor(Math.random() * HOOK_STRATEGY_KEYS.length)]!;
  }

  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/**
 * Return the prompt instruction line for a given hook strategy.
 */
export function getHookInstruction(strategy: HookStrategy): string {
  return HOOK_STRATEGIES[strategy];
}
