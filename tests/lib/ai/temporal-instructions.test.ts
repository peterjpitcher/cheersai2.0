import { describe, it, expect } from 'vitest';
import { buildTemporalInstructions } from '@/lib/ai/temporal-instructions';

describe('buildTemporalInstructions', () => {
  it('returns present-tense instruction for Event day', () => {
    const result = buildTemporalInstructions('Event day');
    expect(result).toContain('present tense');
    expect(result).toContain('today');
  });

  it('returns countdown instruction for N days to go', () => {
    const result = buildTemporalInstructions('2 days to go');
    expect(result).toContain('remaining time');
  });

  it('returns countdown instruction for N weeks to go', () => {
    const result = buildTemporalInstructions('1 week to go');
    expect(result).toContain('remaining time');
  });

  it('returns urgency instruction for Last chance', () => {
    const result = buildTemporalInstructions('Last chance');
    expect(result).toContain('deadline');
  });

  it('returns forward-looking instruction for hype labels', () => {
    const result = buildTemporalInstructions('Hype week');
    expect(result).toContain('forward-looking');
  });

  it('returns forward-looking instruction for week labels', () => {
    const result = buildTemporalInstructions('Week 3');
    expect(result).toContain('forward-looking');
  });

  it('returns generic slot purpose for unknown labels', () => {
    const result = buildTemporalInstructions('Custom label');
    expect(result).toContain('Custom label');
    expect(result).toContain('narrative moment');
  });

  it('returns empty string for undefined label', () => {
    const result = buildTemporalInstructions(undefined);
    expect(result).toBe('');
  });

  it('returns empty string for empty string label', () => {
    const result = buildTemporalInstructions('');
    expect(result).toBe('');
  });
});
