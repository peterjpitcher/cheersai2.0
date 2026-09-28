import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST puts `in` filters in the URL, so long id lists go in batches. */
const ID_BATCH = 100;

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_BATCH) out.push(items.slice(i, i + ID_BATCH));
  return out;
}

/**
 * Release a brand's held posts once it may publish again (spec §4.2, D3).
 *
 * Future posts go back to the queue at their original time. Posts whose time
 * has passed stay held so nothing out of date (last week's offer, a finished
 * event) goes out late; the owner reschedules or discards them from the
 * planner (rescheduling re-queues the job and clears the hold).
 *
 * Only jobs whose post is approved ("scheduled") and not deleted are released.
 * Offboarding turns scheduled posts back into drafts and holds their jobs; the
 * publish worker refuses a draft's job (CONTENT_NOT_PUBLISHABLE) and emails the
 * owner a failure for each one, so those jobs stay held until the draft is
 * approved again (approval re-arms a held job).
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

  const { data: candidates, error: candidatesError } = await service
    .from('publish_jobs')
    .select('id, content_item_id')
    .eq('account_id', accountId)
    .eq('status', 'held')
    .eq('hold_reason', 'entitlement')
    .gt('next_attempt_at', nowIso)
    .returns<Array<{ id: string; content_item_id: string | null }>>();
  if (candidatesError) throw new Error(`read held jobs failed: ${candidatesError.message}`);

  const jobs = candidates ?? [];
  const contentIds = [...new Set(jobs.map((job) => job.content_item_id).filter((id): id is string => Boolean(id)))];
  const publishable = new Set<string>();
  for (const ids of batches(contentIds)) {
    const { data: posts, error: postsError } = await service
      .from('content_items')
      .select('id')
      .eq('account_id', accountId)
      .in('id', ids)
      .eq('status', 'scheduled')
      .is('deleted_at', null)
      .returns<Array<{ id: string }>>();
    if (postsError) throw new Error(`read held posts failed: ${postsError.message}`);
    for (const post of posts ?? []) publishable.add(post.id);
  }

  const releasable = jobs.filter((job) => job.content_item_id && publishable.has(job.content_item_id)).map((job) => job.id);
  let released = 0;
  for (const ids of batches(releasable)) {
    const { data, error: releaseError } = await service
      .from('publish_jobs')
      .update({ status: 'queued', hold_reason: null, last_error: null, updated_at: nowIso })
      .eq('account_id', accountId)
      .eq('status', 'held')
      .in('id', ids)
      .select('id');
    if (releaseError) throw new Error(`release held jobs failed: ${releaseError.message}`);
    released += data?.length ?? 0;
  }

  const { count, error: countError } = await service
    .from('publish_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'held');
  if (countError) throw new Error(`count held jobs failed: ${countError.message}`);

  return { released, stillHeld: count ?? 0 };
}
