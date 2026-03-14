import { describe, it, expect } from 'vitest';
import { calculatePhases } from '@/lib/campaigns/phases';

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
});
