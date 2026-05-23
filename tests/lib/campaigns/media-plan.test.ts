import { describe, expect, it } from 'vitest';

import { buildEventMediaPlan } from '@/lib/campaigns/media-plan';

describe('buildEventMediaPlan', () => {
  it('uses one last-chance execution phase for same-day events', () => {
    const plan = buildEventMediaPlan({
      startDate: '2026-03-15',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 20,
      budgetType: 'LIFETIME',
    });

    expect(plan.executionMode).toBe('single_push');
    expect(plan.strategicPhases).toHaveLength(1);
    expect(plan.executionPhases).toHaveLength(1);
    expect(plan.executionPhases[0]).toMatchObject({
      phaseType: 'day-of',
      phaseLabel: 'Last Chance',
      phaseStart: '2026-03-15',
      adsStopTime: '19:00',
    });
    expect(plan.budgetRecommendation).toBeNull();
  });

  it('uses two execution phases for tomorrow events when budget supports them', () => {
    const plan = buildEventMediaPlan({
      startDate: '2026-03-14',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 30,
      budgetType: 'LIFETIME',
    });

    expect(plan.executionMode).toBe('two_phase');
    expect(plan.strategicPhases.map((phase) => phase.phaseLabel)).toEqual(['Tomorrow Push', 'Last Chance']);
    expect(plan.executionPhases).toHaveLength(2);
    expect(plan.budgetRecommendation).toBeNull();
  });

  it('keeps three strategic moments but runs one ad set for low-budget events', () => {
    const plan = buildEventMediaPlan({
      startDate: '2026-03-10',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 20,
      budgetType: 'LIFETIME',
    });

    expect(plan.executionMode).toBe('single_push');
    expect(plan.strategicPhases).toHaveLength(3);
    expect(plan.executionPhases).toEqual([
      {
        phaseType: 'booking-push',
        phaseLabel: 'Booking Push',
        phaseStart: '2026-03-10',
        phaseEnd: '2026-03-15',
        adsStopTime: '19:00',
      },
    ]);
    expect(plan.budgetRecommendation).toMatchObject({
      recommendedBudgetAmount: 30,
      additionalBudgetAmount: 10,
      targetExecutionMode: 'two_phase',
    });
  });

  it('combines tomorrow and last chance into closeout for medium budgets', () => {
    const plan = buildEventMediaPlan({
      startDate: '2026-03-10',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 35,
      budgetType: 'LIFETIME',
    });

    expect(plan.executionMode).toBe('two_phase');
    expect(plan.executionPhases).toEqual([
      {
        phaseType: 'run-up',
        phaseLabel: 'Warm-up',
        phaseStart: '2026-03-10',
        phaseEnd: '2026-03-13',
        adsStopTime: null,
      },
      {
        phaseType: 'closeout',
        phaseLabel: 'Closeout',
        phaseStart: '2026-03-14',
        phaseEnd: '2026-03-15',
        adsStopTime: '19:00',
      },
    ]);
    expect(plan.budgetRecommendation).toMatchObject({
      recommendedBudgetAmount: 45,
      additionalBudgetAmount: 10,
      targetExecutionMode: 'three_phase',
    });
  });

  it('uses three execution phases when lifetime budget supports them', () => {
    const plan = buildEventMediaPlan({
      startDate: '2026-03-13',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 45,
      budgetType: 'LIFETIME',
    });

    expect(plan.executionMode).toBe('three_phase');
    expect(plan.strategicPhases.map((phase) => phase.phaseLabel)).toEqual([
      'Warm-up',
      'Tomorrow Push',
      'Last Chance',
    ]);
    expect(plan.executionPhases).toHaveLength(3);
    expect(plan.budgetRecommendation).toBeNull();
  });

  it('uses lifetime-equivalent spend for daily budgets', () => {
    const mediumPlan = buildEventMediaPlan({
      startDate: '2026-03-10',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 5,
      budgetType: 'DAILY',
    });
    const highPlan = buildEventMediaPlan({
      startDate: '2026-03-10',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 8,
      budgetType: 'DAILY',
    });

    expect(mediumPlan.lifetimeEquivalentBudget).toBe(30);
    expect(mediumPlan.executionMode).toBe('two_phase');
    expect(mediumPlan.budgetRecommendation).toMatchObject({
      recommendedBudgetAmount: 8,
      additionalBudgetAmount: 3,
      targetExecutionMode: 'three_phase',
    });
    expect(highPlan.lifetimeEquivalentBudget).toBe(48);
    expect(highPlan.executionMode).toBe('three_phase');
  });

  it('throws when the start date is after the event date', () => {
    expect(() => buildEventMediaPlan({
      startDate: '2026-03-16',
      eventDate: '2026-03-15',
      adsStopTime: '19:00',
      budgetAmount: 45,
      budgetType: 'LIFETIME',
    })).toThrow(/must not be after/);
  });
});
