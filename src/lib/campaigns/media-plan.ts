import type {
  BudgetType,
  PaidExecutionMode,
  PaidMediaPlan,
  PaidMediaPlanBudgetRecommendation,
  PaidMediaPlanPhase,
} from '@/types/campaigns';
import {
  calculateInclusiveDurationDays,
  calculatePhases,
  type CampaignPhase,
} from '@/lib/campaigns/phases';

export const MIN_EVENT_BUDGET_PER_EXECUTION_PHASE = 15;

interface BuildEventMediaPlanInput {
  startDate: string;
  eventDate: string;
  adsStopTime: string;
  budgetAmount: number;
  budgetType: BudgetType;
}

export function buildEventMediaPlan(input: BuildEventMediaPlanInput): PaidMediaPlan {
  const strategicCampaignPhases = calculatePhases(input.startDate, input.eventDate, input.adsStopTime);
  const durationDays = calculateInclusiveDurationDays(input.startDate, input.eventDate);
  const lifetimeEquivalentBudget = toLifetimeEquivalentBudget(
    input.budgetAmount,
    input.budgetType,
    durationDays,
  );
  const maxExecutionPhaseCount = strategicCampaignPhases.length;
  const executionPhaseCount = resolveExecutionPhaseCount(
    lifetimeEquivalentBudget,
    maxExecutionPhaseCount,
  );
  const executionMode = executionModeForPhaseCount(executionPhaseCount);
  const executionCampaignPhases = buildExecutionPhases(strategicCampaignPhases, executionMode, input);
  const budgetRecommendation = buildBudgetRecommendation({
    budgetAmount: input.budgetAmount,
    budgetType: input.budgetType,
    durationDays,
    currentExecutionMode: executionMode,
    currentExecutionPhaseCount: executionPhaseCount,
    maxExecutionPhaseCount,
  });

  return {
    campaignKind: 'event',
    strategicPhases: strategicCampaignPhases.map(toStrategicPhase),
    executionPhases: executionCampaignPhases.map(toMediaPlanPhase),
    executionMode,
    budgetRecommendation,
    minBudgetPerExecutionPhase: MIN_EVENT_BUDGET_PER_EXECUTION_PHASE,
    lifetimeEquivalentBudget,
    durationDays,
    rationale: buildRationale(strategicCampaignPhases.length, executionCampaignPhases.length, budgetRecommendation),
  };
}

function toLifetimeEquivalentBudget(
  budgetAmount: number,
  budgetType: BudgetType,
  durationDays: number,
): number {
  const safeBudget = Number.isFinite(budgetAmount) ? Math.max(0, budgetAmount) : 0;
  return budgetType === 'DAILY' ? safeBudget * durationDays : safeBudget;
}

function resolveExecutionPhaseCount(
  lifetimeEquivalentBudget: number,
  maxExecutionPhaseCount: number,
): number {
  if (maxExecutionPhaseCount <= 1) return 1;
  const affordableCount = Math.floor(lifetimeEquivalentBudget / MIN_EVENT_BUDGET_PER_EXECUTION_PHASE);
  return Math.max(1, Math.min(maxExecutionPhaseCount, affordableCount));
}

function executionModeForPhaseCount(phaseCount: number): PaidExecutionMode {
  if (phaseCount >= 3) return 'three_phase';
  if (phaseCount === 2) return 'two_phase';
  return 'single_push';
}

function buildExecutionPhases(
  strategicPhases: CampaignPhase[],
  executionMode: PaidExecutionMode,
  input: BuildEventMediaPlanInput,
): CampaignPhase[] {
  if (executionMode === 'single_push') {
    if (strategicPhases.length === 1) {
      return [withBookingLabel(strategicPhases[0]!)];
    }

    return [{
      phaseType: 'booking-push',
      phaseLabel: 'Booking Push',
      phaseStart: input.startDate,
      phaseEnd: input.eventDate,
      adsStopTime: input.adsStopTime,
    }];
  }

  if (executionMode === 'two_phase' && strategicPhases.length >= 3) {
    const runUp = strategicPhases[0]!;
    const closeoutStart = strategicPhases[strategicPhases.length - 2]!.phaseStart;

    return [
      withBookingLabel(runUp),
      {
        phaseType: 'closeout',
        phaseLabel: 'Closeout',
        phaseStart: closeoutStart,
        phaseEnd: input.eventDate,
        adsStopTime: input.adsStopTime,
      },
    ];
  }

  return strategicPhases.map(withBookingLabel);
}

function withBookingLabel(phase: CampaignPhase): CampaignPhase {
  if (phase.phaseType === 'run-up') return { ...phase, phaseLabel: 'Warm-up' };
  if (phase.phaseType === 'day-before') return { ...phase, phaseLabel: 'Tomorrow Push' };
  if (phase.phaseType === 'day-of') return { ...phase, phaseLabel: 'Last Chance' };
  return phase;
}

function toStrategicPhase(phase: CampaignPhase): PaidMediaPlanPhase {
  return toMediaPlanPhase(withBookingLabel(phase));
}

function toMediaPlanPhase(phase: CampaignPhase): PaidMediaPlanPhase {
  return {
    phaseType: phase.phaseType,
    phaseLabel: phase.phaseLabel,
    phaseStart: phase.phaseStart,
    phaseEnd: phase.phaseEnd,
    adsStopTime: phase.adsStopTime,
  };
}

function buildBudgetRecommendation(args: {
  budgetAmount: number;
  budgetType: BudgetType;
  durationDays: number;
  currentExecutionMode: PaidExecutionMode;
  currentExecutionPhaseCount: number;
  maxExecutionPhaseCount: number;
}): PaidMediaPlanBudgetRecommendation | null {
  if (args.currentExecutionPhaseCount >= args.maxExecutionPhaseCount) return null;

  const targetExecutionPhaseCount = args.currentExecutionPhaseCount + 1;
  const recommendedLifetimeBudget = targetExecutionPhaseCount * MIN_EVENT_BUDGET_PER_EXECUTION_PHASE;
  const recommendedBudgetAmount = args.budgetType === 'DAILY'
    ? Math.ceil(recommendedLifetimeBudget / args.durationDays)
    : recommendedLifetimeBudget;
  const targetExecutionMode = executionModeForPhaseCount(targetExecutionPhaseCount);

  return {
    currentBudgetAmount: args.budgetAmount,
    recommendedBudgetAmount,
    additionalBudgetAmount: Math.max(0, recommendedBudgetAmount - args.budgetAmount),
    budgetType: args.budgetType,
    currentExecutionMode: args.currentExecutionMode,
    targetExecutionMode,
    reason: `Raise the ${args.budgetType === 'DAILY' ? 'daily' : 'total'} budget to at least GBP ${recommendedBudgetAmount} to unlock ${targetExecutionPhaseCount} paid phase${targetExecutionPhaseCount === 1 ? '' : 's'}.`,
  };
}

function buildRationale(
  strategicPhaseCount: number,
  executionPhaseCount: number,
  budgetRecommendation: PaidMediaPlanBudgetRecommendation | null,
): string {
  if (strategicPhaseCount === executionPhaseCount) {
    return `Budget and timing support all ${strategicPhaseCount} booking moments as separate Meta ad sets.`;
  }

  const recommendation = budgetRecommendation
    ? ` ${budgetRecommendation.reason}`
    : '';

  return `The plan keeps ${strategicPhaseCount} booking moments, but consolidates paid delivery into ${executionPhaseCount} Meta ad set${executionPhaseCount === 1 ? '' : 's'} so each one has enough budget to work.${recommendation}`;
}
