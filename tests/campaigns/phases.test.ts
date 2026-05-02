import { describe, it, expect } from 'vitest';
import { calculateEvergreenPhases, calculateInclusiveDurationDays, calculatePhases } from '@/lib/campaigns/phases';

describe('calculatePhases', () => {
  it('returns 3 phases when campaign starts 3+ days before event', () => {
    const phases = calculatePhases('2026-03-10', '2026-03-15', '19:00');
    expect(phases).toHaveLength(3);
    expect(phases[0].phaseLabel).toBe('Run-up');
    expect(phases[1].phaseLabel).toBe('Day Before');
    expect(phases[2].phaseLabel).toBe('Day Of');
  });

  it('Run-up ends 2 days before event', () => {
    const phases = calculatePhases('2026-03-10', '2026-03-15', '19:00');
    expect(phases[0].phaseStart).toBe('2026-03-10');
    expect(phases[0].phaseEnd).toBe('2026-03-13'); // event - 2 days
  });

  it('Day Before is exactly 1 day before event', () => {
    const phases = calculatePhases('2026-03-10', '2026-03-15', '19:00');
    expect(phases[1].phaseStart).toBe('2026-03-14');
    expect(phases[1].phaseEnd).toBeNull();
  });

  it('Day Of is the event date with adsStopTime', () => {
    const phases = calculatePhases('2026-03-10', '2026-03-15', '19:00');
    expect(phases[2].phaseStart).toBe('2026-03-15');
    expect(phases[2].phaseEnd).toBeNull();
    expect(phases[2].adsStopTime).toBe('19:00');
    expect(phases[2].phaseType).toBe('day-of');
  });

  it('returns 2 phases (Day Before + Day Of) when campaign starts 2 days before event', () => {
    const phases = calculatePhases('2026-03-13', '2026-03-15', '20:00');
    expect(phases).toHaveLength(2);
    expect(phases[0].phaseLabel).toBe('Day Before');
    expect(phases[1].phaseLabel).toBe('Day Of');
  });

  it('returns 2 phases when campaign starts 1 day before event (start = event - 1)', () => {
    const phases = calculatePhases('2026-03-14', '2026-03-15', '20:00');
    expect(phases).toHaveLength(2);
    expect(phases[0].phaseLabel).toBe('Day Before');
    expect(phases[1].phaseLabel).toBe('Day Of');
  });

  it('returns 1 phase (Day Of only) when campaign starts on event day', () => {
    const phases = calculatePhases('2026-03-15', '2026-03-15', '20:00');
    expect(phases).toHaveLength(1);
    expect(phases[0].phaseLabel).toBe('Day Of');
  });

  it('throws when startDate is after eventDate', () => {
    expect(() => calculatePhases('2026-03-20', '2026-03-15', '19:00')).toThrow();
  });

  it('creates a single evergreen test phase', () => {
    const phases = calculateEvergreenPhases('2026-03-01', '2026-03-30');
    expect(phases).toEqual([
      {
        phaseType: 'evergreen',
        phaseLabel: 'Evergreen Test',
        phaseStart: '2026-03-01',
        phaseEnd: '2026-03-30',
        adsStopTime: null,
      },
    ]);
  });

  it('caps evergreen campaigns at 30 inclusive days', () => {
    expect(calculateInclusiveDurationDays('2026-03-01', '2026-03-30')).toBe(30);
    expect(() => calculateEvergreenPhases('2026-03-01', '2026-03-31')).toThrow(/30 days/);
  });
});

import { toLondonDateTime, toMidnightLondon, toNextMidnightLondon } from '@/lib/campaigns/time-utils';

describe('toMidnightLondon', () => {
  it('returns midnight UTC for a GMT date (March, no BST offset)', () => {
    // 10 March 2026 is in GMT — London midnight = 00:00 UTC same day
    expect(toMidnightLondon('2026-03-10')).toBe('2026-03-10T00:00:00.000Z');
  });

  it('returns 23:00 UTC previous day for a BST date (July, UTC+1)', () => {
    // 10 July 2026 is in BST — London midnight = 23:00 UTC previous day
    expect(toMidnightLondon('2026-07-10')).toBe('2026-07-09T23:00:00.000Z');
  });

  it('handles the BST transition date (29 March 2026 — clocks go forward)', () => {
    // Clocks go forward at 01:00 local (01:00 UTC). At midnight London, BST has not yet
    // started — London is still in GMT (UTC+0). Midnight London = 00:00 UTC same day.
    expect(toMidnightLondon('2026-03-29')).toBe('2026-03-29T00:00:00.000Z');
  });

  it('handles the GMT transition date (25 October 2026 — clocks go back)', () => {
    // Clocks go back at 02:00 local (01:00 UTC). At midnight London, BST is still in
    // effect — London is at UTC+1. Midnight London = 23:00 UTC previous day.
    expect(toMidnightLondon('2026-10-25')).toBe('2026-10-24T23:00:00.000Z');
  });

  it('converts a London event stop time to UTC', () => {
    expect(toLondonDateTime('2026-05-15', '19:00')).toBe('2026-05-15T18:00:00.000Z');
  });

  it('returns the next London midnight for inclusive phase end dates', () => {
    expect(toNextMidnightLondon('2026-05-13')).toBe('2026-05-13T23:00:00.000Z');
  });
});
