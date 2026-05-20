'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import { getContentForCalendar } from '@/lib/content/queries';
import { enqueuePublishJob } from '@/lib/publishing/queue';
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
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
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
 * RLS ensures only the owner's account can access it.
 */
export async function getDraft(
  contentId: string,
): Promise<{ data?: ContentItem; error?: string }> {
  try {
    const { supabase } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contentId)
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
    const { supabase } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
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
  platform: 'facebook' | 'instagram' | 'gbp';
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
    const { supabase } = await requireAuthContext();

    // Query items with scheduled_for in range
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
        content_variants (
          media_ids
        ),
        content_media_attachments (
          media_id,
          position,
          media_library (
            id,
            url,
            media_type
          )
        )
      `)
      .or(`scheduled_for.gte.${startIso},scheduled_at.gte.${startIso}`)
      .or(`scheduled_for.lte.${endIso},scheduled_at.lte.${endIso}`)
      .not('status', 'eq', 'draft')
      .order('scheduled_for', { ascending: true, nullsFirst: false });

    if (error) {
      return { error: error.message };
    }

    const items: CalendarItemDisplay[] = [];

    for (const row of (rows ?? []) as Record<string, unknown>[]) {
      const scheduledFor = (row.scheduled_for as string) ?? (row.scheduled_at as string);
      if (!scheduledFor) continue;

      // Ensure item falls within the requested range
      if (scheduledFor < startIso || scheduledFor > endIso) continue;

      // Extract first media preview from content_media_attachments
      let mediaPreview: CalendarItemDisplay['mediaPreview'] = null;
      const attachments = row.content_media_attachments as Array<Record<string, unknown>> | null;
      if (attachments?.length) {
        // Sort by position and take first
        const sorted = [...attachments].sort(
          (a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0),
        );
        const firstMedia = sorted[0]?.media_library as Record<string, unknown> | null;
        if (firstMedia?.url) {
          mediaPreview = {
            url: firstMedia.url as string,
            mediaType: (firstMedia.media_type as 'image' | 'video') ?? 'image',
          };
        }
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

      const { data: campaignRow, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          account_id: accountId,
          name: campaignName,
          campaign_type: contentType,
          status: 'scheduled',
          metadata: { brief, slotCount: slotCopies.length },
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
    const slotPlatformIndex: Array<{ slotIdx: number; platform: Platform }> = [];

    for (let si = 0; si < slotCopies.length; si++) {
      const slot = slotCopies[si];
      for (const platform of platforms) {
        contentRows.push({
          account_id: accountId,
          campaign_id: campaignId,
          platform,
          placement: 'feed',
          scheduled_for: slot.scheduledAt,
          scheduled_at: slot.scheduledAt, // bridge column for v2 compat
          content_type: contentType,
          status: mode === 'schedule' ? 'scheduled' : 'queued',
          prompt_context: {
            slotKey: slot.slotKey,
            slotLabel: slot.label ?? null,
            brief,
          },
          auto_generated: true,
        });
        slotPlatformIndex.push({ slotIdx: si, platform });
      }
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

    // Build content_variants rows — one per inserted content_item
    const variantPayloads = insertedItems.map((item, index) => {
      const { slotIdx, platform } = slotPlatformIndex[index];
      const slot = slotCopies[slotIdx];
      // Extract platform-specific body from the PlatformCopy
      const platformCopy = slot.copy[platform as keyof PlatformCopy];
      const body = platformCopy?.body ?? '';

      return {
        content_item_id: item.id,
        body,
        media_ids: selectedMediaIds.length > 0 ? selectedMediaIds : null,
      };
    });

    const { error: variantError } = await supabase
      .from('content_variants')
      .upsert(variantPayloads, { onConflict: 'content_item_id' });

    if (variantError) {
      return { error: `Variant insert failed: ${variantError.message}` };
    }

    // Insert content_media_attachments for v2 compatibility
    const attachmentRows: Record<string, unknown>[] = [];
    for (const item of insertedItems) {
      for (let mi = 0; mi < selectedMediaIds.length; mi++) {
        attachmentRows.push({
          content_item_id: item.id,
          media_id: selectedMediaIds[mi],
          position: mi,
        });
      }
    }

    if (attachmentRows.length > 0) {
      const { error: attachError } = await supabase
        .from('content_media_attachments')
        .insert(attachmentRows);

      if (attachError) {
        // Non-fatal: log but don't fail the batch
        console.error('[createScheduledBatch] media attachment insert error:', attachError.message);
      }
    }

    // Enqueue publish jobs for queue_now mode
    if (mode === 'queue_now') {
      for (const [index, item] of insertedItems.entries()) {
        const { slotIdx, platform } = slotPlatformIndex[index];
        const slot = slotCopies[slotIdx];
        await enqueuePublishJob({
          contentItemId: item.id,
          accountId,
          platform: platform as Platform,
          scheduledAt: new Date(slot.scheduledAt),
        });
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
