/**
 * Content lifecycle state machine (PUB-01).
 * Enforces valid transitions between 7 content statuses.
 * Guards against invalid state changes and concurrent modifications.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentStatus } from '@/types/content';

/**
 * Valid transitions map for the content lifecycle.
 * Terminal state: published (no outgoing transitions).
 * Recovery: failed -> queued (retry re-queues).
 */
export const VALID_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['review'],
  review: ['approved', 'draft'],
  approved: ['scheduled', 'queued'],
  scheduled: ['queued'],
  queued: ['publishing'],
  publishing: ['published', 'failed'],
  published: [],
  failed: ['queued'],
};

/** Check whether a transition from one status to another is allowed. */
export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Atomically transition a row's status in the database.
 * Uses optimistic concurrency: the UPDATE includes a WHERE status = from clause,
 * so if another process already changed the status, the update matches zero rows.
 *
 * @throws Error if the transition is not valid per VALID_TRANSITIONS
 * @throws Error if no row matched (concurrent modification or missing row)
 */
export async function transitionStatus(
  db: SupabaseClient,
  table: 'content_items' | 'publish_jobs',
  id: string,
  from: ContentStatus,
  to: ContentStatus,
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition from ${from} to ${to}`);
  }

  const { data, error } = await db
    .from(table)
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', from)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to transition ${table} ${id} from ${from} to ${to}: ${error?.message ?? 'no matching row (concurrent modification?)'}`,
    );
  }
}
