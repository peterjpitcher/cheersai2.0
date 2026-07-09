import { describe, it, expect } from 'vitest';

import {
  GENERATION_BATCH_SIZE,
  selectNextGenerationBatch,
} from '@/features/create/steps/generation-batch';

const keys = (n: number) => Array.from({ length: n }, (_, i) => `slot-${i + 1}`);

describe('selectNextGenerationBatch', () => {
  it('returns the first batchSize slots when none are ready', () => {
    const batch = selectNextGenerationBatch(keys(52), new Set(), 12);
    expect(batch).toHaveLength(12);
    expect(batch[0]).toBe('slot-1');
    expect(batch[11]).toBe('slot-12');
  });

  it('skips slots that already have ready copy', () => {
    const ready = new Set(['slot-1', 'slot-2', 'slot-3']);
    const batch = selectNextGenerationBatch(keys(52), ready, 12);
    expect(batch).toHaveLength(12);
    expect(batch).not.toContain('slot-1');
    expect(batch[0]).toBe('slot-4');
  });

  it('returns fewer than batchSize when few remain', () => {
    const ready = new Set(keys(48));
    const batch = selectNextGenerationBatch(keys(52), ready, 12);
    expect(batch).toEqual(['slot-49', 'slot-50', 'slot-51', 'slot-52']);
  });

  it('returns an empty batch when every slot is ready', () => {
    const batch = selectNextGenerationBatch(keys(12), new Set(keys(12)), 12);
    expect(batch).toEqual([]);
  });

  it('generates everything in one batch when the run fits the batch size', () => {
    const batch = selectNextGenerationBatch(keys(8), new Set(), GENERATION_BATCH_SIZE);
    expect(batch).toHaveLength(8);
  });

  it('preserves order (so pages are contiguous and predictable)', () => {
    const ready = new Set(['slot-2', 'slot-5']);
    const batch = selectNextGenerationBatch(keys(6), ready, 3);
    expect(batch).toEqual(['slot-1', 'slot-3', 'slot-4']);
  });
});
