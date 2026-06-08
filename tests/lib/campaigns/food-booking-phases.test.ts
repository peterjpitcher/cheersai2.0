import { describe, it, expect } from 'vitest';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import { DEFAULT_FOOD_SERVICE_HOURS } from '@/lib/campaigns/food-schedule';
import type { FoodBookingBrief } from '@/types/campaigns';

const brief = (over: Partial<FoodBookingBrief> = {}): FoodBookingBrief => ({
  services: [
    DEFAULT_FOOD_SERVICE_HOURS.weekday_dinner,
    DEFAULT_FOOD_SERVICE_HOURS.saturday_food,
    DEFAULT_FOOD_SERVICE_HOURS.sunday_roast,
  ],
  bookingUrl: 'https://book.example.com',
  foodHooks: ['Hand-carved roast'],
  weeks: 2,
  dayWeighting: 'even',
  ...over,
});

describe('calculateFoodBookingPhases', () => {
  // 2026-06-09 is a Tuesday.
  it('generates Tue-Fri weekday windows with London-local times', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const tueLunch = windows.find(w => w.runDate === '2026-06-09' && w.windowKey === 'weekday_lunch_decision');
    expect(tueLunch?.startsAtLocal).toBe('11:00');
    expect(tueLunch?.endsAtLocal).toBe('13:30');
    expect(tueLunch?.serviceKey).toBe('weekday_dinner');
  });

  it('applies the Friday 19:00 hard stop and 18:30 on other weekdays', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const friLM = windows.find(w => w.runDay === 'friday' && w.windowKey === 'weekday_last_minute');
    const tueLM = windows.find(w => w.runDay === 'tuesday' && w.windowKey === 'weekday_last_minute');
    expect(friLM?.endsAtLocal).toBe('19:00');
    expect(tueLM?.endsAtLocal).toBe('18:30');
  });

  it('disables rescue windows by default but still emits them', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    expect(windows.find(w => w.windowKey === 'weekday_last_minute')?.enabled).toBe(false);
    expect(windows.find(w => w.windowKey === 'saturday_final_nudge')?.enabled).toBe(false);
    expect(windows.find(w => w.windowKey === 'sunday_roast_last_tables')?.enabled).toBe(true);
  });

  it('schedules Sunday roast planning on the prior Friday and tomorrow on Saturday', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const planning = windows.find(w => w.windowKey === 'sunday_roast_planning');
    expect(planning?.runDay).toBe('friday');
    expect(planning?.serviceDateOffsetDays).toBe(2);
    const tomorrow = windows.find(w => w.windowKey === 'sunday_roast_tomorrow');
    expect(tomorrow?.runDay).toBe('saturday');
    expect(tomorrow?.serviceDateOffsetDays).toBe(1);
  });

  it('stops Sunday roast windows before last orders', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    const last = windows.find(w => w.windowKey === 'sunday_roast_last_tables');
    expect(last?.endsAtLocal).toBe('16:00'); // ≤ 16:30 hard stop, < 17:30 last orders
  });

  it('omits windows whose run date is before the campaign start', () => {
    // Start on Saturday 2026-06-13: the Friday planning windows for that weekend are in the past.
    const windows = calculateFoodBookingPhases(brief(), '2026-06-13');
    const pastPlanning = windows.find(w => w.runDate === '2026-06-12');
    expect(pastPlanning).toBeUndefined();
  });

  it('respects weeks=1 vs weeks=2 window counts', () => {
    const one = calculateFoodBookingPhases(brief({ weeks: 1 }), '2026-06-09');
    const two = calculateFoodBookingPhases(brief({ weeks: 2 }), '2026-06-09');
    expect(two.length).toBeGreaterThan(one.length);
  });

  it('only includes enabled services', () => {
    const windows = calculateFoodBookingPhases(
      brief({ services: [{ ...DEFAULT_FOOD_SERVICE_HOURS.sunday_roast }] }),
      '2026-06-09',
    );
    expect(windows.every(w => w.serviceKey === 'sunday_roast')).toBe(true);
  });

  it('handles the BST→GMT transition without shifting local times', () => {
    // Clocks go back on 2026-10-25. A Sunday roast that week keeps 08:30 local start.
    const windows = calculateFoodBookingPhases(brief(), '2026-10-23'); // Friday
    const morning = windows.find(w => w.runDate === '2026-10-25' && w.windowKey === 'sunday_roast_morning');
    expect(morning?.startsAtLocal).toBe('08:30');
  });

  it('clamps day-of window ends to the brief service last orders when the venue shortens hours', () => {
    // Custom roast: 12:00–16:00, last orders 15:30 (earlier than the 16:30 hard stop).
    const customRoast = {
      ...DEFAULT_FOOD_SERVICE_HOURS.sunday_roast,
      startLocal: '12:00',
      endLocal: '16:00',
      lastOrdersLocal: '15:30',
    };
    const windows = calculateFoodBookingPhases(brief({ services: [customRoast] }), '2026-06-09');

    // last_tables is a day-of window (offset 0) → end pulled back to last orders 15:30.
    const lastTables = windows.find(w => w.windowKey === 'sunday_roast_last_tables');
    expect(lastTables?.endsAtLocal).toBe('15:30');

    // The morning day-of window already ends before last orders, so it is unchanged.
    const morning = windows.find(w => w.windowKey === 'sunday_roast_morning');
    expect(morning?.endsAtLocal).toBe('11:30');
  });

  it('does not clamp day-before/planning windows by the service last orders', () => {
    // Last orders applies to the service day, not the (earlier) ad run day, so the
    // planning (offset 2) and tomorrow (offset 1) windows are bounded only by the existing
    // hard-stop logic (tomorrow's 18:00 template → 16:30 hard stop), never pulled to 15:30.
    const customRoast = {
      ...DEFAULT_FOOD_SERVICE_HOURS.sunday_roast,
      lastOrdersLocal: '15:30',
    };
    const windows = calculateFoodBookingPhases(brief({ services: [customRoast] }), '2026-06-09');
    expect(windows.find(w => w.windowKey === 'sunday_roast_planning')?.endsAtLocal).toBe('14:00');
    expect(windows.find(w => w.windowKey === 'sunday_roast_tomorrow')?.endsAtLocal).toBe('16:30');
  });

  it('leaves default service windows unchanged when no custom last orders are set (regression)', () => {
    const windows = calculateFoodBookingPhases(brief(), '2026-06-09');
    // Default roast last orders is 17:30; day-of ends (11:30 / 16:00) already sit below it,
    // and day-before windows keep their existing hard-stop-bounded ends.
    expect(windows.find(w => w.windowKey === 'sunday_roast_morning')?.endsAtLocal).toBe('11:30');
    expect(windows.find(w => w.windowKey === 'sunday_roast_last_tables')?.endsAtLocal).toBe('16:00');
    expect(windows.find(w => w.windowKey === 'sunday_roast_tomorrow')?.endsAtLocal).toBe('16:30');
  });
});
