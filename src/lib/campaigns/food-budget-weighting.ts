import type { FoodAdWindow, FoodServiceKey, RunDay } from '@/types/campaigns';
import { SERVICE_BUDGET_GUIDANCE, DECISION_STAGE_TEMPLATES } from '@/lib/campaigns/food-schedule';

/**
 * Phase 3 (3a) — dynamic budget weighting for food campaigns.
 *
 * Pure, deterministic allocation of relative spend across a food campaign's ad windows.
 * Each window's raw weight is the product of four transparent multipliers:
 *
 *   servicePriority(serviceKey)  ×  dayNeed(runDay)  ×  phaseUrgency(windowKey)  ×  bookingGap(serviceKey)
 *
 * Raw weights are then normalised so the returned set sums to ~100 (a percentage split
 * the caller writes to `ad_sets.budget_weight`). No I/O, no Date — fully unit-testable.
 *
 * See docs/plans/2026-06-09-food-booking-phase-3-optimisation-spec.md §5 (3a), P3-1/P3-2.
 */

/** Tuning constants kept local so the formula is readable and testable in one place. */
const BOOKING_GAP_DEFAULT = 1.0; // cold start: no first-party signal yet => neutral.
const BOOKING_GAP_MIN = 0.5;
const BOOKING_GAP_MAX = 2.0;
const QUIET_DAY_BOOST = 1.2; // applied to quiet days under 'boost_quiet'.
const QUIET_DAYS: ReadonlySet<RunDay> = new Set<RunDay>(['tuesday', 'wednesday']);

export interface FoodWeightInput {
  /** The campaign's windows. Callers should pass the already enabled-filtered set. */
  windows: FoodAdWindow[];
  dayWeighting: 'even' | 'boost_quiet' | 'manual';
  /** Per-day multiplier used only when dayWeighting === 'manual'; missing days default to 1.0. */
  manualDayWeights?: Partial<Record<RunDay, number>>;
  /**
   * First-party booking-gap signal per service (Phase 2). Absent service => cold-start
   * default of 1.0. Every value is clamped to [0.5, 2.0] before use.
   */
  bookingGapByService?: Partial<Record<FoodServiceKey, number>>;
}

export interface FoodWeightResult {
  windowKey: string;
  runDate: string;
  /** Normalised weight; across the returned set these sum to ~100. */
  weight: number;
}

/** servicePriority: how much of the food budget this service warrants by default. */
function servicePriority(serviceKey: FoodServiceKey): number {
  return SERVICE_BUDGET_GUIDANCE[serviceKey];
}

/**
 * phaseUrgency: the seeded decision-stage template weight for this window. Looked up by
 * (serviceKey, windowKey) — windowKey is unique within a service's templates. Falls back
 * to the window's own carried `budgetWeight` if no template matches (defensive; windows
 * are produced from these same templates), then to 1.0 so an unknown window never zeroes.
 */
function phaseUrgency(window: FoodAdWindow): number {
  const template = DECISION_STAGE_TEMPLATES[window.serviceKey]?.find(
    (t) => t.windowKey === window.windowKey,
  );
  if (template) return template.weight;
  if (typeof window.budgetWeight === 'number' && window.budgetWeight > 0) return window.budgetWeight;
  return 1.0;
}

/** dayNeed: relative demand for the run day, per the campaign's day-weighting strategy. */
function dayNeed(
  runDay: RunDay,
  dayWeighting: FoodWeightInput['dayWeighting'],
  manualDayWeights: FoodWeightInput['manualDayWeights'],
): number {
  switch (dayWeighting) {
    case 'even':
      return 1.0;
    case 'boost_quiet':
      return QUIET_DAYS.has(runDay) ? QUIET_DAY_BOOST : 1.0;
    case 'manual':
      return manualDayWeights?.[runDay] ?? 1.0;
  }
}

/** bookingGap: clamped first-party signal, or the cold-start default when absent. */
function bookingGap(
  serviceKey: FoodServiceKey,
  bookingGapByService: FoodWeightInput['bookingGapByService'],
): number {
  const raw = bookingGapByService?.[serviceKey];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return BOOKING_GAP_DEFAULT;
  return Math.min(BOOKING_GAP_MAX, Math.max(BOOKING_GAP_MIN, raw));
}

/**
 * Compute normalised per-window budget weights for a food campaign. Returns one row per
 * input window (order preserved), with weights summing to ~100. Empty input => [].
 */
export function computeFoodWindowWeights(input: FoodWeightInput): FoodWeightResult[] {
  const { windows, dayWeighting, manualDayWeights, bookingGapByService } = input;
  if (windows.length === 0) return [];

  const raw = windows.map((w) =>
    servicePriority(w.serviceKey) *
    dayNeed(w.runDay, dayWeighting, manualDayWeights) *
    phaseUrgency(w) *
    bookingGap(w.serviceKey, bookingGapByService),
  );

  const total = raw.reduce((acc, value) => acc + value, 0);
  // Guard against a degenerate all-zero total (e.g. every multiplier collapsed to 0):
  // fall back to an even split so we never emit NaN.
  const evenShare = 100 / windows.length;

  return windows.map((w, i) => ({
    windowKey: w.windowKey,
    runDate: w.runDate,
    weight: total > 0 ? (raw[i] / total) * 100 : evenShare,
  }));
}

/**
 * Return the windows with each `budgetWeight` replaced by its normalised share (the returned set
 * sums to ~100), applying the campaign's day-weighting strategy. This is what callers persist to
 * `ad_sets.budget_weight` and what {@link computeAdSetSpendCaps} expects — the raw decision-stage
 * template weights do NOT sum to 100, so using them unmodified makes the CBO spend-cap preflight
 * overshoot the campaign budget and reject the publish/rollover.
 */
export function withNormalisedBudgetWeights(
  windows: FoodAdWindow[],
  input: Omit<FoodWeightInput, 'windows'>,
): FoodAdWindow[] {
  const weights = computeFoodWindowWeights({ windows, ...input });
  return windows.map((window, index) => ({
    ...window,
    budgetWeight: weights[index]?.weight ?? window.budgetWeight,
  }));
}

/**
 * Phase 3 (3b) — hybrid CBO per-ad-set spend caps.
 *
 * Under campaign budget optimization the campaign owns one budget; Meta still lets each ad
 * set declare a floor (`min_budget`) and ceiling (`max_budget`) on its share of that budget.
 * This derives those caps from each ad set's normalised `budget_weight` so demand-heavy
 * windows are guaranteed a slice while no single window can monopolise the budget.
 *
 * For each ad set: `target = (weight / 100) × campaignBudget`,
 *   `minBudget = max(metaMinBudget, target × CAP_MIN_FACTOR)`,
 *   `maxBudget = target × CAP_MAX_FACTOR`.
 *
 * Preflight (never silently clamp into an invalid state): if the sum of the floored minimums
 * exceeds the campaign budget, Meta would reject the configuration — we return an explanatory
 * error and an empty cap list so the caller can fail the publish cleanly.
 *
 * Pure + deterministic. See spec §5 (3b), P3-3.
 */

/** Floor/ceiling multipliers applied to each ad set's target spend. Tunable. */
const CAP_MIN_FACTOR = 0.5;
const CAP_MAX_FACTOR = 1.5;

/**
 * Conservative default per-ad-set minimum daily budget, in GBP. Meta enforces its own
 * minimums server-side and they vary by currency, billing event and account; this is a
 * documented floor used for local preflight only.
 *
 * TODO: verify against Meta's current live ad-set minimums (they are not static) and, if a
 * tighter/looser value is confirmed, pass it through `metaMinBudget` rather than editing this
 * default. Do not treat this as authoritative — Meta is the source of truth at create time.
 */
export const META_MIN_AD_SET_BUDGET_GBP = 1.0;

export interface AdSetSpendCap {
  adSetRef: string;
  minBudget: number;
  maxBudget: number;
}

export interface AdSetSpendCapInput {
  /** Ad sets to cap. `ref` is an opaque identifier (ad set id or windowKey) echoed back. */
  adSets: { ref: string; budgetWeight: number }[];
  /** The single campaign-level budget, in GBP (pounds). */
  campaignBudget: number;
  /** Documented per-ad-set minimum, in GBP. Defaults to {@link META_MIN_AD_SET_BUDGET_GBP}. */
  metaMinBudget?: number;
}

/**
 * Compute per-ad-set spend caps from budget weights, with a preflight that refuses to emit
 * an invalid set. Returns `{ caps }` on success, or `{ caps: [], error }` when the caps
 * cannot satisfy the campaign budget (so the caller can surface the message and abort).
 */
export function computeAdSetSpendCaps(input: AdSetSpendCapInput): {
  caps: AdSetSpendCap[];
  error?: string;
} {
  const { adSets, campaignBudget } = input;
  const metaMinBudget = input.metaMinBudget ?? META_MIN_AD_SET_BUDGET_GBP;

  if (adSets.length === 0) return { caps: [] };

  if (!Number.isFinite(campaignBudget) || campaignBudget <= 0) {
    return { caps: [], error: 'Campaign budget must be greater than zero to compute spend caps.' };
  }

  const caps: AdSetSpendCap[] = adSets.map((adSet) => {
    const weight = Number.isFinite(adSet.budgetWeight) ? Math.max(0, adSet.budgetWeight) : 0;
    const target = (weight / 100) * campaignBudget;
    const minBudget = Math.max(metaMinBudget, target * CAP_MIN_FACTOR);
    // F9: a tiny weight can floor minBudget above the raw target×CAP_MAX_FACTOR ceiling, and
    // Meta rejects max < min. Clamp the ceiling up to the floor — the upward clamp is valid
    // because the sum-of-mins preflight below still guards the aggregate.
    const maxBudget = Math.max(target * CAP_MAX_FACTOR, minBudget);
    return { adSetRef: adSet.ref, minBudget, maxBudget };
  });

  // Preflight: the floored minimums must collectively fit inside the campaign budget, or Meta
  // rejects the configuration. Surface a clear error instead of clamping into an invalid state.
  const minSum = caps.reduce((acc, cap) => acc + cap.minBudget, 0);
  if (minSum > campaignBudget) {
    return {
      caps: [],
      error:
        `Per-ad-set minimum spend caps total £${minSum.toFixed(2)}, which exceeds the campaign ` +
        `budget of £${campaignBudget.toFixed(2)}. Increase the campaign budget or reduce the ` +
        `number of ad windows so each can meet Meta's £${metaMinBudget.toFixed(2)} minimum.`,
    };
  }

  return { caps };
}
