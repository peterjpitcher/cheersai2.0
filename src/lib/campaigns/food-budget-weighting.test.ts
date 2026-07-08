import { describe, expect, it } from 'vitest';

import { computeAdSetSpendCaps, withNormalisedBudgetWeights } from '@/lib/campaigns/food-budget-weighting';
import type { FoodAdWindow, FoodServiceKey } from '@/types/campaigns';

function win(
  serviceKey: FoodServiceKey,
  windowKey: string,
  budgetWeight: number,
  overrides: Partial<FoodAdWindow> = {},
): FoodAdWindow {
  return {
    serviceKey,
    decisionStage: 'planning',
    runDay: 'wednesday',
    runDate: '2026-07-15',
    startsAtLocal: '11:00',
    endsAtLocal: '18:00',
    serviceDate: '2026-07-15',
    serviceDateOffsetDays: 0,
    budgetWeight,
    copyIntent: 'book a table',
    windowKey,
    enabled: true,
    ...overrides,
  };
}

// A realistic multi-service food campaign whose raw template weights sum to ~205, far above 100.
function threeServiceWindows(): FoodAdWindow[] {
  return [
    win('weekday_dinner', 'wd_1', 55),
    win('weekday_dinner', 'wd_2', 35),
    win('saturday_food', 'sat_1', 25, { runDay: 'saturday' }),
    win('saturday_food', 'sat_2', 35, { runDay: 'saturday' }),
    win('sunday_roast', 'sun_1', 20, { runDay: 'sunday' }),
    win('sunday_roast', 'sun_2', 35, { runDay: 'sunday' }),
  ];
}

const sumWeights = (windows: FoodAdWindow[]) => windows.reduce((sum, w) => sum + w.budgetWeight, 0);

describe('withNormalisedBudgetWeights', () => {
  it('normalises budget weights to sum ~100', () => {
    const normalised = withNormalisedBudgetWeights(threeServiceWindows(), { dayWeighting: 'even' });
    expect(sumWeights(normalised)).toBeCloseTo(100, 5);
  });

  it('keeps CBO spend-cap minimums within the campaign budget (R2: raw weights overshoot and hard-fail)', () => {
    const campaignBudget = 100;

    // Raw template weights (sum ~205) blow the min-cap preflight — the bug this fixes.
    const raw = computeAdSetSpendCaps({
      adSets: threeServiceWindows().map((w) => ({ ref: w.windowKey, budgetWeight: w.budgetWeight })),
      campaignBudget,
    });
    expect(raw.error).toBeTruthy();

    // Normalised weights (sum ~100) fit inside the budget.
    const normalised = withNormalisedBudgetWeights(threeServiceWindows(), { dayWeighting: 'even' });
    const capped = computeAdSetSpendCaps({
      adSets: normalised.map((w) => ({ ref: w.windowKey, budgetWeight: w.budgetWeight })),
      campaignBudget,
    });
    expect(capped.error).toBeUndefined();
    const minSum = capped.caps.reduce((sum, cap) => sum + cap.minBudget, 0);
    expect(minSum).toBeLessThanOrEqual(campaignBudget);
  });

  it('lets dayWeighting actually shape the split (R7: previously dead input)', () => {
    const even = withNormalisedBudgetWeights(threeServiceWindows(), { dayWeighting: 'even' });
    const boosted = withNormalisedBudgetWeights(threeServiceWindows(), { dayWeighting: 'boost_quiet' });

    // The weekday-dinner windows run on Wednesday (a quiet day), so boost_quiet lifts their share.
    const weekdayShare = (windows: FoodAdWindow[]) =>
      windows.filter((w) => w.serviceKey === 'weekday_dinner').reduce((sum, w) => sum + w.budgetWeight, 0);
    expect(weekdayShare(boosted)).toBeGreaterThan(weekdayShare(even));
    expect(sumWeights(boosted)).toBeCloseTo(100, 5);
  });
});
