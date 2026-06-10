import { describe, it, expect } from 'vitest';
import type { FoodAdWindow, FoodServiceKey } from '@/types/campaigns';
import {
  computeFoodWindowWeights,
  computeAdSetSpendCaps,
  META_MIN_AD_SET_BUDGET_GBP,
} from '@/lib/campaigns/food-budget-weighting';
import { SERVICE_BUDGET_GUIDANCE, DECISION_STAGE_TEMPLATES } from '@/lib/campaigns/food-schedule';

/**
 * Build a FoodAdWindow with sensible defaults. The fields that actually drive the
 * weighting formula are serviceKey, windowKey, runDay and runDate; everything else is
 * filler the function should ignore.
 */
function window(overrides: Partial<FoodAdWindow> & Pick<FoodAdWindow, 'serviceKey' | 'windowKey'>): FoodAdWindow {
  return {
    decisionStage: 'morning_commit',
    runDay: 'sunday',
    runDate: '2026-06-14',
    startsAtLocal: '08:30',
    endsAtLocal: '11:30',
    serviceDate: '2026-06-14',
    serviceDateOffsetDays: 0,
    budgetWeight: 30,
    copyIntent: 'filler',
    enabled: true,
    ...overrides,
  };
}

/** The template weight (phaseUrgency) for a window, by service + windowKey. */
function templateWeight(serviceKey: FoodServiceKey, windowKey: string): number {
  const t = DECISION_STAGE_TEMPLATES[serviceKey].find((x) => x.windowKey === windowKey);
  if (!t) throw new Error(`no template for ${serviceKey}/${windowKey}`);
  return t.weight;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('computeFoodWindowWeights', () => {
  it('returns [] for empty input', () => {
    expect(
      computeFoodWindowWeights({ windows: [], dayWeighting: 'even' }),
    ).toEqual([]);
  });

  it('normalises a single window to 100', () => {
    const result = computeFoodWindowWeights({
      windows: [window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' })],
      dayWeighting: 'even',
    });
    expect(result).toHaveLength(1);
    expect(result[0].weight).toBeCloseTo(100, 6);
    expect(result[0].windowKey).toBe('sunday_roast_morning');
    expect(result[0].runDate).toBe('2026-06-14');
  });

  it('normalises any window set to sum ~100', () => {
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning', runDate: '2026-06-14' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
        window({ serviceKey: 'saturday_food', windowKey: 'saturday_lunch_commit', runDay: 'saturday', runDate: '2026-06-13' }),
      ],
      dayWeighting: 'even',
    });
    expect(sum(result.map((r) => r.weight))).toBeCloseTo(100, 6);
  });

  it('weights by service priority (Sunday roast highest, Saturday lowest) when phase + day are equal', () => {
    // Pick the planning window in each service so phaseUrgency differs — to isolate
    // service priority, scale each raw weight back out and compare the ratios.
    const sundayKey = 'sunday_roast_morning';
    const weekdayKey = 'weekday_afternoon_commit';
    const saturdayKey = 'saturday_afternoon_food';
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: sundayKey }),
        window({ serviceKey: 'weekday_dinner', windowKey: weekdayKey, runDay: 'thursday', runDate: '2026-06-11' }),
        window({ serviceKey: 'saturday_food', windowKey: saturdayKey, runDay: 'saturday', runDate: '2026-06-13' }),
      ],
      dayWeighting: 'even',
    });
    const byService = new Map(result.map((r) => [r.windowKey, r.weight]));
    // Divide out phaseUrgency to recover service-priority ordering.
    const sundayServiceComponent = byService.get(sundayKey)! / templateWeight('sunday_roast', sundayKey);
    const weekdayServiceComponent = byService.get(weekdayKey)! / templateWeight('weekday_dinner', weekdayKey);
    const saturdayServiceComponent = byService.get(saturdayKey)! / templateWeight('saturday_food', saturdayKey);
    expect(sundayServiceComponent).toBeGreaterThan(weekdayServiceComponent);
    expect(weekdayServiceComponent).toBeGreaterThan(saturdayServiceComponent);
    // Ratios should track SERVICE_BUDGET_GUIDANCE exactly (50 : 35 : 15).
    expect(sundayServiceComponent / saturdayServiceComponent).toBeCloseTo(
      SERVICE_BUDGET_GUIDANCE.sunday_roast / SERVICE_BUDGET_GUIDANCE.saturday_food,
      6,
    );
  });

  it('orders by phase urgency within a service (higher template weight => higher share)', () => {
    // Same service + same day; only the decision-stage template weight differs.
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_tomorrow' }),     // weight 35
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_last_tables' }),  // weight 15
      ],
      dayWeighting: 'even',
    });
    const tomorrow = result.find((r) => r.windowKey === 'sunday_roast_tomorrow')!.weight;
    const lastTables = result.find((r) => r.windowKey === 'sunday_roast_last_tables')!.weight;
    expect(tomorrow).toBeGreaterThan(lastTables);
    // With even days + same service, the ratio equals the template-weight ratio (35:15).
    expect(tomorrow / lastTables).toBeCloseTo(35 / 15, 6);
  });

  it('treats all days equally under "even" weighting', () => {
    // Two identical windows differing only by runDay should get identical weights.
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'thursday', runDate: '2026-06-11' }),
      ],
      dayWeighting: 'even',
    });
    expect(result[0].weight).toBeCloseTo(result[1].weight, 6);
    expect(result[0].weight).toBeCloseTo(50, 6);
  });

  it('boosts quiet days (Tue/Wed) under "boost_quiet" weighting', () => {
    // Same service + same template; Tuesday should out-weight Thursday by the boost factor.
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'thursday', runDate: '2026-06-11' }),
      ],
      dayWeighting: 'boost_quiet',
    });
    const tue = result.find((r) => r.runDate === '2026-06-09')!.weight;
    const thu = result.find((r) => r.runDate === '2026-06-11')!.weight;
    expect(tue).toBeGreaterThan(thu);
    // boost factor 1.2 for Tue/Wed vs 1.0 others.
    expect(tue / thu).toBeCloseTo(1.2, 6);
  });

  it('also boosts Wednesday under "boost_quiet"', () => {
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'wednesday', runDate: '2026-06-10' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'friday', runDate: '2026-06-12' }),
      ],
      dayWeighting: 'boost_quiet',
    });
    const wed = result.find((r) => r.runDate === '2026-06-10')!.weight;
    const fri = result.find((r) => r.runDate === '2026-06-12')!.weight;
    expect(wed / fri).toBeCloseTo(1.2, 6);
  });

  it('uses manualDayWeights under "manual" weighting, defaulting missing days to 1.0', () => {
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'thursday', runDate: '2026-06-11' }),
      ],
      dayWeighting: 'manual',
      manualDayWeights: { tuesday: 2 }, // thursday omitted => 1.0
    });
    const tue = result.find((r) => r.runDate === '2026-06-09')!.weight;
    const thu = result.find((r) => r.runDate === '2026-06-11')!.weight;
    expect(tue / thu).toBeCloseTo(2, 6);
  });

  it('defaults booking_gap to 1.0 at cold start (no signal => no effect)', () => {
    // With every multiplier equal, two windows that differ only in (absent) booking gap
    // should be identical — proving the cold-start default is a neutral 1.0.
    const withSignal = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
    });
    const withoutSignal = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: {}, // empty map => cold start for all
    });
    expect(withoutSignal.map((r) => r.weight)).toEqual(withSignal.map((r) => r.weight));
  });

  it('applies booking_gap as a multiplier when present', () => {
    const result = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: { sunday_roast: 2, weekday_dinner: 1 },
    });
    const roast = result.find((r) => r.windowKey === 'sunday_roast_morning')!.weight;
    const weekday = result.find((r) => r.windowKey === 'weekday_lunch_decision')!.weight;
    // Sunday raw = 50 * 30 * 2 ; Weekday raw = 35 * 55 * 1.
    const sundayRaw = SERVICE_BUDGET_GUIDANCE.sunday_roast * templateWeight('sunday_roast', 'sunday_roast_morning') * 2;
    const weekdayRaw = SERVICE_BUDGET_GUIDANCE.weekday_dinner * templateWeight('weekday_dinner', 'weekday_lunch_decision') * 1;
    expect(roast / weekday).toBeCloseTo(sundayRaw / weekdayRaw, 6);
  });

  it('clamps booking_gap at the upper bound of 2.0', () => {
    // A huge raw gap (5.0) must behave identically to exactly 2.0.
    const clamped = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: { sunday_roast: 5 },
    });
    const atBound = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: { sunday_roast: 2 },
    });
    expect(clamped.map((r) => r.weight)).toEqual(atBound.map((r) => r.weight));
  });

  it('clamps booking_gap at the lower bound of 0.5', () => {
    // A tiny raw gap (0.1) must behave identically to exactly 0.5.
    const clamped = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: { sunday_roast: 0.1 },
    });
    const atBound = computeFoodWindowWeights({
      windows: [
        window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
        window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
      ],
      dayWeighting: 'even',
      bookingGapByService: { sunday_roast: 0.5 },
    });
    expect(clamped.map((r) => r.weight)).toEqual(atBound.map((r) => r.weight));
  });

  it('is deterministic and preserves one result row per input window', () => {
    const windows = [
      window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_morning' }),
      window({ serviceKey: 'sunday_roast', windowKey: 'sunday_roast_tomorrow', runDay: 'saturday', runDate: '2026-06-13' }),
      window({ serviceKey: 'weekday_dinner', windowKey: 'weekday_lunch_decision', runDay: 'tuesday', runDate: '2026-06-09' }),
    ];
    const a = computeFoodWindowWeights({ windows, dayWeighting: 'boost_quiet' });
    const b = computeFoodWindowWeights({ windows, dayWeighting: 'boost_quiet' });
    expect(a).toEqual(b);
    expect(a).toHaveLength(windows.length);
  });
});

describe('computeAdSetSpendCaps', () => {
  it('derives min = target*0.5 and max = target*1.5 from each weight', () => {
    // Two ad sets, 60/40 split of a £100 budget => targets £60 and £40.
    const { caps, error } = computeAdSetSpendCaps({
      adSets: [
        { ref: 'a', budgetWeight: 60 },
        { ref: 'b', budgetWeight: 40 },
      ],
      campaignBudget: 100,
    });

    expect(error).toBeUndefined();
    expect(caps).toEqual([
      { adSetRef: 'a', minBudget: 30, maxBudget: 90 },
      { adSetRef: 'b', minBudget: 20, maxBudget: 60 },
    ]);
  });

  it('floors min at the Meta minimum when target*0.5 is below it', () => {
    // Tiny weight => target £4, target*0.5 = £2 which is below the £1 floor here it is
    // above, so use an even smaller share to force the floor: weight 1% of £100 => £1
    // target, *0.5 = £0.50 < floor.
    const { caps, error } = computeAdSetSpendCaps({
      adSets: [
        { ref: 'small', budgetWeight: 1 },
        { ref: 'big', budgetWeight: 99 },
      ],
      campaignBudget: 100,
    });

    expect(error).toBeUndefined();
    const small = caps.find((c) => c.adSetRef === 'small');
    expect(small?.minBudget).toBe(META_MIN_AD_SET_BUDGET_GBP);
    // max is still derived from the raw target (£1 * 1.5).
    expect(small?.maxBudget).toBeCloseTo(1.5, 5);
  });

  it('rejects when sum of min budgets exceeds the campaign budget', () => {
    // Many small ad sets: each floored to the Meta minimum, their sum exceeds the budget.
    const adSets = Array.from({ length: 5 }, (_, i) => ({ ref: `w${i}`, budgetWeight: 20 }));
    const { caps, error } = computeAdSetSpendCaps({
      adSets,
      campaignBudget: 3, // floor £1 * 5 = £5 > £3
    });

    expect(caps).toEqual([]);
    expect(error).toBeTruthy();
    expect(error).toContain('minimum');
  });

  it('honours a custom metaMinBudget over the default', () => {
    const { caps, error } = computeAdSetSpendCaps({
      adSets: [{ ref: 'a', budgetWeight: 100 }],
      campaignBudget: 50,
      metaMinBudget: 10,
    });

    expect(error).toBeUndefined();
    // target £50, *0.5 = £25 which is above the £10 custom floor.
    expect(caps[0]).toEqual({ adSetRef: 'a', minBudget: 25, maxBudget: 75 });
  });

  it('returns an empty cap list for no ad sets', () => {
    const { caps, error } = computeAdSetSpendCaps({ adSets: [], campaignBudget: 100 });
    expect(caps).toEqual([]);
    expect(error).toBeUndefined();
  });

  it('rejects a non-positive campaign budget', () => {
    const { caps, error } = computeAdSetSpendCaps({
      adSets: [{ ref: 'a', budgetWeight: 100 }],
      campaignBudget: 0,
    });
    expect(caps).toEqual([]);
    expect(error).toBeTruthy();
  });

  it('exposes a positive default Meta minimum constant', () => {
    expect(META_MIN_AD_SET_BUDGET_GBP).toBeGreaterThan(0);
  });

  describe('F9 max >= min invariant', () => {
    it('clamps max up to the floored min for a tiny-weight ad set (max === min, no error)', () => {
      // Tiny weight on a healthy budget: target £0.20 => raw max £0.30 sits BELOW the £1
      // floored min. Meta rejects max < min, so the max must be lifted to the min.
      const { caps, error } = computeAdSetSpendCaps({
        adSets: [
          { ref: 'tiny', budgetWeight: 0.1 },
          { ref: 'rest', budgetWeight: 99.9 },
        ],
        campaignBudget: 200,
      });

      expect(error).toBeUndefined();
      const tiny = caps.find((c) => c.adSetRef === 'tiny');
      expect(tiny?.minBudget).toBe(META_MIN_AD_SET_BUDGET_GBP);
      expect(tiny?.maxBudget).toBe(tiny?.minBudget);
    });

    it('never emits max < min across every cap returned', () => {
      const { caps } = computeAdSetSpendCaps({
        adSets: [
          { ref: 'a', budgetWeight: 0.5 },
          { ref: 'b', budgetWeight: 1 },
          { ref: 'c', budgetWeight: 98.5 },
        ],
        campaignBudget: 150,
      });
      for (const cap of caps) {
        expect(cap.maxBudget).toBeGreaterThanOrEqual(cap.minBudget);
      }
    });
  });
});
