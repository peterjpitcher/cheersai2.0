import { describe, it, expect } from 'vitest';
import { computeStaggerOffset, computeScheduledFor, formatRoundLabel } from './generate';

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

describe('formatRoundLabel', () => {
  it('should return "Group B" when groupName is "B"', () => {
    expect(formatRoundLabel('group_stage', 'B')).toBe('Group B');
  });

  it('should strip leading "Group " to prevent double-prefix', () => {
    expect(formatRoundLabel('group_stage', 'Group B')).toBe('Group B');
  });

  it('should strip case-insensitively', () => {
    expect(formatRoundLabel('group_stage', 'group C')).toBe('Group C');
    expect(formatRoundLabel('group_stage', 'GROUP A')).toBe('Group A');
  });

  it('should handle whitespace around the prefix', () => {
    expect(formatRoundLabel('group_stage', '  Group  D ')).toBe('Group D');
  });

  it('should return ROUND_LABELS value for non-group rounds', () => {
    expect(formatRoundLabel('round_of_16', null)).toBe('Round of 16');
    expect(formatRoundLabel('quarter_final', null)).toBe('Quarter-Final');
    expect(formatRoundLabel('semi_final', null)).toBe('Semi-Final');
    expect(formatRoundLabel('final', null)).toBe('Final');
  });

  it('should fall back to raw round string for unknown rounds', () => {
    expect(formatRoundLabel('playoff', null)).toBe('playoff');
  });

  it('should use ROUND_LABELS when group_stage has no groupName', () => {
    expect(formatRoundLabel('group_stage', null)).toBe('Group');
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
