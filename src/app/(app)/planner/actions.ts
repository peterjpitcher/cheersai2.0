"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DateTime } from "luxon";

import { enqueuePublishJob } from "@/lib/publishing/queue";
import { getPublishReadinessIssues } from "@/lib/publishing/preflight";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from "@/lib/constants";
import { BannerConfigSchema, BANNER_EDITABLE_STATUSES, parseBannerConfig, type BannerConfig } from "@/lib/scheduling/banner-config";
import { extractCampaignTiming } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const approveSchema = z.object({
  contentId: z.string().uuid(),
  bannerStoragePath: z.string().optional(),
  bannerLabel: z.string().optional(),
  bannerScheduledAt: z.string().optional(),
  bannerSourceMediaPath: z.string().optional(),
  bannerRenderMetadata: z.record(z.string(), z.unknown()).optional(),
});

const dismissSchema = z.object({
  notificationId: z.string().uuid(),
});

const deleteSchema = z.object({
  contentId: z.string().uuid(),
});

const restoreSchema = z.object({
  contentId: z.string().uuid(),
});

const permanentDeleteSchema = z.object({
  contentId: z.string().uuid(),
});

const permanentDeleteAllSchema = z.object({});

const updateMediaSchema = z.object({
  contentId: z.string().uuid(),
  media: z
    .array(
      z.object({
        assetId: z.string().uuid(),
      }),
    )
    .min(1, "At least one media asset required"),
});

const updateBodySchema = z.object({
  contentId: z.string().uuid(),
  body: z.string().max(10_000, "Keep the post under 10k characters"),
});

const updateScheduleSchema = z.object({
  contentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Provide a date in YYYY-MM-DD format"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Provide a time in HH:MM format"),
});

const createSchema = z.object({
  platform: z.enum(["facebook", "instagram", "gbp"]),
  placement: z.enum(["feed", "story"]),
});

const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

function reservePlannerSlotOnSameDay({
  desiredSlot,
  timezone,
  occupiedMinutes,
}: {
  desiredSlot: DateTime;
  timezone: string;
  occupiedMinutes: Set<number>;
}) {
  const startOfDay = desiredSlot.setZone(timezone).startOf("day");
  let minuteOfDay = desiredSlot.hour * 60 + desiredSlot.minute;

  while (occupiedMinutes.has(minuteOfDay)) {
    minuteOfDay += SLOT_INCREMENT_MINUTES;
    if (minuteOfDay >= MINUTES_PER_DAY) {
      throw new Error("No open 30-minute slots remain on that day for this channel.");
    }
  }

  return startOfDay.plus({ minutes: minuteOfDay }).startOf("minute");
}


export async function approveDraftContent(payload: unknown) {
  const parsed = approveSchema.parse(payload);
  const { contentId } = parsed;
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("id, status, scheduled_for, account_id, placement, platform, prompt_context, campaign_id")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{
      id: string;
      status: string;
      scheduled_for: string | null;
      account_id: string;
      placement: "feed" | "story" | null;
      platform: "facebook" | "instagram" | "gbp";
      prompt_context: Record<string, unknown> | null;
      campaign_id: string | null;
    }>();

  if (error) {
    throw error;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.status !== "draft") {
    revalidatePath("/planner");
    return { status: content.status, scheduledFor: content.scheduled_for ?? null } as const;
  }

  const readinessIssues = await getPublishReadinessIssues({
    supabase,
    accountId,
    contentId,
    platform: content.platform,
    placement: content.placement ?? "feed",
  });

  if (readinessIssues.length) {
    return { error: readinessIssues.map((issue) => issue.message).join(" ") } as const;
  }

  // --- Banner validation ---
  const bannerConfig = parseBannerConfig(content.prompt_context);
  let bannerState: string = "none";

  if (bannerConfig?.enabled) {
    if (parsed.bannerStoragePath) {
      // Validate path belongs to this content item
      if (!parsed.bannerStoragePath.startsWith(`banners/${contentId}/`)) {
        return { error: "Invalid banner storage path" } as const;
      }

      // Verify file exists in storage
      const pathParts = parsed.bannerStoragePath.split("/");
      const fileName = pathParts.pop();
      const dirPath = pathParts.join("/");

      const serviceClient = createServiceSupabaseClient();
      const { data: fileList } = await serviceClient.storage
        .from(MEDIA_BUCKET)
        .list(dirPath, { search: fileName });

      if (!fileList?.length) {
        return { error: "Banner file not found in storage" } as const;
      }

      // Server-side label recomputation
      if (content.campaign_id) {
        const { data: campaignData } = await supabase
          .from("campaigns")
          .select("campaign_type, metadata")
          .eq("id", content.campaign_id)
          .maybeSingle();

        if (campaignData) {
          const timing = extractCampaignTiming(campaignData);
          const scheduledAt = content.scheduled_for
            ? DateTime.fromISO(content.scheduled_for, { zone: timing.timezone })
            : DateTime.now().setZone(timing.timezone);

          const expectedLabel = bannerConfig.customMessage?.trim().toUpperCase()
            ?? getProximityLabel({ referenceAt: scheduledAt, campaignTiming: timing });

          if (expectedLabel && parsed.bannerLabel !== expectedLabel) {
            // Clean up the uploaded file
            const cleanupClient = createServiceSupabaseClient();
            await cleanupClient.storage.from(MEDIA_BUCKET).remove([parsed.bannerStoragePath]);
            return { error: "Banner label is stale — re-render required" } as const;
          }
        }
      }

      bannerState = "rendered";
    } else {
      // Banner enabled but no path — check if label would be null (not_applicable)
      if (content.campaign_id) {
        const { data: campaignData } = await supabase
          .from("campaigns")
          .select("campaign_type, metadata")
          .eq("id", content.campaign_id)
          .maybeSingle();

        if (campaignData) {
          const timing = extractCampaignTiming(campaignData);
          const scheduledAt = content.scheduled_for
            ? DateTime.fromISO(content.scheduled_for, { zone: timing.timezone })
            : DateTime.now().setZone(timing.timezone);

          const label = bannerConfig.customMessage?.trim().toUpperCase()
            ?? getProximityLabel({ referenceAt: scheduledAt, campaignTiming: timing });

          bannerState = label ? "expected" : "not_applicable";

          if (bannerState === "expected") {
            return { error: "Banner rendering required before approval" } as const;
          }
        } else {
          bannerState = "not_applicable";
        }
      } else {
        bannerState = "not_applicable";
      }
    }
  }

  const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ status: "scheduled", updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  // Update content_variants with banner metadata
  if (bannerState !== "none") {
    const { error: bannerUpdateError } = await supabase
      .from("content_variants")
      .update({
        banner_state: bannerState,
        bannered_media_path: parsed.bannerStoragePath ?? null,
        banner_label: parsed.bannerLabel ?? null,
        banner_rendered_for_scheduled_at: parsed.bannerScheduledAt ?? null,
        banner_source_media_path: parsed.bannerSourceMediaPath ?? null,
        banner_render_metadata: parsed.bannerRenderMetadata ?? null,
      })
      .eq("content_item_id", contentId);

    if (bannerUpdateError) {
      console.error("[planner] failed to update banner state", bannerUpdateError);
    }
  }

  const { data: existingJob } = await supabase
    .from("publish_jobs")
    .select("id")
    .eq("content_item_id", contentId)
    .limit(1)
    .maybeSingle();

  if (!existingJob) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("Variant missing for content item");
    }

    await enqueuePublishJob({
      contentItemId: contentId,
      variantId: variantRow.id,
      placement: content.placement ?? undefined,
      scheduledFor,
    });
  }

  const scheduledIso = scheduledFor ? scheduledFor.toISOString() : null;

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_approved",
      message: scheduledIso
        ? `Draft approved and scheduled for ${new Date(scheduledIso).toLocaleString()}`
        : "Draft approved and queued to publish",
      metadata: {
        contentId,
        scheduledFor: scheduledIso,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert approval notification", notificationError);
  }

  revalidatePath("/planner");

  return {
    status: "scheduled" as const,
    scheduledFor: scheduledIso,
  };
}

export async function dismissPlannerNotification(payload: unknown) {
  const { notificationId } = dismissSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("id", notificationId)
    .eq("account_id", accountId);

  if (error) {
    throw error;
  }

  revalidatePath("/planner");

  return {
    ok: true as const,
    notificationId,
    readAt: nowIso,
  };
}

export async function deletePlannerContent(payload: unknown) {
  const { contentId } = deleteSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, placement, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.deleted_at) {
    return {
      ok: true as const,
      contentId,
      deletedAt: content.deleted_at,
    };
  }

  const deletedAtIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ deleted_at: deletedAtIso, updated_at: deletedAtIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { error: jobError } = await supabase
    .from("publish_jobs")
    .delete()
    .eq("content_item_id", contentId);

  if (jobError) {
    throw jobError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_deleted",
      message: "Post moved to trash",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert delete notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    contentId,
    deletedAt: deletedAtIso,
  };
}

export async function updatePlannerContentMedia(payload: unknown) {
  const { contentId, media } = updateMediaSchema.parse(payload);
  if (!media.length) {
    throw new Error("Attach at least one media asset");
  }

  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  const mediaIds = media.map((item) => item.assetId);

  if (content.placement === "story") {
    if (mediaIds.length !== 1) {
      throw new Error("Stories require exactly one media attachment");
    }

    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select("id, media_type, derived_variants")
      .in("id", mediaIds)
      .returns<Array<{ id: string; media_type: string; derived_variants: Record<string, unknown> | null }>>();

    if (assetError) {
      throw assetError;
    }

    const asset = assets?.[0];
    if (!asset || asset.media_type !== "image") {
      throw new Error("Stories support images only");
    }

    const storyVariant = asset.derived_variants?.story;
    if (typeof storyVariant !== "string" || !storyVariant.length) {
      throw new Error("Selected media is still processing story derivatives. Try again once ready.");
    }
  }

  const { error: variantError } = await supabase
    .from("content_variants")
    .upsert(
      {
        content_item_id: contentId,
        media_ids: mediaIds,
      },
      { onConflict: "content_item_id" },
    );

  if (variantError) {
    throw variantError;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("content_items")
    .update({ updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId,
    mediaIds,
  };
}

export async function restorePlannerContent(payload: unknown) {
  const { contentId } = restoreSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, placement, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (!content.deleted_at) {
    return {
      ok: true as const,
      status: content.status,
      scheduledFor: content.scheduled_for ?? null,
    };
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ deleted_at: null, updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  if (content.status === "scheduled" || content.status === "publishing") {
    const { data: existingJob } = await supabase
      .from("publish_jobs")
      .select("id")
      .eq("content_item_id", contentId)
      .limit(1)
      .maybeSingle();

    if (!existingJob) {
      const { data: variantRow, error: variantError } = await supabase
        .from("content_variants")
        .select("id")
        .eq("content_item_id", contentId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (variantError) {
        throw variantError;
      }

      if (!variantRow) {
        throw new Error("Variant missing for content item");
      }

      const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;

      await enqueuePublishJob({
        contentItemId: contentId,
        variantId: variantRow.id,
        placement: content.placement ?? undefined,
        scheduledFor,
      });
    }
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_restored",
      message: "Post restored from trash",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert restore notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    status: content.status,
    scheduledFor: content.scheduled_for ?? null,
  };
}

export async function permanentlyDeletePlannerContent(payload: unknown) {
  const { contentId } = permanentDeleteSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (!content.deleted_at) {
    throw new Error("Only items in trash can be deleted permanently.");
  }

  const { error: jobError } = await supabase
    .from("publish_jobs")
    .delete()
    .eq("content_item_id", contentId);

  if (jobError) {
    throw jobError;
  }

  const { error: deleteError } = await supabase
    .from("content_items")
    .delete()
    .eq("id", contentId)
    .eq("account_id", accountId);

  if (deleteError) {
    throw deleteError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_deleted_permanently",
      message: "Post deleted permanently",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert permanent delete notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    contentId,
  };
}

export async function permanentlyDeleteAllTrashedPlannerContent(payload?: unknown) {
  permanentDeleteAllSchema.parse(payload ?? {});
  const { supabase, accountId } = await requireAuthContext();

  const { data: trashedRows, error: trashedFetchError } = await supabase
    .from("content_items")
    .select("id")
    .eq("account_id", accountId)
    .not("deleted_at", "is", null)
    .returns<Array<{ id: string }>>();

  if (trashedFetchError) {
    throw trashedFetchError;
  }

  const contentIds = (trashedRows ?? []).map((row) => row.id);
  if (!contentIds.length) {
    return {
      ok: true as const,
      deletedCount: 0,
    };
  }

  const { error: jobError } = await supabase
    .from("publish_jobs")
    .delete()
    .in("content_item_id", contentIds);

  if (jobError) {
    throw jobError;
  }

  const { error: deleteError } = await supabase
    .from("content_items")
    .delete()
    .eq("account_id", accountId)
    .not("deleted_at", "is", null);

  if (deleteError) {
    throw deleteError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_deleted_permanently",
      message:
        contentIds.length === 1
          ? "1 trashed post deleted permanently"
          : `${contentIds.length} trashed posts deleted permanently`,
      metadata: {
        deletedCount: contentIds.length,
        contentIds,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert bulk permanent delete notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    deletedCount: contentIds.length,
  };
}

export async function updatePlannerContentBody(payload: unknown) {
  const { contentId, body } = updateBodySchema.parse(payload);
  const trimmedBody = body.trim();

  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  const requiresBody = content.placement !== "story";
  if (requiresBody && !trimmedBody.length) {
    throw new Error("Write something before saving.");
  }

  const resolvedBody = requiresBody ? trimmedBody : "";

  const { data: existingVariant, error: variantFetchError } = await supabase
    .from("content_variants")
    .select("media_ids")
    .eq("content_item_id", contentId)
    .maybeSingle();

  if (variantFetchError) {
    throw variantFetchError;
  }

  if (existingVariant) {
    const { error: updateError } = await supabase
      .from("content_variants")
      .update({ body: resolvedBody })
      .eq("content_item_id", contentId);

    if (updateError) {
      throw updateError;
    }
  } else {
    const { error: insertError } = await supabase
      .from("content_variants")
      .insert({
        content_item_id: contentId,
        body: resolvedBody,
        media_ids: null,
      });

    if (insertError) {
      throw insertError;
    }
  }

  const nowIso = new Date().toISOString();
  const { error: contentUpdateError } = await supabase
    .from("content_items")
    .update({ updated_at: nowIso })
    .eq("id", contentId);

  if (contentUpdateError) {
    throw contentUpdateError;
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId,
    updatedAt: nowIso,
  };
}

export async function updatePlannerContentSchedule(payload: unknown) {
  const { contentId, date, time } = updateScheduleSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentError } = await supabase
    .from("content_items")
    .select("id, status, placement, platform, campaign_id, account_id")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{ id: string; status: string; placement: "feed" | "story"; platform: "facebook" | "instagram" | "gbp"; campaign_id: string | null; account_id: string }>();

  if (contentError) {
    throw contentError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (["publishing", "posted"].includes(content.status)) {
    throw new Error("This post has already been processed and can no longer be rescheduled.");
  }

  const { data: accountRow, error: accountError } = await supabase
    .from("accounts")
    .select("timezone")
    .eq("id", accountId)
    .maybeSingle<{ timezone: string | null }>();

  if (accountError) {
    throw accountError;
  }

  const timezone = accountRow?.timezone ?? DEFAULT_TIMEZONE;
  const desiredSlot = DateTime.fromISO(`${date}T${time}`, { zone: timezone });

  if (!desiredSlot.isValid) {
    throw new Error("The provided date or time is invalid for your timezone.");
  }

  const nowSlot = DateTime.now().setZone(timezone).startOf("minute");
  let desiredStart: DateTime = desiredSlot.startOf("minute");

  if (desiredStart < nowSlot) {
    throw new Error("That time has already passed. Choose a future time.");
  }

  if (content.placement !== "story") {
    const dayStartIso = desiredStart.startOf("day").toUTC().toISO();
    const dayEndIso = desiredStart.endOf("day").toUTC().toISO();
    if (!dayStartIso || !dayEndIso) {
      throw new Error("Unable to determine a valid schedule day window.");
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("content_items")
      .select("scheduled_for")
      .eq("account_id", accountId)
      .eq("platform", content.platform)
      .eq("placement", "feed")
      .is("deleted_at", null)
      .neq("id", contentId)
      .gte("scheduled_for", dayStartIso)
      .lte("scheduled_for", dayEndIso)
      .returns<Array<{ scheduled_for: string | null }>>();

    if (existingError) {
      throw existingError;
    }

    const occupiedMinutes = new Set<number>();
    for (const row of existingRows ?? []) {
      if (!row.scheduled_for) continue;
      const scheduled = DateTime.fromISO(row.scheduled_for, { zone: "utc" }).setZone(timezone).startOf("minute");
      if (!scheduled.isValid) continue;
      occupiedMinutes.add(scheduled.hour * 60 + scheduled.minute);
    }

    desiredStart = reservePlannerSlotOnSameDay({
      desiredSlot: desiredStart,
      timezone,
      occupiedMinutes,
    });
  }

  const scheduledIso = desiredStart.toUTC().toISO();

  if (!scheduledIso) {
    throw new Error("Unable to determine a valid schedule time.");
  }

  const readinessIssues = await getPublishReadinessIssues({
    supabase,
    accountId,
    contentId,
    platform: content.platform,
    placement: content.placement ?? "feed",
  });

  if (readinessIssues.length) {
    return { error: readinessIssues.map((issue) => issue.message).join(" ") } as const;
  }

  const nowIso = new Date().toISOString();

  const contentUpdate: Record<string, unknown> = {
    scheduled_for: scheduledIso,
    updated_at: nowIso,
  };

  if (content.status !== "draft") {
    contentUpdate.status = "scheduled";
  }

  const { error: updateError } = await supabase
    .from("content_items")
    .update(contentUpdate)
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { data: jobRows, error: jobUpdateError } = await supabase
    .from("publish_jobs")
    .update({
      status: "queued",
      next_attempt_at: scheduledIso,
      last_error: null,
      attempt: 0,
      updated_at: nowIso,
    })
    .eq("content_item_id", contentId)
    .select("id");

  if (jobUpdateError) {
    throw jobUpdateError;
  }

  if (!jobRows?.length) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("Variant missing for content item");
    }

    await enqueuePublishJob({
      contentItemId: contentId,
      variantId: variantRow.id,
      placement: content.placement ?? undefined,
      scheduledFor: new Date(scheduledIso),
    });
  }

  // --- Banner staleness detection ---
  if (content.campaign_id) {
    const { data: variant } = await supabase
      .from("content_variants")
      .select("id, banner_state, banner_rendered_for_scheduled_at")
      .eq("content_item_id", contentId)
      .eq("banner_state", "rendered")
      .maybeSingle();

    if (variant?.banner_rendered_for_scheduled_at) {
      const { data: campaignData } = await supabase
        .from("campaigns")
        .select("campaign_type, metadata")
        .eq("id", content.campaign_id)
        .maybeSingle();

      if (campaignData) {
        const timing = extractCampaignTiming(campaignData);
        const oldRef = DateTime.fromISO(variant.banner_rendered_for_scheduled_at, { zone: timing.timezone });
        const newRef = DateTime.fromISO(scheduledIso, { zone: timing.timezone });
        const oldLabel = getProximityLabel({ referenceAt: oldRef, campaignTiming: timing });
        const newLabel = getProximityLabel({ referenceAt: newRef, campaignTiming: timing });

        if (oldLabel !== newLabel) {
          const invalidateNow = new Date().toISOString();

          // Invalidate banner
          await supabase
            .from("content_variants")
            .update({ banner_state: "stale", updated_at: invalidateNow })
            .eq("id", variant.id);

          // Cancel queued publish jobs
          await supabase
            .from("publish_jobs")
            .update({
              status: "failed",
              last_error: "Banner invalidated by schedule change",
              next_attempt_at: null,
              updated_at: invalidateNow,
            })
            .eq("content_item_id", contentId)
            .in("status", ["queued"]);

          // Set content back to draft
          await supabase
            .from("content_items")
            .update({ status: "draft", updated_at: invalidateNow })
            .eq("id", contentId);

          // Notify user
          await supabase.from("notifications").insert({
            account_id: content.account_id,
            category: "banner_invalidated",
            message: "Schedule changed — banner needs re-rendering. Please re-approve.",
            metadata: { contentId, oldLabel, newLabel },
          });
        }
      }
    }
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    scheduledFor: scheduledIso,
    timezone,
  };
}

export async function createPlannerContent(payload: unknown) {
  const { platform, placement } = createSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("content_items")
    .insert({
      account_id: accountId,
      platform,
      placement,
      status: "draft",
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId: data.id,
  };
}

export async function updatePlannerBannerConfig(
  contentItemId: string,
  config: BannerConfig,
): Promise<{ success?: boolean; error?: string }> {
  const parsed = BannerConfigSchema.parse(config);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, prompt_context")
    .eq("id", contentItemId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    return { error: fetchError.message };
  }

  if (!content) {
    return { error: "Content item not found" };
  }

  if (!(BANNER_EDITABLE_STATUSES as readonly string[]).includes(content.status)) {
    return { error: "This post can no longer be edited." };
  }

  // Safe JSON merge: preserve existing prompt_context keys, only set .banner
  const existingContext =
    content.prompt_context && typeof content.prompt_context === "object"
      ? (content.prompt_context as Record<string, unknown>)
      : {};

  const updatedContext = {
    ...existingContext,
    banner: parsed,
  };

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("content_items")
    .update({ prompt_context: updatedContext, updated_at: nowIso })
    .eq("id", contentItemId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/planner");

  return { success: true };
}

const bannerUploadSchema = z.object({
  contentItemId: z.string().uuid(),
});

export async function createBannerUploadUrl(
  payload: unknown,
): Promise<{ signedUrl: string; storagePath: string } | { error: string }> {
  const { contentItemId } = bannerUploadSchema.parse(payload);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Verify user owns this content item
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("id, account_id")
    .eq("id", contentItemId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (itemError || !item) {
    return { error: "Content item not found" };
  }

  const storagePath = `banners/${contentItemId}/${crypto.randomUUID()}.jpg`;

  const { data, error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (uploadError || !data?.signedUrl) {
    return { error: "Failed to create upload URL" };
  }

  return { signedUrl: data.signedUrl, storagePath };
}
