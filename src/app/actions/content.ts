'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { DateTime } from 'luxon';

import { requireAuthContext } from '@/lib/auth/server';
import { contentBriefSubmissionSchema } from '@/features/create/schemas/content-schemas';
import { resolvePreviewCandidates } from '@/lib/library/data';
import { getContentForCalendar } from '@/lib/content/queries';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import { MEDIA_BUCKET, DEFAULT_TIMEZONE } from '@/lib/constants';
import { scheduleContentBatch, validateScheduleBatch, type ScheduleSlotCopy } from '@/lib/content/schedule-batch';
import type { ContentItem, ContentType, Platform } from '@/types/content';
import { requireEntitledContext } from '@/lib/billing/entitlement-server';
import { ownerMessage } from '@/lib/errors/owner-message';
import { createLogger } from '@/lib/logging';
import { toLoggableError } from '@/lib/logging/to-error';

const logger = createLogger('content');

/**
 * What the create screens show when a save fails (tasks/SPEC-plain-error-messages.md).
 * The database's own text goes to the log; a message written for owners (plan
 * on hold, owners only) still reaches them through ownerMessage().
 */
const CONTENT_MESSAGES = {
  draftSaveFailed: 'We could not save your draft. Please try again.',
  draftLoadFailed: 'We could not load your draft. Please try again.',
  calendarLoadFailed: 'We could not load your scheduled posts. Please refresh the page to try again.',
  scheduleFailed: 'We could not schedule your posts, so nothing was scheduled. Please try again.',
  mediaCheckFailed: 'We could not check your selected images. Please try again.',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a snake_case content_items DB row to camelCase ContentItem.
 */
function mapContentItem(row: Record<string, unknown>): ContentItem {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    contentType: row.content_type as ContentItem['contentType'],
    status: row.status as ContentItem['status'],
    title: (row.title as string) ?? null,
    bodyDraft: (row.body_draft as Record<string, unknown>) ?? null,
    campaignName: (row.campaign_name as string) ?? null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
    eventDate: (row.event_date as string) ?? null,
    eventEndDate: (row.event_end_date as string) ?? null,
    couponCode: (row.coupon_code as string) ?? null,
    recurringDayOfWeek: (row.recurring_day_of_week as number) ?? null,
    autoConfirm: (row.auto_confirm as boolean) ?? false,
    aiGenerationParams: (row.ai_generation_params as Record<string, unknown>) ?? null,
    thumbnailUrl: null,
    placement: row.placement === 'story' ? 'story' : 'feed',
    platform: isPlatform(row.platform) ? row.platform : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function isPlatform(value: unknown): value is Platform {
  return value === 'facebook' || value === 'instagram';
}

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

/**
 * Create a new content draft from a content brief.
 * Validates input with contentBriefSubmissionSchema (which refuses an offer that has already ended), inserts into content_items.
 */
export async function createDraft(
  formData: unknown,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const { supabase, accountId } = await requireEntitledContext('create');

    const parsed = contentBriefSubmissionSchema.safeParse(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }

    const brief = parsed.data;

    // Build the DB row from the parsed brief
    const row: Record<string, unknown> = {
      account_id: accountId,
      content_type: brief.contentType,
      status: 'draft',
      title: brief.title,
      body_draft: brief, // store the full parsed brief as JSONB
    };

    // Type-specific fields
    if (brief.contentType === 'event') {
      row.event_date = brief.eventDate;
      row.event_end_date = brief.eventEndDate ?? null;
    }
    if (brief.contentType === 'promotion') {
      row.coupon_code = brief.couponCode ?? null;
    }
    if (brief.contentType === 'weekly_recurring') {
      // Single-int column (CHECK 0-6) drives only the mid-wizard planner ghost;
      // store the first selected day. The full day set lives in body_draft.
      row.recurring_day_of_week = brief.daysOfWeek[0] ?? 1;
      row.auto_confirm = true; // weekly recurring auto-publishes once approved
    }
    if (brief.contentType === 'instant_post' && brief.publishMode === 'schedule' && brief.scheduledFor) {
      row.scheduled_at = brief.scheduledFor;
    }

    const { data, error } = await supabase
      .from('content_items')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      logger.error('createDraft insert failed', toLoggableError(error), { accountId });
      return { error: CONTENT_MESSAGES.draftSaveFailed };
    }

    revalidatePath('/dashboard/create');

    return { success: true, id: (data as { id: string }).id };
  } catch (err) {
    unstable_rethrow(err);
    logger.error('createDraft failed', toLoggableError(err));
    return { error: ownerMessage(err, CONTENT_MESSAGES.draftSaveFailed) };
  }
}

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------

/**
 * Update a draft's body_draft JSONB field (auto-save from wizard).
 * Only updates drafts owned by the current user's account.
 */
export async function saveDraft(
  contentId: string,
  draftState: unknown,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireEntitledContext('create');

    const { error } = await supabase
      .from('content_items')
      .update({
        body_draft: draftState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    if (error) {
      logger.error('saveDraft update failed', toLoggableError(error), { accountId, contentId });
      return { error: CONTENT_MESSAGES.draftSaveFailed };
    }

    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    logger.error('saveDraft failed', toLoggableError(err), { contentId });
    return { error: ownerMessage(err, CONTENT_MESSAGES.draftSaveFailed) };
  }
}

// ---------------------------------------------------------------------------
// getDraft
// ---------------------------------------------------------------------------

/**
 * Retrieve a single content item by ID.
 * Explicitly scoped by account_id — service-role client bypasses RLS.
 */
export async function getDraft(
  contentId: string,
): Promise<{ data?: ContentItem; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contentId)
      .eq('account_id', accountId)
      .single();

    if (error) {
      logger.error('getDraft lookup failed', toLoggableError(error), { accountId, contentId });
      return { error: CONTENT_MESSAGES.draftLoadFailed };
    }

    return { data: mapContentItem(data as Record<string, unknown>) };
  } catch (err) {
    unstable_rethrow(err);
    logger.error('getDraft failed', toLoggableError(err), { contentId });
    return { error: ownerMessage(err, CONTENT_MESSAGES.draftLoadFailed) };
  }
}

// ---------------------------------------------------------------------------
// listDrafts
// ---------------------------------------------------------------------------

/**
 * List all draft content items for the current account.
 * Ordered by most recently updated, limited to 50.
 */
export async function listDrafts(): Promise<{
  data?: ContentItem[];
  error?: string;
}> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      return { error: error.message };
    }

    const items = (data as Record<string, unknown>[]).map(mapContentItem);
    return { data: items };
  } catch (err) {
    unstable_rethrow(err);
    logger.error('getCalendarItemsAction failed', toLoggableError(err));
    return { error: ownerMessage(err, CONTENT_MESSAGES.calendarLoadFailed) };
  }
}

// ---------------------------------------------------------------------------
// deleteDraft
// ---------------------------------------------------------------------------

/**
 * Delete a content item, but only if it has status 'draft'.
 * Account scoping is enforced via the accountId check.
 */
export async function deleteDraft(
  contentId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { error } = await supabase
      .from('content_items')
      .delete()
      .eq('id', contentId)
      .eq('account_id', accountId)
      .eq('status', 'draft');

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/dashboard/create');

    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getScheduledContentAction
// ---------------------------------------------------------------------------

/**
 * Server action wrapper for getContentForCalendar.
 * Required because schedule-step.tsx is a client component and cannot
 * import server-only query helpers directly.
 */
export async function getScheduledContentAction(
  startDate: string,
  endDate: string,
): Promise<{ data?: ContentItem[]; error?: string }> {
  try {
    const { accountId } = await requireAuthContext();
    const items = await getContentForCalendar(accountId, startDate, endDate);
    return { data: items };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// scheduleContent
// ---------------------------------------------------------------------------

/**
 * Update a content item with a scheduled date and set status to 'scheduled'.
 * Validates that the date is in the future.
 */
export async function scheduleContent(
  contentId: string,
  scheduledAt: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireEntitledContext('publish');

    // Validate date is in the future. Parse via Luxon in the app timezone so a
    // naive datetime string is interpreted as Europe/London (not the server's
    // UTC), consistent with the rest of the create flow.
    const scheduledDate = DateTime.fromISO(scheduledAt, { zone: DEFAULT_TIMEZONE });
    if (!scheduledDate.isValid) {
      return { error: 'Invalid date provided' };
    }
    if (scheduledDate.toMillis() <= DateTime.now().toMillis()) {
      return { error: 'Schedule date must be in the future' };
    }

    const { error } = await supabase
      .from('content_items')
      .update({
        scheduled_at: scheduledAt,
        status: 'scheduled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/planner');
    revalidatePath('/dashboard/create');

    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// approveForQueue
// ---------------------------------------------------------------------------

/**
 * Set a content item's status to 'approved' for immediate queue processing.
 * Used for "publish now" mode -- Phase 4 pipeline picks up approved items.
 */
export async function approveForQueue(
  contentId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireEntitledContext('publish');

    const { error } = await supabase
      .from('content_items')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/planner');
    revalidatePath('/dashboard/create');

    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Calendar items adapter for ScheduleCalendar
// ---------------------------------------------------------------------------

/** Display DTO for existing planner items on the schedule calendar */
interface CalendarItemDisplay {
  id: string;
  scheduledFor: string;
  platform: 'facebook' | 'instagram';
  status: 'draft' | 'scheduled' | 'queued' | 'publishing' | 'posted' | 'failed';
  placement?: 'feed' | 'story';
  campaignName?: string | null;
  mediaPreview?: { url: string; mediaType: 'image' | 'video' } | null;
}

/**
 * Return planner-compatible calendar items for the ScheduleCalendar component.
 * Queries content_items with scheduled_for (primary) and falls back to
 * scheduled_at for v2 draft rows that lack scheduled_for.
 * Left-joins content_variants and media_library for the first media preview.
 */
export async function getCalendarItemsAction(
  startIso: string,
  endIso: string,
): Promise<{ data?: CalendarItemDisplay[]; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Query items with scheduled_for in range, scoped to current account
    const { data: rows, error } = await supabase
      .from('content_items')
      .select(`
        id,
        platform,
        status,
        placement,
        campaign_name,
        scheduled_for,
        scheduled_at,
        deleted_at,
        content_media_attachments (
          media_id,
          position,
          media_library (
            id,
            file_url,
            file_type
          )
        )
      `)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      // A row is in range when EITHER timestamp column falls fully within
      // [start, end]. Expressed as an OR of two ANDs so the window can't be
      // satisfied by mixing one column's lower bound with the other's upper.
      .or(
        `and(scheduled_for.gte.${startIso},scheduled_for.lte.${endIso}),` +
        `and(scheduled_at.gte.${startIso},scheduled_at.lte.${endIso})`,
      )
      .not('status', 'eq', 'draft')
      .order('scheduled_for', { ascending: true, nullsFirst: false });

    if (error) {
      logger.error('calendar items lookup failed', toLoggableError(error), { accountId });
      return { error: CONTENT_MESSAGES.calendarLoadFailed };
    }

    const rowsList = ((rows ?? []) as Record<string, unknown>[]).filter((row) => !row.deleted_at);
    // The legacy library stores only the original. Story derivatives live on
    // media_assets, so resolve each preview using its content placement.
    const assetIds = [...new Set(rowsList.flatMap((row) => {
      const attachments = row.content_media_attachments as Array<{ media_id: string }> | null;
      return (attachments ?? []).map((attachment) => attachment.media_id);
    }))];
    type CalendarAsset = {
      id: string;
      storage_path: string;
      media_type: string;
      derived_variants: Record<string, string> | null;
    };
    const assetsById = new Map<string, CalendarAsset>();
    if (assetIds.length) {
      const { data: assets, error: assetError } = await supabase
        .from('media_assets')
        .select('id, storage_path, media_type, derived_variants')
        .eq('account_id', accountId)
        .in('id', assetIds)
        .returns<CalendarAsset[]>();
      if (assetError) {
        logger.error('calendar media lookup failed', toLoggableError(assetError), { accountId });
        return { error: CONTENT_MESSAGES.calendarLoadFailed };
      }
      for (const asset of assets ?? []) assetsById.set(asset.id, asset);
    }
    const previewRefs = new Map<string, { paths: string[]; mediaType: 'image' | 'video' }>();
    const previewPaths = new Set<string>();

    for (const row of rowsList) {
      const attachments = row.content_media_attachments as Array<Record<string, unknown>> | null;
      if (!attachments?.length) continue;

      const sorted = [...attachments].sort(
        (a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0),
      );
      const attachment = sorted[0];
      const asset = assetsById.get(attachment?.media_id as string);
      const firstMedia = attachment?.media_library as Record<string, unknown> | null;
      const fileUrl = asset?.storage_path ?? (typeof firstMedia?.file_url === 'string' ? firstMedia.file_url : null);
      if (!fileUrl) continue;

      const paths = resolvePreviewCandidates({
        storagePath: fileUrl,
        derivedVariants: asset?.derived_variants ?? {},
        placement: row.placement === 'story' ? 'story' : 'feed',
      }).map((candidate) => candidate.path);
      const fileType = typeof firstMedia?.file_type === 'string' ? firstMedia.file_type : '';
      previewRefs.set(row.id as string, {
        paths,
        mediaType: asset ? (asset.media_type === 'video' ? 'video' : 'image') : (fileType.startsWith('video') ? 'video' : 'image'),
      });
      for (const path of paths) previewPaths.add(path);
    }

    const signedPreviewByPath = new Map<string, string>();
    if (previewPaths.size > 0) {
      const paths = Array.from(previewPaths);
      const { data: signedPreviews, error: signError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrls(paths, 600);

      if (signError) {
        console.error('[getCalendarItemsAction] failed to sign calendar media previews:', signError.message);
      } else {
        for (const entry of signedPreviews ?? []) {
          if (entry?.path && entry.signedUrl && !entry.error) {
            signedPreviewByPath.set(entry.path, entry.signedUrl);
          }
        }
      }
    }

    const items: CalendarItemDisplay[] = [];

    for (const row of rowsList) {
      const scheduledFor = (row.scheduled_for as string) ?? (row.scheduled_at as string);
      if (!scheduledFor) continue;

      // Ensure item falls within the requested range. Compare instants (millis),
      // not raw ISO strings — mixed offsets (e.g. +01:00 vs Z) sort incorrectly
      // lexicographically and would mis-drop boundary items across BST/GMT.
      const scheduledMillis = DateTime.fromISO(scheduledFor).toMillis();
      const startMillis = DateTime.fromISO(startIso).toMillis();
      const endMillis = DateTime.fromISO(endIso).toMillis();
      if (Number.isNaN(scheduledMillis) || scheduledMillis < startMillis || scheduledMillis > endMillis) {
        continue;
      }

      let mediaPreview: CalendarItemDisplay['mediaPreview'] = null;
      const previewRef = previewRefs.get(row.id as string);
      const signedPreviewUrl = previewRef?.paths.map((path) => signedPreviewByPath.get(path)).find(Boolean);
      if (previewRef && signedPreviewUrl) {
        mediaPreview = {
          url: signedPreviewUrl,
          mediaType: previewRef.mediaType,
        };
      }

      const platform = row.platform as CalendarItemDisplay['platform'];
      const status = row.status as CalendarItemDisplay['status'];

      items.push({
        id: row.id as string,
        scheduledFor,
        platform: platform ?? 'facebook',
        status: status ?? 'draft',
        placement: (row.placement as 'feed' | 'story') ?? undefined,
        campaignName: (row.campaign_name as string) ?? null,
        mediaPreview,
      });
    }

    return { data: items };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// createScheduledBatch — batch-create planner-compatible content from wizard
// ---------------------------------------------------------------------------

/** Input for createScheduledBatch — one call creates all rows for the wizard's generated previews */
interface CreateScheduledBatchInput {
  draftContentId: string;
  contentType: ContentType;
  brief: Record<string, unknown>;
  selectedMediaIds: string[];
  slotCopies: ScheduleSlotCopy[];
  platforms: Platform[];
  mode: 'schedule' | 'queue_now';
}

/**
 * Create a batch of planner-compatible content_items + content_variants from
 * the wizard's generated slot previews. Follows the createCampaignFromPlans
 * pattern in src/lib/create/service.ts.
 *
 * For event/promotion/weekly_recurring types, a campaigns row is created.
 * For instant_post, campaign creation is skipped.
 *
 * Each slotCopy x platform combination produces one content_items row with a
 * matching content_variants row and content_media_attachments entries.
 *
 * When mode is 'queue_now', publish jobs are also enqueued for each item.
 * The original wizard draft row is deleted after successful batch creation.
 */
export async function createScheduledBatch(
  input: CreateScheduledBatchInput,
): Promise<{
  success?: boolean;
  error?: string;
  contentItemIds?: string[];
  campaignId?: string;
}> {
  try {
    const { supabase, accountId } = await requireEntitledContext('publish');

    const {
      draftContentId,
      contentType,
      brief,
      selectedMediaIds,
      slotCopies,
      platforms,
      mode,
    } = input;

    const invalid = validateScheduleBatch({ contentType, brief, slotCopies });
    if (invalid) {
      return { error: invalid };
    }

    // Verify the draft row exists and belongs to this account
    const { data: draftRow, error: draftError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', draftContentId)
      .eq('account_id', accountId)
      .single();

    if (draftError || !draftRow) {
      if (draftError) logger.error('createScheduledBatch draft lookup failed', toLoggableError(draftError), { accountId });
      return { error: 'We could not find this draft. Please start again from Create.' };
    }

    const scheduled = await scheduleContentBatch(supabase, accountId, {
      contentType,
      brief,
      selectedMediaIds,
      slotCopies,
      platforms,
      mode,
    });
    if (!scheduled.success || !scheduled.contentItemIds) {
      return { error: scheduled.error ?? CONTENT_MESSAGES.scheduleFailed };
    }
    const contentItemIds = scheduled.contentItemIds;
    const campaignId = scheduled.campaignId ?? null;
    const placements = scheduled.placements ?? [];

    // Clean up the original wizard draft row
    await supabase
      .from('content_items')
      .delete()
      .eq('id', draftContentId)
      .eq('account_id', accountId)
      .eq('status', 'draft');

    // Audit the scheduling action (best-effort — never block scheduling on the
    // audit write).
    try {
      await logPublishAuditEvent({
        accountId,
        operationType: 'content_scheduled',
        resourceType: 'content_item',
        resourceId: campaignId ?? contentItemIds[0] ?? draftContentId,
        details: {
          mode,
          contentType,
          placements,
          itemCount: contentItemIds.length,
          campaignId: campaignId ?? null,
        },
      });
    } catch (auditErr) {
      console.error(
        '[createScheduledBatch] audit log failed (non-fatal):',
        auditErr instanceof Error ? auditErr.message : auditErr,
      );
    }

    revalidatePath('/planner');
    revalidatePath('/dashboard/create');

    return {
      success: true,
      contentItemIds,
      campaignId: campaignId ?? undefined,
    };
  } catch (err) {
    unstable_rethrow(err);
    logger.error('createScheduledBatch failed', toLoggableError(err));
    return { error: ownerMessage(err, CONTENT_MESSAGES.scheduleFailed) };
  }
}


