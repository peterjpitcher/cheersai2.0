import { describe, it, expect } from 'vitest';
import { buildTemporalInstructions } from '@/lib/ai/temporal-instructions';

describe('buildTemporalInstructions', () => {
  it('returns event-day narrative purpose without issuing date wording', () => {
    const result = buildTemporalInstructions('Event day');
    expect(result).toContain('day of the event');
    expect(result).toContain('timing block');
    // The timing block owns every date claim, so this must not name one.
    expect(result).not.toMatch(/\btomorrow\b|\btonight\b/i);
  });

  it('defers the countdown to the timing block for N days to go', () => {
    const result = buildTemporalInstructions('2 days to go');
    expect(result).toContain('remaining time');
    expect(result).toContain('timing block');
    // Previously said "just 2 days away", contradicting the timing block.
    expect(result).not.toContain('2 days away');
  });

  it('defers the countdown to the timing block for N weeks to go', () => {
    const result = buildTemporalInstructions('1 week to go');
    expect(result).toContain('remaining time');
    expect(result).not.toContain('1 weeks away');
  });

  it('returns urgency instruction for Last chance', () => {
    const result = buildTemporalInstructions('Last chance');
    expect(result).toContain('deadline');
  });

  it('returns lead-up purpose for hype labels without a countdown', () => {
    const result = buildTemporalInstructions('Hype week');
    expect(result).toContain('lead-up post');
    expect(result).toContain('without stating a countdown');
  });

  it('returns lead-up purpose for week labels without a countdown', () => {
    const result = buildTemporalInstructions('Week 3');
    expect(result).toContain('lead-up post');
    expect(result).toContain('Week 3');
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
