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

  it('uses neutral booking copyIntents with no scarcity language (D11)', () => {
    // False-urgency phrasing ("fills up", "while ... remain/last", "selling fast") is not
    // permitted in the seeded copy intents — they must be plain booking prompts.
    const scarcityPattern = /\b(fill(?:s|ing)?\s+up|fills|while\s+tables\s+remain|while\s+(?:stocks|seats|tables)\s+last|selling\s+fast|hurry|don'?t\s+miss\s+out|last\s+few|nearly\s+(?:full|gone)|before\s+(?:it|they|we|the\s+weekend)\s+(?:fill|sell|book))/i;

    const allTemplates = Object.values(DECISION_STAGE_TEMPLATES).flat();
    for (const template of allTemplates) {
      expect(
        scarcityPattern.test(template.copyIntent),
        `copyIntent for ${template.windowKey} should not contain scarcity language: "${template.copyIntent}"`,
      ).toBe(false);
    }

    // Specifically the two previously-scarcity Sunday roast windows now read neutrally.
    const roast = DECISION_STAGE_TEMPLATES.sunday_roast;
    expect(roast.find(w => w.windowKey === 'sunday_roast_planning')?.copyIntent)
      .toBe('Book Sunday roast for this weekend.');
    expect(roast.find(w => w.windowKey === 'sunday_roast_last_tables')?.copyIntent)
      .toBe('Last orders 5:30pm — book your table for Sunday roast.');
  });
});
