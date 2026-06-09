import type { FoodDecisionStage, FoodServiceKey } from '@/types/campaigns';

/**
 * Advisory cutoff-tuning analysis for food booking campaigns (Phase 3, spec §5 3e).
 *
 * Pure and deterministic: given the per-stage booking aggregation that Phase 2 already
 * produces, it surfaces *advice* about decision-stage windows that convert poorly and
 * late. It NEVER changes a schedule, budget, or hard cutoff — honouring P3-6 (advisory
 * only). The caller (the dashboard food panel) renders the recommendations as info.
 */

/** Stages that fire near a service's hard stop and tend to carry low intent/value. */
export const LATE_LOW_VALUE_STAGES: readonly FoodDecisionStage[] = [
  'last_minute',
  'last_tables',
];

/**
 * A late window is flagged when its share of its service's bookings falls below this
 * fraction (5%). Tunable: raise to flag more aggressively, lower to be more conservative.
 */
export const LOW_SHARE_THRESHOLD = 0.05;

/**
 * Minimum bookings a service must have before we offer any cutoff advice. Below this the
 * sample is too thin for share percentages to be credible, so we abstain (no noise).
 */
export const MIN_SERVICE_BOOKINGS = 20;

export interface CutoffRecommendation {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  severity: 'info';
  message: string;
}

export interface FoodCutoffStageBookings {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  windowKey: string;
  bookings: number;
}

export interface BuildCutoffRecommendationsInput {
  byStage: FoodCutoffStageBookings[];
  totalsByService: Partial<Record<FoodServiceKey, number>>;
}

const SERVICE_LABELS: Record<FoodServiceKey, string> = {
  weekday_dinner: 'Weekday dinner',
  saturday_food: 'Saturday food',
  sunday_roast: 'Sunday roast',
};

const DECISION_STAGE_LABELS: Record<FoodDecisionStage, string> = {
  planning: 'planning',
  lunch_decision: 'lunch decision',
  afternoon_commit: 'afternoon commit',
  tomorrow: 'tomorrow',
  morning_commit: 'morning commit',
  last_tables: 'last tables',
  last_minute: 'last minute',
};

// Deterministic output order: group by service, then by decision stage, then window key.
const SERVICE_ORDER: FoodServiceKey[] = ['sunday_roast', 'weekday_dinner', 'saturday_food'];
const STAGE_ORDER: FoodDecisionStage[] = [
  'planning',
  'lunch_decision',
  'afternoon_commit',
  'tomorrow',
  'morning_commit',
  'last_tables',
  'last_minute',
];

function isLateLowValueStage(stage: FoodDecisionStage): boolean {
  return LATE_LOW_VALUE_STAGES.includes(stage);
}

/**
 * Build advisory cutoff recommendations from booking distributions. Returns `[]` when no
 * service has a credible sample or no late window converts poorly. Never mutates input.
 */
export function buildCutoffRecommendations(
  input: BuildCutoffRecommendationsInput,
): CutoffRecommendation[] {
  const recommendations: CutoffRecommendation[] = [];

  for (const row of input.byStage) {
    if (!isLateLowValueStage(row.decisionStage)) continue;

    const serviceTotal = input.totalsByService[row.serviceKey] ?? 0;
    // Abstain on thin samples: share percentages are not credible below the floor.
    if (serviceTotal < MIN_SERVICE_BOOKINGS) continue;

    const share = serviceTotal > 0 ? row.bookings / serviceTotal : 0;
    if (share >= LOW_SHARE_THRESHOLD) continue;

    recommendations.push({
      serviceKey: row.serviceKey,
      decisionStage: row.decisionStage,
      severity: 'info',
      message: buildMessage(row.serviceKey, row.decisionStage, share),
    });
  }

  return recommendations.sort(compareRecommendations);
}

function buildMessage(
  serviceKey: FoodServiceKey,
  decisionStage: FoodDecisionStage,
  share: number,
): string {
  const sharePercent = formatSharePercent(share);
  const service = SERVICE_LABELS[serviceKey];
  const stage = DECISION_STAGE_LABELS[decisionStage];
  return `${service} “${stage}” converts ${sharePercent} of its bookings — consider dropping this window or pulling the hard stop earlier.`;
}

function formatSharePercent(share: number): string {
  const percent = share * 100;
  // Whole numbers read cleanly (2%); fractional shares keep one decimal (1.5%).
  const rounded = Number.isInteger(percent) ? percent : Math.round(percent * 10) / 10;
  return `${rounded}%`;
}

function compareRecommendations(left: CutoffRecommendation, right: CutoffRecommendation): number {
  const service = SERVICE_ORDER.indexOf(left.serviceKey) - SERVICE_ORDER.indexOf(right.serviceKey);
  if (service !== 0) return service;
  return STAGE_ORDER.indexOf(left.decisionStage) - STAGE_ORDER.indexOf(right.decisionStage);
}
