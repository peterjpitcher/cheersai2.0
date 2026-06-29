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
  placement?: 'feed' | 'story';
  variantId?: string | null;
}

type QueueSchemaMode = 'v2' | 'legacy-bridge';

let queueSchemaModeCache: QueueSchemaMode | null = null;

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
  placement = 'feed',
  variantId,
}: EnqueuePublishJobOptions): Promise<string> {
  const supabase = createServiceSupabaseClient();

  const idempotencyKey = `${contentItemId}:${platform}:${scheduledAt.toISOString()}`;
  const isFuture = scheduledAt.getTime() > Date.now();
  const schemaMode = await detectQueueSchemaMode(supabase);

  if (schemaMode === 'legacy-bridge') {
    const resolvedVariantId = await resolveVariantId({
      supabase,
      contentItemId,
      variantId,
    });

    const { data, error } = await supabase
      .from('publish_jobs')
      .insert({
        account_id: accountId,
        content_item_id: contentItemId,
        idempotency_key: idempotencyKey,
        scheduled_at: scheduledAt.toISOString(),
        next_attempt_at: scheduledAt.toISOString(),
        status: 'queued',
        placement,
        variant_id: resolvedVariantId,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id as string;
  }

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

async function detectQueueSchemaMode(supabase: ReturnType<typeof createServiceSupabaseClient>): Promise<QueueSchemaMode> {
  if (queueSchemaModeCache) return queueSchemaModeCache;

  const { error } = await supabase
    .from('publish_jobs')
    .select('platform')
    .limit(0);

  if (error) {
    if (error.code === '42703' || /column .*platform.* does not exist/i.test(error.message)) {
      queueSchemaModeCache = 'legacy-bridge';
      return queueSchemaModeCache;
    }
    throw error;
  }

  queueSchemaModeCache = 'v2';
  return queueSchemaModeCache;
}

async function resolveVariantId({
  supabase,
  contentItemId,
  variantId,
}: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  contentItemId: string;
  variantId?: string | null;
}): Promise<string> {
  if (variantId) return variantId;

  const { data, error } = await supabase
    .from('content_variants')
    .select('id')
    .eq('content_item_id', contentItemId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw new Error(`Publish job cannot be created because content item ${contentItemId} has no content variant.`);
  }

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
  placement,
  variantId,
}: EnqueuePublishJobOptions): Promise<EnqueueAndDispatchResult> {
  const jobId = await enqueuePublishJob({
    contentItemId,
    accountId,
    platform,
    scheduledAt,
    placement,
    variantId,
  });

  const isImmediate = scheduledAt.getTime() <= Date.now() + IMMEDIATE_THRESHOLD_MS;
  if (!isImmediate) {
    return { jobId, dispatched: false };
  }

  // The QStash webhook worker (src/lib/publishing/handler.ts) only understands
  // the v2 schema (publish_jobs.platform). In legacy-bridge mode it cannot
  // process the job, so dispatching here would only burn QStash retries.
  // Instead the publish-scheduler cron invokes the edge-function worker, which
  // drains queued jobs due within its lead window (≈1 min) — covering immediate
  // posts too. Only dispatch to QStash when the v2 worker can actually run.
  const supabase = createServiceSupabaseClient();
  const schemaMode = await detectQueueSchemaMode(supabase);
  if (schemaMode === 'legacy-bridge') {
    return { jobId, dispatched: false };
  }

  const idempotencyKey = `${contentItemId}:${platform}:${scheduledAt.toISOString()}`;
  await dispatchToQStash({ jobId, deduplicationId: idempotencyKey });
  return { jobId, dispatched: true };
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
