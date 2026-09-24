import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Release a brand's held posts once it may publish again (spec §4.2, D3).
 *
 * Future posts go back to the queue at their original time. Posts whose time
 * has passed stay held so nothing out of date (last week's offer, a finished
 * event) goes out late; the owner reschedules or discards them from the
 * planner (rescheduling re-queues the job and clears the hold).
 *
 * Called when a brand's entitlement is restored: the Stripe webhook (piece
 * 2.3) and the operator lifting a suspension (piece 2.11).
 */
export async function releaseHeldPublishJobs(
  service: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<{ released: number; stillHeld: number }> {
  const nowIso = now.toISOString();

  const { data: released, error: releaseError } = await service
    .from('publish_jobs')
    .update({ status: 'queued', hold_reason: null, last_error: null, updated_at: nowIso })
    .eq('account_id', accountId)
    .eq('status', 'held')
    .eq('hold_reason', 'entitlement')
    .gt('next_attempt_at', nowIso)
    .select('id');
  if (releaseError) throw new Error(`release held jobs failed: ${releaseError.message}`);

  const { count, error: countError } = await service
    .from('publish_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'held');
  if (countError) throw new Error(`count held jobs failed: ${countError.message}`);

  return { released: released?.length ?? 0, stillHeld: count ?? 0 };
}
