import { describe, expect, it } from 'vitest';

import {
  LATE_LOW_VALUE_STAGES,
  LOW_SHARE_THRESHOLD,
  MIN_SERVICE_BOOKINGS,
  buildCutoffRecommendations,
} from '@/lib/campaigns/food-cutoff-tuning';
import type { FoodDecisionStage, FoodServiceKey } from '@/types/campaigns';

type StageRow = {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage;
  windowKey: string;
  bookings: number;
};

describe('buildCutoffRecommendations', () => {
  it('recommends dropping a late, low-share window when the service has a meaningful sample', () => {
    const byStage: StageRow[] = [
      { serviceKey: 'sunday_roast', decisionStage: 'planning', windowKey: 'sunday_roast_planning', bookings: 40 },
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: 58 },
      // 2 of 100 = 2% share, below the 5% low-share threshold, and a late/low-value stage.
      { serviceKey: 'sunday_roast', decisionStage: 'last_tables', windowKey: 'sunday_roast_last_tables', bookings: 2 },
    ];

    const recommendations = buildCutoffRecommendations({
      byStage,
      totalsByService: { sunday_roast: 100 },
    });

    expect(recommendations).toHaveLength(1);
    const [recommendation] = recommendations;
    expect(recommendation.serviceKey).toBe('sunday_roast');
    expect(recommendation.decisionStage).toBe('last_tables');
    expect(recommendation.severity).toBe('info');
    expect(recommendation.message).toMatch(/last tables/i);
    expect(recommendation.message).toMatch(/2%/);
    expect(recommendation.message).toMatch(/sunday roast/i);
  });

  it('abstains entirely when the service sample is too thin to be credible', () => {
    const thinTotal = MIN_SERVICE_BOOKINGS - 1;
    const byStage: StageRow[] = [
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: thinTotal - 1 },
      { serviceKey: 'sunday_roast', decisionStage: 'last_tables', windowKey: 'sunday_roast_last_tables', bookings: 1 },
    ];

    const recommendations = buildCutoffRecommendations({
      byStage,
      totalsByService: { sunday_roast: thinTotal },
    });

    expect(recommendations).toEqual([]);
  });

  it('does not flag healthy late windows that carry a meaningful share', () => {
    const byStage: StageRow[] = [
      { serviceKey: 'sunday_roast', decisionStage: 'planning', windowKey: 'sunday_roast_planning', bookings: 30 },
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: 40 },
      // 30 of 100 = 30% share — healthy, must not be flagged even though it is a late stage.
      { serviceKey: 'sunday_roast', decisionStage: 'last_tables', windowKey: 'sunday_roast_last_tables', bookings: 30 },
    ];

    const recommendations = buildCutoffRecommendations({
      byStage,
      totalsByService: { sunday_roast: 100 },
    });

    expect(recommendations).toEqual([]);
  });

  it('does not flag early/high-value windows even when their share is tiny', () => {
    const byStage: StageRow[] = [
      // 2% share but an early planning stage — not a late/low-value stage, so never flagged.
      { serviceKey: 'sunday_roast', decisionStage: 'planning', windowKey: 'sunday_roast_planning', bookings: 2 },
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: 98 },
    ];

    const recommendations = buildCutoffRecommendations({
      byStage,
      totalsByService: { sunday_roast: 100 },
    });

    expect(recommendations).toEqual([]);
  });

  it('flags weekday and saturday late/low-value windows by window key', () => {
    const byStage: StageRow[] = [
      { serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision', windowKey: 'weekday_lunch_decision', bookings: 95 },
      { serviceKey: 'weekday_dinner', decisionStage: 'last_minute', windowKey: 'weekday_last_minute', bookings: 3 },
      { serviceKey: 'saturday_food', decisionStage: 'lunch_decision', windowKey: 'saturday_lunch_commit', bookings: 96 },
      { serviceKey: 'saturday_food', decisionStage: 'last_minute', windowKey: 'saturday_final_nudge', bookings: 4 },
    ];

    const recommendations = buildCutoffRecommendations({
      byStage,
      totalsByService: { weekday_dinner: 98, saturday_food: 100 },
    });

    const flagged = recommendations.map((item) => item.serviceKey).sort();
    expect(flagged).toEqual(['saturday_food', 'weekday_dinner']);
  });

  it('returns an empty list when there are no booking rows', () => {
    expect(buildCutoffRecommendations({ byStage: [], totalsByService: {} })).toEqual([]);
  });

  it('is pure: it does not mutate the input rows', () => {
    const byStage: StageRow[] = [
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: 98 },
      { serviceKey: 'sunday_roast', decisionStage: 'last_tables', windowKey: 'sunday_roast_last_tables', bookings: 2 },
    ];
    const snapshot = JSON.parse(JSON.stringify(byStage));

    buildCutoffRecommendations({ byStage, totalsByService: { sunday_roast: 100 } });

    expect(byStage).toEqual(snapshot);
  });

  it('produces a stable, deterministic ordering across services and stages', () => {
    const byStage: StageRow[] = [
      { serviceKey: 'weekday_dinner', decisionStage: 'lunch_decision', windowKey: 'weekday_lunch_decision', bookings: 95 },
      { serviceKey: 'weekday_dinner', decisionStage: 'last_minute', windowKey: 'weekday_last_minute', bookings: 3 },
      { serviceKey: 'sunday_roast', decisionStage: 'morning_commit', windowKey: 'sunday_roast_morning', bookings: 98 },
      { serviceKey: 'sunday_roast', decisionStage: 'last_tables', windowKey: 'sunday_roast_last_tables', bookings: 2 },
    ];

    const first = buildCutoffRecommendations({
      byStage,
      totalsByService: { weekday_dinner: 98, sunday_roast: 100 },
    });
    const second = buildCutoffRecommendations({
      byStage: [...byStage].reverse(),
      totalsByService: { sunday_roast: 100, weekday_dinner: 98 },
    });

    expect(first).toEqual(second);
  });

  it('exposes tunable thresholds as exported constants', () => {
    expect(LOW_SHARE_THRESHOLD).toBeGreaterThan(0);
    expect(LOW_SHARE_THRESHOLD).toBeLessThan(1);
    expect(MIN_SERVICE_BOOKINGS).toBeGreaterThan(0);
    expect(LATE_LOW_VALUE_STAGES).toContain('last_tables');
    expect(LATE_LOW_VALUE_STAGES).toContain('last_minute');
  });
});
