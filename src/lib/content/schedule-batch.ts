import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { contentBriefSubmissionSchema } from '@/features/create/schemas/content-schemas';
import { normaliseBannerText, validateBannerText } from '@/lib/banner/text';
import { DEFAULT_TIMEZONE, WEEKLY_MAX_OCCURRENCES } from '@/lib/constants';
import { buildGenerationTemporalContext } from '@/lib/create/temporal-context';
import { createLogger } from '@/lib/logging';
import { toLoggableError } from '@/lib/logging/to-error';
import { beforePromotionWindow, promotionWindowMessage } from '@/lib/management-app/promotion-window';
import { buildCampaignMetadata, mapCampaignType } from '@/lib/publishing/build-campaign-metadata';
import { buildPreviewData, composePublishBody } from '@/lib/publishing/compose-body';
import { readPlatformCtaLinks } from '@/lib/publishing/copy-rules';
import { enqueueAndDispatch } from '@/lib/publishing/queue';
import type { ContentType, Platform, PlatformCopy } from '@/types/content';

/**
 * Scheduling a batch of posts: the one path that writes planner content for
 * the create wizard (createScheduledBatch) and for ops tools such as the
 * calendar fill (tasks/SPEC-social-calendar-fill.md), so both make exactly the
 * same rows. Callers own authentication; this takes a service-role client and
 * the account the posts belong to.
 */

const logger = createLogger('schedule-batch');

export const SCHEDULE_MESSAGES = {
  scheduleFailed: 'We could not schedule your posts, so nothing was scheduled. Please try again.',
  mediaCheckFailed: 'We could not check your selected images. Please try again.',
} as const;

export interface ScheduleSlotCopy {
  slotKey: string;
  scheduledAt: string;
  label?: string;
  copy: PlatformCopy;
  /** Media for this slot; falls back to selectedMediaIds when absent */
  mediaIds?: string[];
  /** Optional free-text overlay label; blank/undefined = no overlay */
  bannerTextOverride?: string;
}

export interface ScheduleBatchInput {
  contentType: ContentType;
  brief: Record<string, unknown>;
  selectedMediaIds: string[];
  slotCopies: ScheduleSlotCopy[];
  platforms: Platform[];
  mode: 'schedule' | 'queue_now';
  /** Add the posts to this campaign (it must be the account's) instead of creating one. */
  existingCampaignId?: string;
}

export interface ScheduleBatchResult {
  success?: boolean;
  error?: string;
  contentItemIds?: string[];
  campaignId?: string;
  placements?: Array<'feed' | 'story'>;
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
    if (placements.length) return Array.from(new Set(placements));

    // This reads the raw brief, not the Zod-parsed one, so the schema default
    // never reaches here. The fallback has to be stated again, and it differs by
    // type: an event posts to the feed and as a story on every posting day, so a
    // brief that arrives without placements (an older draft, say) must still get
    // both. Promotions stay feed-only unless asked otherwise.
    return contentType === 'event' ? ['feed', 'story'] : ['feed'];
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

// ---------------------------------------------------------------------------
// Rollback helper
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

/**
 * Everything checked before a batch writes anything: the brief, the event-order
 * rule, the slot cap and overlay text. Returns the reason to refuse, or null.
 */
export function validateScheduleBatch({
  contentType,
  brief,
  slotCopies,
}: Pick<ScheduleBatchInput, 'contentType' | 'brief' | 'slotCopies'>): string | null {
  // Re-validate the brief server-side — this batch path is a trust boundary
  // and must not rely on the client having validated. The discriminated union
  // keys off contentType (passed as a sibling field), so inject it. We keep
  // the original brief object (downstream reads several fields by key) and
  // only reject when it is not a well-formed content brief, or is an offer
  // whose dates cannot work (ended, or starting after it ends).
  const briefValidation = contentBriefSubmissionSchema.safeParse({ ...brief, contentType });
  if (!briefValidation.success) {
    return briefValidation.error.issues[0]?.message ?? 'Invalid content brief';
  }

  // Authoritative occurrence cap (the wizard also enforces this client-side).
  // Each slot is one upfront AI generation the user reviewed. Weekly recurring
  // allows a longer run (WEEKLY_MAX_OCCURRENCES); other types keep the standard
  // 12-slot cap that matches the schedule step's MAX_SLOTS_DEFAULT.
  const maxBatchSlots = contentType === 'weekly_recurring' ? WEEKLY_MAX_OCCURRENCES : 12;
  if (slotCopies.length > maxBatchSlots) {
    return `You can schedule at most ${maxBatchSlots} posts at once. Remove a date or shorten the range.`;
  }
  if (contentType === 'weekly_recurring' && slotCopies.length < 1) {
    return 'Select at least one date to publish.';
  }

  // The event-order rule (tasks/SPEC-social-calendar-fill.md): no post before
  // the last event of the same type has finished. Checked before any write.
  const parsedBrief = briefValidation.data;
  if (parsedBrief.contentType === 'event' && parsedBrief.promotionWindow) {
    const window = parsedBrief.promotionWindow;
    const nowLondon = DateTime.now().setZone(DEFAULT_TIMEZONE).toISODate() ?? '';
    const early = slotCopies.some((slot) => {
      const day = slot.scheduledAt
        ? DateTime.fromISO(slot.scheduledAt, { setZone: true }).setZone(DEFAULT_TIMEZONE).toISODate() ?? ''
        : nowLondon;
      return beforePromotionWindow(day, window);
    });
    if (early) return promotionWindowMessage(parsedBrief.eventName, window);
  }

  // Validate per-post overlay text before any writes (all-or-nothing, like the
  // brief gate above). Blank is valid (= no overlay); non-blank must match the
  // shared banner-text charset so we never persist text the renderer would 400 on.
  for (const slot of slotCopies) {
    const overlayCheck = validateBannerText(slot.bannerTextOverride);
    if (!overlayCheck.ok) {
      return overlayCheck.reason;
    }
  }

  return null;
}

/**
 * Write a batch: one content item per slot, placement and platform, each with
 * its variant (publish text, stored copy, media, overlay) and publish job; a
 * campaign for events, promotions and weekly posts unless one is given. All or
 * nothing: a failed write rolls back what was created.
 */
export async function scheduleContentBatch(
  supabase: SupabaseClient,
  accountId: string,
  input: ScheduleBatchInput,
): Promise<ScheduleBatchResult> {
  const { contentType, brief, selectedMediaIds, slotCopies, platforms, mode, existingCampaignId } = input;
  const invalid = validateScheduleBatch({ contentType, brief, slotCopies });
  if (invalid) return { error: invalid };

  const placements = resolveBatchPlacements(contentType, brief);

  const hasPublishablePlacement = placements.some(
    (placement) => platformsForPlacement(platforms, placement).length > 0,
  );
  if (!hasPublishablePlacement) {
    return { error: 'Select Facebook or Instagram when scheduling stories.' };
  }

  // Trust boundary: media ids arrive from the client and are written straight
  // into content_variants.media_ids, which the service-role publish worker
  // later resolves with no account filter. Verify ownership here, before any
  // write, so another account's asset can never be published from this one.
  const submittedMediaIds = Array.from(
    new Set(slotCopies.flatMap((slot) => slot.mediaIds ?? selectedMediaIds)),
  );

  if (submittedMediaIds.length > 0) {
    const { data: ownedMedia, error: ownedMediaError } = await supabase
      .from('media_assets')
      .select('id')
      .eq('account_id', accountId)
      .in('id', submittedMediaIds)
      .returns<Array<{ id: string }>>();

    if (ownedMediaError) {
      logger.error('createScheduledBatch media ownership check failed', toLoggableError(ownedMediaError), { accountId });
      return { error: SCHEDULE_MESSAGES.mediaCheckFailed };
    }

    const ownedIds = new Set((ownedMedia ?? []).map((row) => row.id));
    if (submittedMediaIds.some((id) => !ownedIds.has(id))) {
      // Deliberately vague: this must not confirm to a caller whether a given
      // UUID exists on another account.
      return { error: 'One or more selected images are not available. Reselect your media.' };
    }
  }

  // Stories have a hard media contract the publish worker enforces: exactly one
  // asset, an image, with a ready 1080x1920 derivative. Checking only for "at
  // least one" lets a user schedule a story that is guaranteed to fail at
  // publish time, long after the UI told them it was ready. Applies to any story
  // placement (story content type, or event/promotion/weekly with a story
  // placement).
  //
  // The messages are copied verbatim from getPublishReadinessIssues in
  // src/lib/publishing/preflight.ts so the wording matches the planner's
  // preflight errors. Preflight itself cannot be reused here: it keys every
  // check off a content_items id, and on this path the content rows do not
  // exist yet.
  //
  // Scope matters on a mixed batch. When the brief asks for a feed post AND a
  // story, the story row carries only the first asset (see variantMedia below),
  // so the strict "exactly one" count would reject a perfectly valid two-image
  // feed post and write nothing at all. Story-only batches keep the count check:
  // there the extra images have nowhere to go, so the user must be told rather
  // than silently truncated.
  if (placements.includes('story')) {
    const storyOnlyBatch = !placements.includes('feed');
    const storySlotMedia = slotCopies.map((slot) => slot.mediaIds ?? selectedMediaIds);

    if (storySlotMedia.some((mediaIds) => mediaIds.length === 0)) {
      return { error: 'Stories require one processed image. Add a story image before scheduling.' };
    }
    if (storyOnlyBatch && storySlotMedia.some((mediaIds) => mediaIds.length !== 1)) {
      return { error: 'Stories can only include one image.' };
    }

    // Validate exactly what the story row will publish: the first asset of each
    // slot. On a story-only batch that is the slot's single asset anyway.
    const storyMediaIds = Array.from(new Set(storySlotMedia.map((mediaIds) => mediaIds[0])));
    const { data: storyAssets, error: storyAssetsError } = await supabase
      .from('media_assets')
      .select('id, media_type, derived_variants')
      .in('id', storyMediaIds)
      .returns<Array<{
        id: string;
        media_type: string | null;
        derived_variants: Record<string, unknown> | null;
      }>>();

    if (storyAssetsError) {
      logger.error('createScheduledBatch story media check failed', toLoggableError(storyAssetsError), { accountId });
      return { error: SCHEDULE_MESSAGES.mediaCheckFailed };
    }

    const storyAssetsById = new Map((storyAssets ?? []).map((row) => [row.id, row]));
    for (const mediaId of storyMediaIds) {
      const asset = storyAssetsById.get(mediaId);
      if (!asset) {
        return { error: 'One or more media assets are missing. Reattach media before scheduling.' };
      }
      if (asset.media_type !== 'image') {
        return { error: 'Stories only support images.' };
      }
      const storyVariant = asset.derived_variants?.story;
      if (typeof storyVariant !== 'string' || storyVariant.length === 0) {
        return { error: 'Story image is still processing. Wait for derivatives or choose another image.' };
      }
    }
  }

  // Create a campaign row for types that need one
  let campaignId: string | null = null;
  // Only a campaign made here is deleted by a rollback; an existing one stays.
  let createdCampaign = false;
  const needsCampaign =
    contentType === 'event' ||
    contentType === 'promotion' ||
    contentType === 'weekly_recurring';

  if (needsCampaign && existingCampaignId) {
    // A tool adding posts to a campaign that already exists: it must be this account's.
    const { data: existingCampaign, error: existingCampaignError } = await supabase
      .from('campaigns')
      .select('id, campaign_type')
      .eq('id', existingCampaignId)
      .eq('account_id', accountId)
      .maybeSingle<{ id: string; campaign_type: string | null }>();
    if (existingCampaignError) {
      logger.error('scheduleContentBatch campaign lookup failed', toLoggableError(existingCampaignError), { accountId });
      return { error: SCHEDULE_MESSAGES.scheduleFailed };
    }
    if (!existingCampaign) return { error: 'That campaign no longer exists.' };
    // The planner reads a post's timing and date labels from its campaign's
    // type, so event posts may only join an event campaign, and so on.
    if (existingCampaign.campaign_type !== mapCampaignType(contentType)) {
      return { error: 'These posts are a different kind from that campaign, so they were not added to it.' };
    }
    campaignId = existingCampaignId;
  } else if (needsCampaign) {
    const campaignName =
      (brief.title as string) ??
      (brief.eventTitle as string) ??
      `${contentType} campaign`;

    // Build timing-compatible metadata for extractCampaignTiming() and
    // map weekly_recurring -> 'weekly' for campaign_type compatibility
    const metadata = buildCampaignMetadata(contentType, brief, slotCopies.length);
    // Bound the link-in-bio card to the actual posts: derive the weekly end date
    // from the last real occurrence rather than trusting the client's brief.endDate.
    if (contentType === 'weekly_recurring' && slotCopies.length > 0) {
      const lastSlotIso = slotCopies
        .map((s) => s.scheduledAt)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .sort()
        .at(-1);
      if (lastSlotIso) {
        metadata.endDate = lastSlotIso.slice(0, 10); // YYYY-MM-DD of the final occurrence
      }
    }
    const campaignType = mapCampaignType(contentType);

    // Weekly campaigns surface their CTA on the link-in-bio page for the run.
    // readPlatformCtaLinks only returns http(s) URLs. First entry in the card's
    // link resolution chain (campaigns.link_in_bio_url -> metadata.*).
    const linkInBioUrl =
      contentType === 'weekly_recurring' && brief.placement !== 'story'
        ? (readPlatformCtaLinks(brief).facebook ?? null)
        : null;

    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        account_id: accountId,
        name: campaignName,
        campaign_type: campaignType,
        status: 'scheduled',
        metadata,
        link_in_bio_url: linkInBioUrl,
      })
      .select('id')
      .single();

    if (campaignError) {
      logger.error('createScheduledBatch campaign insert failed', toLoggableError(campaignError), { accountId });
      return { error: SCHEDULE_MESSAGES.scheduleFailed };
    }

    campaignId = campaignRow.id as string;
    createdCampaign = true;
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
    return { error: 'No content to schedule — select at least one platform.' };
  }

  const { data: insertedContent, error: contentError } = await supabase
    .from('content_items')
    .insert(contentRows)
    .select('id, platform');

  if (contentError) {
    logger.error('createScheduledBatch content_items insert failed', toLoggableError(contentError), { accountId });
    return { error: SCHEDULE_MESSAGES.scheduleFailed };
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
  // Media is chosen per slot but written per placement. Stories publish exactly
  // one asset (the worker throws on anything else), so a story row takes only
  // the first asset while the feed row keeps the whole selection. This is the
  // same first-asset rule the wizard's mixed-placement story preview shows.
  const resolvePlacementMedia = (
    slotMedia: string[],
    placement: 'feed' | 'story',
  ): string[] => (placement === 'story' ? slotMedia.slice(0, 1) : slotMedia);
  const ctaLinks = readPlatformCtaLinks(brief);
  const ctaLabel = typeof brief.ctaLabel === 'string' ? brief.ctaLabel : undefined;

  const variantPayloads = insertedItems.map((item, index) => {
    const { slotIdx, platform, placement } = slotPlatformIndex[index];
    const slot = slotCopies[slotIdx];
    const copy = slot.copy[platform as Platform];
    const body = placement === 'story'
      ? ''
      : copy
      ? composePublishBody(platform as Platform, copy, { ctaLinks, contentType, ctaLabel })
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
    const variantMedia = resolvePlacementMedia(resolveSlotMedia(slot), placement);

    // Overlays are opt-in per post. Derive the overlay once per slot; it applies
    // to every platform variant of that slot. Write an explicit banner_enabled
    // (never NULL) so the resolver's account-default fallback can't re-enable it,
    // and keep the invariant "enabled implies non-empty text or a computed label".
    // Placement is deliberately not consulted: stories follow the same rule as
    // feed posts (see tasks/SPEC-story-text-overlays.md section 4.1).
    const overlay = normaliseBannerText(slot.bannerTextOverride);
    // Events auto-enable a dynamic date overlay even without typed text: the
    // banner is enabled with a null override so the worker prints the per-post
    // proximity label (TONIGHT, THIS FRIDAY, FRIDAY 17TH JULY). Other content
    // types stay opt-in, enabled only when text is typed.
    //
    // This applies to artwork imported from the management app too. That
    // artwork was previously exempt on the grounds that it already carries
    // its own date, but the strip prints a proximity label, not a date, and
    // no static artwork can say TONIGHT or THIS FRIDAY.
    const autoOverlayForEvent = contentType === 'event';

    return {
      content_item_id: item.id,
      body,
      preview_data: previewData,
      media_ids: variantMedia.length > 0 ? variantMedia : null,
      banner_enabled: overlay !== null || autoOverlayForEvent,
      banner_text_override: overlay,
    };
  });

  const { error: variantError } = await supabase
    .from('content_variants')
    .upsert(variantPayloads, { onConflict: 'content_item_id' });

  if (variantError) {
    // Roll back the content_items (and campaign) we just inserted so a failed
    // variant write does not leave orphaned rows with no variant — those would
    // otherwise fail every publish attempt and clutter the planner.
    await rollbackCreatedScheduledBatch({
      supabase,
      contentItemIds: insertedItems.map((i) => i.id),
      campaignId,
      deleteCampaign: createdCampaign,
    });
    logger.error('createScheduledBatch variant insert failed', toLoggableError(variantError), { accountId });
    return { error: SCHEDULE_MESSAGES.scheduleFailed };
  }

  // Insert content_media_attachments for v2 compatibility. Attachments are keyed
  // per content item and every content item has a placement, so they follow the
  // same per-placement media as the variant above. Otherwise a story item's
  // planner thumbnail and library reference count would claim images the story
  // will never publish.
  const attachmentRows: Record<string, unknown>[] = [];
  insertedItems.forEach((item, index) => {
    const { slotIdx, placement } = slotPlatformIndex[index];
    const itemMedia = resolvePlacementMedia(resolveSlotMedia(slotCopies[slotIdx]), placement);
    itemMedia.forEach((mediaId, mi) => {
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
    const { slotIdx, platform, placement } = slotPlatformIndex[index];
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
        placement,
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
        deleteCampaign: createdCampaign,
      });

      return { error: SCHEDULE_MESSAGES.scheduleFailed };
    }
  }

  return {
    success: true,
    contentItemIds: insertedItems.map((item) => item.id),
    campaignId: campaignId ?? undefined,
    placements,
  };
}
