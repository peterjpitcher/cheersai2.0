/**
 * Batched copy generation for the create wizard.
 *
 * Long weekly runs (up to 52 occurrences) generate a page at a time so the owner
 * isn't waiting on — or reviewing — dozens of AI drafts before they can start
 * approving. This module holds the pure batch-selection logic; the wizard's
 * GenerateStep drives the actual per-slot generation.
 */

/** How many slots to generate per batch. */
export const GENERATION_BATCH_SIZE = 12;

/**
 * Pick the next batch of slot keys to generate: the first `batchSize` slots that
 * don't already have ready copy, in the given order.
 */
export function selectNextGenerationBatch(
  slotKeys: string[],
  readyKeys: Set<string>,
  batchSize: number,
): string[] {
  return slotKeys.filter((key) => !readyKeys.has(key)).slice(0, batchSize);
}
