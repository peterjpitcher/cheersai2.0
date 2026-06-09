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
