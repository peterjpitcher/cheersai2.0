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

type PublishJobRow = {
  id: string;
  account_id: string;
  content_item_id: string;
  idempotency_key: string;
  status: string;
  retry_count: number;
  max_retries: number;
};

export async function retryPublishJob(jobId: string): Promise<{ success?: boolean; error?: string }> {
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

  return { success: true };
}
