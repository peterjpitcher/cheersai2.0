import { describe, it, expect } from 'vitest';
import { DateTime, Settings } from 'luxon';

import { buildWeeklyMultiDaySuggestions } from './suggestion-utils';

const TZ = 'Europe/London';

/** Pin Luxon's "now" so the min-slot / anchor logic is deterministic. */
function withNow<T>(iso: string, fn: () => T): T {
  const original = Settings.now;
  const fixed = DateTime.fromISO(iso, { zone: TZ }).toMillis();
  Settings.now = () => fixed;
  try {
    return fn();
  } finally {
    Settings.now = original;
  }
}

describe('buildWeeklyMultiDaySuggestions', () => {
  it('generates one occurrence per selected weekday up to and including the end date', () => {
    // Wed 2026-07-01 09:00 → pick Mon(1)+Thu(4), end Sun 2026-07-19 (inclusive)
    const slots = withNow('2026-07-01T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-01',
        daysOfWeek: [1, 4],
        time: '18:00',
        endDate: '2026-07-19',
        timezone: TZ,
      }),
    );
    // Thu 2/7, Mon 6/7, Thu 9/7, Mon 13/7, Thu 16/7 (Mon 20/7 is past end) → 5
    expect(slots.map((s) => s.date)).toEqual([
      '2026-07-02', '2026-07-06', '2026-07-09', '2026-07-13', '2026-07-16',
    ]);
  });

  it('uses date-unique ids and weekday·week labels', () => {
    const slots = withNow('2026-07-01T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-01', daysOfWeek: [1, 4], time: '18:00', endDate: '2026-07-13', timezone: TZ,
      }),
    );
    expect(slots[0]).toMatchObject({ id: 'weekly-2026-07-02', time: '18:00', label: 'Thursday · Week 1' });
    expect(slots.find((s) => s.date === '2026-07-06')?.label).toBe('Monday · Week 2');
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
  });

  it('skips occurrences earlier than now + 15 minutes', () => {
    // now = Thu 2026-07-02 18:10; today's 18:00 Thursday slot is already past
    const slots = withNow('2026-07-02T18:10:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-02', daysOfWeek: [4], time: '18:00', endDate: '2026-07-16', timezone: TZ,
      }),
    );
    expect(slots.map((s) => s.date)).toEqual(['2026-07-09', '2026-07-16']);
  });

  it('returns empty when the end date is before the first occurrence', () => {
    const slots = withNow('2026-07-10T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-07-10', daysOfWeek: [1], time: '18:00', endDate: '2026-07-05', timezone: TZ,
      }),
    );
    expect(slots).toEqual([]);
  });

  it('holds wall-clock time across a BST→GMT boundary', () => {
    // Clocks go back Sun 2026-10-25. A Monday 19:00 slot stays 19:00 both sides.
    const slots = withNow('2026-10-19T09:00:00', () =>
      buildWeeklyMultiDaySuggestions({
        startDate: '2026-10-19', daysOfWeek: [1], time: '19:00', endDate: '2026-11-02', timezone: TZ,
      }),
    );
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      '2026-10-19 19:00', '2026-10-26 19:00', '2026-11-02 19:00',
    ]);
  });
});
