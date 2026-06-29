'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import { getContentForCalendar } from '@/lib/content/queries';
import { buildGenerationTemporalContext } from '@/lib/create/temporal-context';
import { enqueueAndDispatch } from '@/lib/publishing/queue';
import { buildCampaignMetadata, mapCampaignType } from '@/lib/publishing/build-campaign-metadata';
import { composePublishBody, buildPreviewData } from '@/lib/publishing/compose-body';
import { readPlatformCtaLinks } from '@/lib/publishing/copy-rules';
import { MEDIA_BUCKET } from '@/lib/constants';
import type { ContentItem, ContentType, Platform, PlatformCopy } from '@/types/content';

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

function isPlacement(value: unknown): value is 'feed' | 'story' {
  return value === 'feed' || value === 'story';
}

function resolveBatchPlacements(
  contentType: ContentType,
  brief: Record<string, unknown>,
): Array<'feed' | 'story'> {
  if (contentType === 'story') return ['story'];

  if (contentType === 'event' || contentType === 'promotion') {
    const placements = Array.isArray(brief.placements)
      ? brief.placements.filter(isPlacement)
      : [];
    return placements.length ? Array.from(new Set(placements)) : ['feed'];
  }

  if (contentType === 'weekly_recurring') {
    return brief.placement === 'story' ? ['story'] : ['feed'];
  }

  return ['feed'];
}

function platformsForPlacement(
  platforms: Platform[],
  placement: 'feed' | 'story',
): Platform[] {
  if (placement === 'story') {
    return platforms.filter((platform) => platform === 'facebook' || platform === 'instagram');
  }
  return platforms;
}

function normaliseStoragePath(path: string): string {
  const prefix = `${MEDIA_BUCKET}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

/**
 * Create a new content draft from a content brief.
 * Validates input with contentBriefSchema, inserts into content_items.
 */
export async function createDraft(
  formData: unknown,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const parsed = contentBriefSchema.safeParse(formData);
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
      row.recurring_day_of_week = brief.dayOfWeek;
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
      return { error: error.message };
    }

    revalidatePath('/dashboard/create');

    return { success: true, id: (data as { id: string }).id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
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
    const { supabase, accountId } = await requireAuthContext();

    const { error } = await supabase
      .from('content_items')
      .update({
        body_draft: draftState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    if (error) {
      return { error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
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
      return { error: error.message };
    }

    return { data: mapContentItem(data as Record<string, unknown>) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
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
    return { error: err instanceof Error ? err.message : String(err) };
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
    await requireAuthContext();
    const items = await getContentForCalendar(startDate, endDate);
    return { data: items };
  } catch (err) {
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
    const { supabase, accountId } = await requireAuthContext();

    // Validate date is in the future
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return { error: 'Invalid date provided' };
    }
    if (scheduledDate.getTime() <= Date.now()) {
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
    const { supabase, accountId } = await requireAuthContext();

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
      .or(`scheduled_for.gte.${startIso},scheduled_at.gte.${startIso}`)
      .or(`scheduled_for.lte.${endIso},scheduled_at.lte.${endIso}`)
      .not('status', 'eq', 'draft')
      .order('scheduled_for', { ascending: true, nullsFirst: false });

    if (error) {
      return { error: error.message };
    }

    const rowsList = ((rows ?? []) as Record<string, unknown>[]).filter((row) => !row.deleted_at);
    const previewRefs = new Map<string, { path: string; mediaType: 'image' | 'video' }>();
    const previewPaths = new Set<string>();

    for (const row of rowsList) {
      const attachments = row.content_media_attachments as Array<Record<string, unknown>> | null;
      if (!attachments?.length) continue;

      const sorted = [...attachments].sort(
        (a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0),
      );
      const firstMedia = sorted[0]?.media_library as Record<string, unknown> | null;
      const fileUrl = typeof firstMedia?.file_url === 'string' ? firstMedia.file_url : null;
      if (!fileUrl) continue;

      const path = normaliseStoragePath(fileUrl);
      const fileType = typeof firstMedia?.file_type === 'string' ? firstMedia.file_type : '';
      previewRefs.set(row.id as string, {
        path,
        mediaType: fileType.startsWith('video') ? 'video' : 'image',
      });
      previewPaths.add(path);
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

      // Ensure item falls within the requested range
      if (scheduledFor < startIso || scheduledFor > endIso) continue;

      let mediaPreview: CalendarItemDisplay['mediaPreview'] = null;
      const previewRef = previewRefs.get(row.id as string);
      const signedPreviewUrl = previewRef ? signedPreviewByPath.get(previewRef.path) : null;
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
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Rollback helper for createScheduledBatch
// ---------------------------------------------------------------------------

interface RollbackOptions {
  supabase: ReturnType<typeof Object>;
  contentItemIds: string[];
  campaignId: string | null;
  deleteCampaign: boolean;
}

/**
 * Best-effort rollback of rows created during a failed createScheduledBatch.
 * Deletes in reverse dependency order: publish_jobs, attachments, variants,
 * content_items, and optionally the campaign.
 * If rollback itself fails, logs the error with all IDs for manual cleanup.
 */
async function rollbackCreatedScheduledBatch({
  supabase,
  contentItemIds,
  campaignId,
  deleteCampaign,
}: RollbackOptions): Promise<void> {
  const db = supabase as {
    from: (table: string) => {
      delete: () => {
        in: (col: string, vals: string[]) => Promise<{ error: unknown }>;
        eq: (col: string, val: string) => Promise<{ error: unknown }>;
      };
    };
  };

  try {
    // 1. Delete publish_jobs for these content items
    await db.from('publish_jobs').delete().in('content_item_id', contentItemIds);
    // 2. Delete content_media_attachments
    await db.from('content_media_attachments').delete().in('content_item_id', contentItemIds);
    // 3. Delete content_variants
    await db.from('content_variants').delete().in('content_item_id', contentItemIds);
    // 4. Delete content_items
    await db.from('content_items').delete().in('id', contentItemIds);
    // 5. Delete campaign if one was created
    if (deleteCampaign && campaignId) {
      await db.from('campaigns').delete().eq('id', campaignId);
    }
  } catch (rollbackErr) {
    // Rollback failed — log IDs for manual cleanup
    console.error(
      '[createScheduledBatch] ROLLBACK FAILED. Manual cleanup needed.',
      { contentItemIds, campaignId, error: rollbackErr },
    );
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
  slotCopies: Array<{
    slotKey: string;
    scheduledAt: string;
    label?: string;
    copy: PlatformCopy;
    /** Media for this slot; falls back to selectedMediaIds when absent */
    mediaIds?: string[];
  }>;
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
    const { supabase, accountId } = await requireAuthContext();

    const {
      draftContentId,
      contentType,
      brief,
      selectedMediaIds,
      slotCopies,
      platforms,
      mode,
    } = input;

    // Verify the draft row exists and belongs to this account
    const { data: draftRow, error: draftError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', draftContentId)
      .eq('account_id', accountId)
      .single();

    if (draftError || !draftRow) {
      return { error: 'Draft not found or access denied' };
    }

    const placements = resolveBatchPlacements(contentType, brief);
    if (contentType === 'event' && placements.length !== 1) {
      return { error: 'Choose either a post or a story for event campaigns, not both.' };
    }

    const hasPublishablePlacement = placements.some(
      (placement) => platformsForPlacement(platforms, placement).length > 0,
    );
    if (!hasPublishablePlacement) {
      return { error: 'Select Facebook or Instagram when scheduling stories.' };
    }

    // Create a campaign row for types that need one
    let campaignId: string | null = null;
    const needsCampaign =
      contentType === 'event' ||
      contentType === 'promotion' ||
      contentType === 'weekly_recurring';

    if (needsCampaign) {
      const campaignName =
        (brief.title as string) ??
        (brief.eventTitle as string) ??
        `${contentType} campaign`;

      // Build timing-compatible metadata for extractCampaignTiming() and
      // map weekly_recurring -> 'weekly' for campaign_type compatibility
      const metadata = buildCampaignMetadata(contentType, brief, slotCopies.length);
      const campaignType = mapCampaignType(contentType);

      const { data: campaignRow, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          account_id: accountId,
          name: campaignName,
          campaign_type: campaignType,
          status: 'scheduled',
          metadata,
        })
        .select('id')
        .single();

      if (campaignError) {
        return { error: `Campaign creation failed: ${campaignError.message}` };
      }

      campaignId = campaignRow.id as string;
    }

    // Build content_items rows: one per slotCopy x platform
    const contentRows: Record<string, unknown>[] = [];
    const slotPlatformIndex: Array<{ slotIdx: number; platform: Platform; placement: 'feed' | 'story' }> = [];

    for (let si = 0; si < slotCopies.length; si++) {
      const slot = slotCopies[si];
      const temporalContext = buildGenerationTemporalContext({
        contentType,
        brief,
        scheduledAt: slot.scheduledAt,
      });
      for (const placement of placements) {
        const eligiblePlatforms = platformsForPlacement(platforms, placement);
        for (const platform of eligiblePlatforms) {
          contentRows.push({
            account_id: accountId,
            campaign_id: campaignId,
            platform,
            placement,
            scheduled_for: slot.scheduledAt,
            scheduled_at: slot.scheduledAt, // bridge column for v2 compat
            content_type: contentType,
            status: mode === 'schedule' ? 'scheduled' : 'queued',
            prompt_context: {
              slotKey: slot.slotKey,
              slotLabel: slot.label ?? null,
              placement,
              ...temporalContext,
              brief,
            },
            auto_generated: true,
          });
          slotPlatformIndex.push({ slotIdx: si, platform, placement });
        }
      }
    }

    if (!contentRows.length) {
      return { error: 'Select Facebook or Instagram when scheduling stories.' };
    }

    const { data: insertedContent, error: contentError } = await supabase
      .from('content_items')
      .insert(contentRows)
      .select('id, platform');

    if (contentError) {
      return { error: `Content items insert failed: ${contentError.message}` };
    }

    const insertedItems = (insertedContent ?? []) as Array<{
      id: string;
      platform: string;
    }>;

    // Build content_variants rows — one per inserted content_item.
    // Uses composePublishBody to assemble the full publishable text
    // (body + hashtags + CTA/link-in-bio) and buildPreviewData to store
    // the structured copy for audit/edit fidelity.
    // Resolve the media for a slot. An explicit array (including an empty one,
    // i.e. media deliberately cleared) is respected; only fall back to the
    // wizard-level selection when a slot carries no media field at all.
    const resolveSlotMedia = (slot: (typeof slotCopies)[number]): string[] =>
      slot.mediaIds ?? selectedMediaIds;
    const ctaLinks = readPlatformCtaLinks(brief);

    const variantPayloads = insertedItems.map((item, index) => {
      const { slotIdx, platform, placement } = slotPlatformIndex[index];
      const slot = slotCopies[slotIdx];
      const copy = slot.copy[platform as Platform];
      const body = placement === 'story'
        ? ''
        : copy
        ? composePublishBody(platform as Platform, copy, { ctaLinks, contentType })
        : '';
      const previewData = placement === 'story'
        ? null
        : copy
        ? buildPreviewData(platform as Platform, copy, {
            slotLabel: slot.label,
            slotKey: slot.slotKey,
            brief,
          }, { ctaLinks, contentType })
        : null;
      const slotMedia = resolveSlotMedia(slot);

      return {
        content_item_id: item.id,
        body,
        preview_data: previewData,
        media_ids: slotMedia.length > 0 ? slotMedia : null,
      };
    });

    const { error: variantError } = await supabase
      .from('content_variants')
      .upsert(variantPayloads, { onConflict: 'content_item_id' });

    if (variantError) {
      return { error: `Variant insert failed: ${variantError.message}` };
    }

    // Insert content_media_attachments for v2 compatibility (per-slot media)
    const attachmentRows: Record<string, unknown>[] = [];
    insertedItems.forEach((item, index) => {
      const { slotIdx } = slotPlatformIndex[index];
      const slotMedia = resolveSlotMedia(slotCopies[slotIdx]);
      slotMedia.forEach((mediaId, mi) => {
        attachmentRows.push({
          content_item_id: item.id,
          media_id: mediaId,
          position: mi,
        });
      });
    });

    if (attachmentRows.length > 0) {
      const { error: attachError } = await supabase
        .from('content_media_attachments')
        .insert(attachmentRows);

      if (attachError) {
        // Non-fatal: log but don't fail the batch
        console.error('[createScheduledBatch] media attachment insert error:', attachError.message);
      }
    }

    // Enqueue publish jobs for ALL modes — enqueueAndDispatch handles
    // future vs immediate scheduling internally (PUB-03)
    for (const [index, item] of insertedItems.entries()) {
      const { slotIdx, platform } = slotPlatformIndex[index];
      const slot = slotCopies[slotIdx];
      const scheduledAt = slot.scheduledAt
        ? new Date(slot.scheduledAt)
        : new Date();

      try {
        await enqueueAndDispatch({
          contentItemId: item.id,
          accountId,
          platform: platform as Platform,
          scheduledAt,
        });
      } catch (publishError) {
        console.error(
          `[createScheduledBatch] Failed to create publish job for ${item.id}:`,
          publishError instanceof Error ? publishError.message : publishError,
        );

        await rollbackCreatedScheduledBatch({
          supabase,
          contentItemIds: insertedItems.map((i) => i.id),
          campaignId,
          deleteCampaign: Boolean(campaignId),
        });

        return {
          error: `Publish job creation failed for item ${index + 1}. No content was scheduled; please retry.`,
        };
      }
    }

    // Clean up the original wizard draft row
    await supabase
      .from('content_items')
      .delete()
      .eq('id', draftContentId)
      .eq('account_id', accountId)
      .eq('status', 'draft');

    revalidatePath('/planner');
    revalidatePath('/dashboard/create');

    const contentItemIds = insertedItems.map((item) => item.id);

    return {
      success: true,
      contentItemIds,
      campaignId: campaignId ?? undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
