'use server';

/**
 * Server action for retrying failed publish jobs (PUB-05).
 * Re-queues a failed job with a fresh deduplication ID so QStash treats it as new.
 */

import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { transitionStatus } from '@/lib/publishing/state-machine';
import { dispatchToQStash } from '@/lib/publishing/dispatch';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import { evaluateTemporalDrift } from '@/lib/publishing/temporal-drift';
import { DateTime } from 'luxon';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

type PublishJobRow = {
  id: string;
  account_id: string;
  content_item_id: string;
  idempotency_key: string;
  status: string;
  retry_count: number;
  max_retries: number;
};

export async function retryPublishJob(
  jobId: string,
): Promise<{ success?: boolean; error?: string; warning?: string }> {
  const { accountId } = await requireAuthContext();
  const db = createServiceSupabaseClient();

  // Load job, verify ownership
  const { data: job, error } = await db
    .from('publish_jobs')
    .select('id, account_id, content_item_id, idempotency_key, status, retry_count, max_retries')
    .eq('id', jobId)
    .single<PublishJobRow>();

  if (error || !job) return { error: 'Publish job not found' };
  if (job.account_id !== accountId) return { error: 'Unauthorized' };
  if (job.status !== 'failed') return { error: 'Only failed jobs can be retried' };

  // Reset retry count and re-queue
  await db
    .from('publish_jobs')
    .update({
      status: 'queued',
      retry_count: 0,
      error_message: null,
      error_code: null,
    })
    .eq('id', jobId)
    .throwOnError();

  // Transition content_items to queued
  await transitionStatus(db, 'content_items', job.content_item_id, 'failed', 'queued');

  // Dispatch to QStash with fresh deduplication ID
  await dispatchToQStash({
    jobId,
    deduplicationId: `${job.idempotency_key}:retry:${Date.now()}`,
  });

  await logPublishAuditEvent({
    accountId,
    operationType: 'publish_retry',
    resourceType: 'publish_job',
    resourceId: jobId,
    details: { manual: true },
  });

  // A retry delivers now, not at the time the copy was written for, so a post
  // that failed on Thursday and is retried on Saturday can publish wording that
  // is no longer true. Warn, never block: the retry has already been dispatched
  // and stopping it would strand a failed post.
  const warning = await describeRetryDrift(db, accountId, job.content_item_id);

  return warning ? { success: true, warning } : { success: true };
}

/**
 * Does the saved copy still tell the truth if it goes out now?
 *
 * Uses the service-role client, so both reads are scoped by account explicitly.
 * Any failure here returns no warning rather than blocking the retry: this is
 * advisory, and a retry must not fail because a warning could not be computed.
 */
async function describeRetryDrift(
  db: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
  contentItemId: string,
): Promise<string | undefined> {
  try {
    const { data: item } = await db
      .from('content_items')
      .select('prompt_context')
      .eq('id', contentItemId)
      .eq('account_id', accountId)
      .maybeSingle<{ prompt_context: Record<string, unknown> | null }>();

    const { data: variant } = await db
      .from('content_variants')
      .select('body')
      .eq('content_item_id', contentItemId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ body: string | null }>();

    if (!variant?.body) return undefined;

    const drift = evaluateTemporalDrift({
      body: variant.body,
      promptContext: item?.prompt_context ?? null,
      publishAt: DateTime.now().setZone(DEFAULT_TIMEZONE),
    });

    return drift.stale ? (drift.message ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}
