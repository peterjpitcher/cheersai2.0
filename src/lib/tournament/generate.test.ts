import { describe, it, expect } from 'vitest';
import { computeStaggerOffset, computeScheduledFor } from './generate';

describe('computeStaggerOffset', () => {
  it('should return 0 for the first fixture at a given time', () => {
    expect(computeStaggerOffset(0)).toBe(0);
  });

  it('should stagger by 5 minutes per index', () => {
    expect(computeStaggerOffset(1)).toBe(5 * 60 * 1000);
    expect(computeStaggerOffset(2)).toBe(10 * 60 * 1000);
    expect(computeStaggerOffset(3)).toBe(15 * 60 * 1000);
  });
});

describe('computeScheduledFor', () => {
  it('should subtract lead hours from kick-off', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 0);
    expect(result).toEqual(new Date('2026-06-13T19:00:00Z'));
  });

  it('should add stagger offset', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 1);
    expect(result).toEqual(new Date('2026-06-13T19:05:00Z'));
  });
});
