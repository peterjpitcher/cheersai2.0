import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOOD_SERVICE_HOURS,
  DECISION_STAGE_TEMPLATES,
  lastOrdersOrDefault,
  hardStopFor,
} from '@/lib/campaigns/food-schedule';

describe('food-schedule defaults', () => {
  it('provides the three default services with doc hours', () => {
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.startLocal).toBe('16:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.endLocal).toBe('21:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner.days).toEqual(
      ['tuesday', 'wednesday', 'thursday', 'friday'],
    );
    expect(DEFAULT_FOOD_SERVICE_HOURS.saturday_food.endLocal).toBe('19:00');
    expect(DEFAULT_FOOD_SERVICE_HOURS.sunday_roast.lastOrdersLocal).toBe('17:30');
  });

  it('defaults last orders to service end minus 30 minutes', () => {
    expect(lastOrdersOrDefault({ ...DEFAULT_FOOD_SERVICE_HOURS.saturday_food, lastOrdersLocal: undefined }))
      .toBe('18:30');
  });

  it('marks rescue windows disabled by default', () => {
    const weekday = DECISION_STAGE_TEMPLATES.weekday_dinner;
    expect(weekday.find(w => w.windowKey === 'weekday_last_minute')?.defaultEnabled).toBe(false);
    const saturday = DECISION_STAGE_TEMPLATES.saturday_food;
    expect(saturday.find(w => w.windowKey === 'saturday_final_nudge')?.defaultEnabled).toBe(false);
  });

  it('applies a later Friday hard stop for weekday dinner', () => {
    expect(hardStopFor('weekday_dinner', 'friday')).toBe('19:00');
    expect(hardStopFor('weekday_dinner', 'tuesday')).toBe('18:30');
    expect(hardStopFor('sunday_roast', 'sunday')).toBe('16:30');
  });
});
