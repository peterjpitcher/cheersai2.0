/**
 * Core publish pipeline handler (PUB-01, PUB-02, PUB-04).
 * Implements the full idempotent pipeline:
 * load job -> guard duplicates -> transition states -> call adapter -> record result -> audit.
 *
 * Called by the QStash webhook route. Returns 500 on failure so QStash retries.
 */

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { createLogger } from '@/lib/logging';
import { getCorrelationId } from '@/lib/logging/correlation';
import { getAdapter } from '@/lib/providers/registry';
import { initializeProviderRegistry } from '@/lib/providers/init';
import { isGbpAdapter } from '@/lib/providers/types';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';
import { transitionStatus } from './state-machine';
import { logPublishAuditEvent } from './audit';
import { resolveMediaUrls } from './resolve-media-urls';
import type { ContentPayload } from '@/types/providers';
import type { ProviderPlatform } from '@/types/providers';

const logger = createLogger('publish-handler');

interface PublishJobRow {
  id: string;
  account_id: string;
  content_item_id: string;
  platform: ProviderPlatform;
  status: string;
  retry_count: number;
  max_retries: number;
  scheduled_at: string;
}

interface ProcessResult {
  published?: boolean;
  alreadyDone?: boolean;
  platformPostId?: string;
}

/**
 * Process a single publish job. Implements two-layer idempotency:
 * 1. QStash deduplicationId (prevents duplicate dispatch)
 * 2. publish_attempts UNIQUE(publish_job_id, attempt_number) constraint (prevents duplicate execution)
 *
 * @throws Error on adapter failure (so webhook returns 500 and QStash retries)
 */
export async function processPublishJob(jobId: string): Promise<ProcessResult> {
  const db = createServiceSupabaseClient();

  // Step 1: Load the publish job
  const { data: job, error: jobError } = await db
    .from('publish_jobs')
    .select('id, account_id, content_item_id, platform, status, retry_count, max_retries, scheduled_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Publish job not found: ${jobId}`);
  }

  const typedJob = job as PublishJobRow;

  // Step 2: Short-circuit if already published
  if (typedJob.status === 'published') {
    logger.info('Job already published, skipping', { jobId });
    return { alreadyDone: true };
  }

  // Step 3: Calculate attempt number and insert publish_attempt (idempotency layer 2)
  const attemptNumber = typedJob.retry_count + 1;

  const { data: attemptData, error: attemptError } = await db
    .from('publish_attempts')
    .insert({
      publish_job_id: jobId,
      account_id: typedJob.account_id,
      attempt_number: attemptNumber,
      status: 'started',
    })
    .select('id')
    .single();

  // 23505 = UNIQUE constraint violation -- this attempt already ran
  if (attemptError && 'code' in attemptError && attemptError.code === '23505') {
    logger.info('Duplicate attempt detected, skipping', { jobId, attemptNumber });
    return { alreadyDone: true };
  }

  if (attemptError || !attemptData) {
    throw new Error(`Failed to create publish attempt: ${attemptError?.message ?? 'unknown error'}`);
  }

  const attemptId = (attemptData as { id: string }).id;

  // Step 4: Transition publish_jobs queued -> publishing
  await transitionStatus(db, 'publish_jobs', jobId, typedJob.status as 'queued', 'publishing');

  // Step 5: Transition content_items to publishing
  const { data: contentItem } = await db
    .from('content_items')
    .select('id, content_type, status')
    .eq('id', typedJob.content_item_id)
    .single();

  if (contentItem) {
    await transitionStatus(db, 'content_items', typedJob.content_item_id, contentItem.status as 'queued', 'publishing');
  }

  // Step 6: Audit the attempt
  await logPublishAuditEvent({
    accountId: typedJob.account_id,
    operationType: 'publish_attempt',
    resourceType: 'publish_job',
    resourceId: jobId,
    details: { attemptNumber, platform: typedJob.platform, correlationId: getCorrelationId() },
  });

  // Step 7: Initialize adapter registry and get adapter
  initializeProviderRegistry();
  const adapter = getAdapter(typedJob.platform);

  // Step 8: Load social connection for this account + platform
  const { data: connection, error: connError } = await db
    .from('social_connections')
    .select('id')
    .eq('account_id', typedJob.account_id)
    .eq('provider', typedJob.platform)
    .single();

  if (connError || !connection) {
    throw new Error(`No active connection found for ${typedJob.platform}`);
  }

  const connectionId = (connection as { id: string }).id;

  // Step 9: Build content payload from content_items + content_variants
  const payload = await buildContentPayload(db, typedJob.content_item_id, typedJob.platform);

  // Step 10: Call the adapter
  try {
    // Validate payload inside the publish try/catch so validation failures are
    // recorded on the attempt/job instead of escaping without state updates.
    const validation = adapter.validate(payload);
    if (!validation.valid) {
      const errorMsg = `Content validation failed: ${validation.errors.map((e) => e.message).join('; ')}`;
      throw new ProviderError(
        errorMsg,
        typedJob.platform,
        ErrorClassification.CONTENT_REJECTED,
        false, // not retryable -- content must be fixed
      );
    }

    let result;
    const contentType = payload.contentType;

    if (contentType === 'story' && adapter.publishStory) {
      result = await adapter.publishStory(connectionId, payload);
    } else if (isGbpAdapter(adapter) && contentType === 'event') {
      result = await adapter.publishEvent(connectionId, payload);
    } else if (isGbpAdapter(adapter) && contentType === 'promotion') {
      result = await adapter.publishOffer(connectionId, payload);
    } else {
      result = await adapter.publishPost(connectionId, payload);
    }

    // Step 11: Record success
    await db.from('publish_attempts').update({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      platform_response: result,
    }).eq('id', attemptId).single();

    await db.from('publish_jobs').update({
      status: 'published',
      completed_at: new Date().toISOString(),
      platform_post_id: result.platformPostId,
    }).eq('id', jobId).single();

    await db.from('content_items').update({
      status: 'published',
    }).eq('id', typedJob.content_item_id).single();

    await logPublishAuditEvent({
      accountId: typedJob.account_id,
      operationType: 'publish_success',
      resourceType: 'publish_job',
      resourceId: jobId,
      details: { platformPostId: result.platformPostId, attemptNumber },
    });

    logger.info('Publish succeeded', { jobId, platformPostId: result.platformPostId });
    return { published: true, platformPostId: result.platformPostId };

  } catch (error) {
    // Step 12: Record failure
    const isProviderError = error instanceof ProviderError;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = isProviderError ? error.classification : 'unknown';
    const retryable = isProviderError ? error.retryable : true;
    const errorDetails = {
      message: errorMessage,
      classification: errorCode,
      retryable,
      platform: typedJob.platform,
    };

    await db.from('publish_attempts').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_details: errorDetails,
    }).eq('id', attemptId).single();

    if (!retryable || attemptNumber >= typedJob.max_retries) {
      // Non-retryable failure or max retries exhausted -- mark as failed
      await db.from('publish_jobs').update({
        status: 'failed',
        error_message: errorMessage,
        error_code: errorCode,
        retry_count: attemptNumber,
      }).eq('id', jobId).single();

      await db.from('content_items').update({
        status: 'failed',
      }).eq('id', typedJob.content_item_id).single();

      await logPublishAuditEvent({
        accountId: typedJob.account_id,
        operationType: 'publish_failure',
        resourceType: 'publish_job',
        resourceId: jobId,
        details: { ...errorDetails, attemptNumber, maxRetries: typedJob.max_retries },
      });
    } else {
      // Re-queue for retry
      await db.from('publish_jobs').update({
        status: 'queued',
        retry_count: attemptNumber,
        error_message: errorMessage,
      }).eq('id', jobId).single();

      await db.from('content_items').update({
        status: 'queued',
      }).eq('id', typedJob.content_item_id).single();

      await logPublishAuditEvent({
        accountId: typedJob.account_id,
        operationType: 'publish_retry',
        resourceType: 'publish_job',
        resourceId: jobId,
        details: { ...errorDetails, attemptNumber, nextAttempt: attemptNumber + 1 },
      });
    }

    logger.error('Publish failed', error instanceof Error ? error : new Error(errorMessage), {
      jobId,
      attemptNumber,
      maxRetries: typedJob.max_retries,
    });

    // Re-throw so webhook returns 500 and QStash retries
    throw error;
  }
}

/** Row shape for content_items query in buildContentPayload */
interface ContentItemMetadata {
  content_type: string;
  title: string | null;
  event_date: string | null;
  event_end_date: string | null;
  coupon_code: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  placement: 'feed' | 'story' | null;
}

interface CampaignMetadataRow {
  name: string | null;
  campaign_type: string | null;
  metadata: Record<string, unknown> | null;
}

/** Row shape for content_variants query */
interface ContentVariantRow {
  body: string | null;
  media_ids: string[] | null;
  platform: string | null;
  preview_data: Record<string, unknown> | null;
}

/**
 * Build a ContentPayload from content_items + content_variants data.
 * Signs media URLs via Supabase storage for provider consumption.
 * Populates eventDetails and offerDetails from campaign metadata for GBP.
 */
async function buildContentPayload(
  db: ReturnType<typeof createServiceSupabaseClient>,
  contentItemId: string,
  platform: ProviderPlatform,
): Promise<ContentPayload> {
  // Load the latest content variant (prefer platform-specific variant)
  const { data: variants } = await db
    .from('content_variants')
    .select('body, media_ids, platform, preview_data')
    .eq('content_item_id', contentItemId)
    .order('updated_at', { ascending: false })
    .limit(10);

  // Prefer the platform-specific variant, fall back to first available
  const allVariants = (variants ?? []) as ContentVariantRow[];
  const variant = allVariants.find((v) => v.platform === platform)
    ?? allVariants[0]
    ?? null;

  // Load content item for type info and campaign metadata
  const { data: item } = await db
    .from('content_items')
    .select('content_type, title, event_date, event_end_date, coupon_code, campaign_name, campaign_id, placement')
    .eq('id', contentItemId)
    .single();

  const metadata = item as ContentItemMetadata | null;
  const contentType = (metadata?.content_type ?? 'instant_post') as ContentPayload['contentType'];
  const text = (variant?.body as string) ?? '';
  const mediaIds = (variant?.media_ids as string[]) ?? [];

  let campaign: CampaignMetadataRow | null = null;
  if (metadata?.campaign_id) {
    const { data: campaignData } = await db
      .from('campaigns')
      .select('name, campaign_type, metadata')
      .eq('id', metadata.campaign_id)
      .maybeSingle();

    campaign = campaignData as CampaignMetadataRow | null;
  }

  // Determine placement from content type
  const placement: 'feed' | 'story' =
    contentType === 'story' || metadata?.placement === 'story' ? 'story' : 'feed';

  // Resolve media URLs -- sign via Supabase storage instead of passing raw paths
  const resolved = await resolveMediaUrls({ mediaIds, placement });
  if (resolved.failedCount > 0) {
    logger.warn('Some media URLs failed to sign', {
      contentItemId,
      failedCount: resolved.failedCount,
      totalRequested: mediaIds.length,
    });
  }

  // Build base payload
  const payload: ContentPayload = {
    text,
    mediaUrls: resolved.signedUrls.length > 0 ? resolved.signedUrls : undefined,
    contentType,
  };

  const previewData = (variant?.preview_data ?? null) as Record<string, unknown> | null;
  const cta = previewData?.cta && typeof previewData.cta === 'object'
    ? previewData.cta as Record<string, unknown>
    : null;
  const ctaUrl = firstString(cta?.url, previewData?.ctaUrl);
  const ctaAction = firstString(cta?.action);
  if (ctaUrl) payload.ctaUrl = ctaUrl;
  if (ctaAction) payload.ctaAction = ctaAction;

  const campaignMetadata = (campaign?.metadata ?? {}) as Record<string, unknown>;
  const campaignBrief = (campaignMetadata.brief ?? {}) as Record<string, unknown>;

  // Populate eventDetails for GBP event posts. Wizard-created rows store
  // event timing on campaign metadata, while older/manual rows may store it
  // directly on content_items.
  if (contentType === 'event' && metadata) {
    const eventTitle = firstString(
      metadata.title,
      metadata.campaign_name,
      campaign?.name,
      campaignBrief.title,
      campaignBrief.eventTitle,
    );
    const startDate = firstString(
      metadata.event_date,
      campaignMetadata.eventStart,
      campaignMetadata.startDate,
      campaignBrief.eventDate,
    );
    const endDate = firstString(
      metadata.event_end_date,
      campaignMetadata.endDate,
      campaignBrief.eventEndDate,
      startDate,
    );

    if (eventTitle && startDate) {
      payload.eventDetails = {
        title: eventTitle,
        startDate,
        endDate,
      };
    }
  }

  // Populate offerDetails for GBP promotion posts. Wizard-created rows store
  // coupon/terms on campaign metadata or its brief.
  if (contentType === 'promotion' && metadata) {
    const couponCode = firstString(
      metadata.coupon_code,
      campaignMetadata.couponCode,
      campaignBrief.couponCode,
    );
    if (couponCode) {
      payload.offerDetails = {
        couponCode,
        redeemUrl: firstString(campaignMetadata.redeemUrl, campaignBrief.redeemUrl) || undefined,
        terms: firstString(campaignMetadata.terms, campaignBrief.terms) || undefined,
      };
    }
  }

  return payload;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}
