/**
 * Publish job queue operations (PUB-03).
 * Creates publish_jobs rows matching the actual schema and generates
 * idempotency keys to prevent duplicate publishes.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { dispatchToQStash } from './dispatch';
import type { Platform } from '@/types/content';

/** Jobs due within this window are dispatched immediately instead of waiting for the scheduler cron. */
const IMMEDIATE_THRESHOLD_MS = 60_000;

interface EnqueuePublishJobOptions {
  contentItemId: string;
  accountId: string;
  platform: Platform;
  scheduledAt: Date;
}

/**
 * Insert a publish job into the queue.
 * Generates an idempotency key from contentItemId + platform + scheduledAt
 * to prevent duplicate jobs for the same content/platform/time combination.
 * Status is 'scheduled' if scheduledAt is in the future, 'queued' if now or past.
 */
export async function enqueuePublishJob({
  contentItemId,
  accountId,
  platform,
  scheduledAt,
}: EnqueuePublishJobOptions): Promise<string> {
  const supabase = createServiceSupabaseClient();

  const idempotencyKey = `${contentItemId}:${platform}:${scheduledAt.toISOString()}`;
  const isFuture = scheduledAt.getTime() > Date.now();

  const { data, error } = await supabase
    .from('publish_jobs')
    .insert({
      account_id: accountId,
      content_item_id: contentItemId,
      platform,
      idempotency_key: idempotencyKey,
      status: isFuture ? 'scheduled' : 'queued',
      scheduled_at: scheduledAt.toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

export interface EnqueueAndDispatchResult {
  jobId: string;
  dispatched: boolean;
}

/**
 * Single entry point: create a publish_jobs row and dispatch to QStash
 * if the job is immediate or already due.
 *
 * All production code that wants to publish should call this, not
 * enqueuePublishJob() directly. The scheduler cron handles future-scheduled
 * jobs that were not dispatched here.
 */
export async function enqueueAndDispatch({
  contentItemId,
  accountId,
  platform,
  scheduledAt,
}: EnqueuePublishJobOptions): Promise<EnqueueAndDispatchResult> {
  const jobId = await enqueuePublishJob({ contentItemId, accountId, platform, scheduledAt });

  const isImmediate = scheduledAt.getTime() <= Date.now() + IMMEDIATE_THRESHOLD_MS;

  if (isImmediate) {
    const idempotencyKey = `${contentItemId}:${platform}:${scheduledAt.toISOString()}`;
    await dispatchToQStash({ jobId, deduplicationId: idempotencyKey });
    return { jobId, dispatched: true };
  }

  return { jobId, dispatched: false };
}

/**
 * Update the status of a content item.
 * Used after scheduling or queue operations to keep content_items.status in sync.
 */
export async function markContentStatus(
  contentItemId: string,
  status: 'scheduled' | 'queued',
): Promise<void> {
  const supabase = createServiceSupabaseClient();

  await supabase
    .from('content_items')
    .update({ status })
    .eq('id', contentItemId)
    .throwOnError();
}
