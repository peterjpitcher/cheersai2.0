"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DateTime } from "luxon";

import { enqueueAndDispatch } from "@/lib/publishing/queue";
import { getPublishReadinessIssues } from "@/lib/publishing/preflight";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
import { validateBannerText } from "@/lib/banner/text";
import { listMediaAssets } from "@/lib/library/data";
import { isSchemaMissingError } from "@/lib/supabase/errors";

const approveSchema = z.object({
  contentId: z.string().uuid(),
});

const dismissSchema = z.object({
  notificationId: z.string().uuid(),
});

const deleteSchema = z.object({
  contentId: z.string().uuid(),
});

const archiveFailureSchema = z.object({
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

const loadPlannerMediaLibrarySchema = z
  .object({
    includeAssetIds: z.array(z.string().uuid()).optional().default([]),
  })
  .optional();

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
  platform: z.enum(["facebook", "instagram"]),
  placement: z.enum(["feed", "story"]),
});

const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;
const MEDIA_EDITABLE_STATUSES = new Set<string>(BANNER_EDITABLE_STATUSES);
const FAILURE_NOTIFICATION_CATEGORIES = [
  "publish_failed",
  "story_publish_failed",
  "publish_retry",
  "story_publish_retry",
  "publish_failed_immediate",
] as const;

type PlannerMediaAssetRow = {
  id: string;
  media_type: "image" | "video";
  processed_status: string | null;
  derived_variants: Record<string, unknown> | null;
};

function getTournamentContentContext(promptContext: unknown): {
  fixtureId: string;
  tournamentId: string | null;
} | null {
  if (!promptContext || typeof promptContext !== "object") return null;

  const context = promptContext as Record<string, unknown>;
  if (context.source !== "tournament" || typeof context.tournament_fixture_id !== "string") {
    return null;
  }

  return {
    fixtureId: context.tournament_fixture_id,
    tournamentId: typeof context.tournament_id === "string" ? context.tournament_id : null,
  };
}

async function syncTournamentFixtureGeneratedState({
  supabase,
  accountId,
  promptContext,
}: {
  supabase: SupabaseClient;
  accountId: string;
  promptContext: unknown;
}): Promise<string | null> {
  const context = getTournamentContentContext(promptContext);
  if (!context) return null;

  const { data: activeItems, error: activeItemsError } = await supabase
    .from("content_items")
    .select("id")
    .eq("account_id", accountId)
    .contains("prompt_context", {
      tournament_fixture_id: context.fixtureId,
      source: "tournament",
    })
    .is("deleted_at", null)
    .limit(1);

  if (activeItemsError) {
    throw activeItemsError;
  }

  let updateQuery = supabase
    .from("tournament_fixtures")
    .update({
      content_generated: Boolean(activeItems?.length),
      updated_at: new Date().toISOString(),
    })
    .eq("id", context.fixtureId);

  if (context.tournamentId) {
    updateQuery = updateQuery.eq("tournament_id", context.tournamentId);
  }

  const { error: updateError } = await updateQuery;
  if (updateError) {
    throw updateError;
  }

  return context.tournamentId;
}

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
    .select("id, status, scheduled_for, account_id, placement, platform")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{
      id: string;
      status: string;
      scheduled_for: string | null;
      account_id: string;
      placement: "feed" | "story" | null;
      platform: "facebook" | "instagram";
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

  const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ status: "scheduled", updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
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

    await enqueueAndDispatch({
      contentItemId: contentId,
      accountId,
      platform: content.platform,
      scheduledAt: scheduledFor ?? new Date(),
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
    .update({ read_at: nowIso, dismissed_at: nowIso })
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
    .select("id, account_id, status, scheduled_for, placement, platform, deleted_at, prompt_context")
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
    const tournamentId = await syncTournamentFixtureGeneratedState({
      supabase,
      accountId,
      promptContext: content.prompt_context,
    });
    if (tournamentId) {
      revalidatePath(`/tournaments/${tournamentId}`);
    }

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

  const tournamentId = await syncTournamentFixtureGeneratedState({
    supabase,
    accountId,
    promptContext: content.prompt_context,
  });

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
  if (tournamentId) {
    revalidatePath(`/tournaments/${tournamentId}`);
  }

  return {
    ok: true as const,
    contentId,
    deletedAt: deletedAtIso,
  };
}

export async function archivePlannerFailure(payload: unknown) {
  const { contentId } = archiveFailureSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, deleted_at, prompt_context")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{
      id: string;
      account_id: string;
      status: string;
      deleted_at: string | null;
      prompt_context: unknown;
    }>();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.status !== "failed") {
    throw new Error("Only failed posts can be archived from this action.");
  }

  const nowIso = new Date().toISOString();

  if (!content.deleted_at) {
    const { error: contentUpdateError } = await supabase
      .from("content_items")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("id", contentId)
      .eq("account_id", accountId);

    if (contentUpdateError) {
      throw contentUpdateError;
    }
  }

  const { error: jobUpdateError } = await supabase
    .from("publish_jobs")
    .update({
      resolved_at: nowIso,
      resolution_kind: "user_archived_failure",
      resolution_note: "Archived from planner failure review.",
      next_attempt_at: null,
      updated_at: nowIso,
    })
    .eq("content_item_id", contentId)
    .eq("account_id", accountId)
    .eq("status", "failed")
    .is("resolved_at", null);

  if (jobUpdateError) {
    throw jobUpdateError;
  }

  const { error: notificationUpdateError } = await supabase
    .from("notifications")
    .update({ read_at: nowIso, dismissed_at: nowIso })
    .eq("account_id", accountId)
    .in("category", [...FAILURE_NOTIFICATION_CATEGORIES])
    .filter("metadata->>contentId", "eq", contentId);

  if (notificationUpdateError) {
    throw notificationUpdateError;
  }

  const tournamentId = await syncTournamentFixtureGeneratedState({
    supabase,
    accountId,
    promptContext: content.prompt_context,
  });

  const { error: insertNotificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_failure_archived",
      message: "Failed post archived",
      metadata: { contentId },
    });

  if (insertNotificationError) {
    console.error("[planner] failed to insert archive failure notification", insertNotificationError);
  }

  revalidatePath("/planner");
  revalidatePath(`/planner/${contentId}`);
  if (tournamentId) {
    revalidatePath(`/tournaments/${tournamentId}`);
  }

  return {
    ok: true as const,
    contentId,
    archivedAt: nowIso,
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
    .select("id, account_id, placement, status")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{ id: string; account_id: string; placement: "feed" | "story"; status: string }>();

  if (fetchError) {
    throw fetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (!MEDIA_EDITABLE_STATUSES.has(content.status)) {
    throw new Error("This post can no longer be edited.");
  }

  const mediaIds = Array.from(new Set(media.map((item) => item.assetId)));

  // Assets already attached to this post are allowed through validation even if
  // they were later hidden or are no longer "ready" — the owner must be able to
  // keep or remove media that is currently on the post. Only newly-added assets
  // are held to the ready/library checks.
  const { data: currentVariant, error: currentVariantError } = await supabase
    .from("content_variants")
    .select("media_ids")
    .eq("content_item_id", contentId)
    .maybeSingle<{ media_ids: string[] | null }>();

  if (currentVariantError) {
    throw currentVariantError;
  }

  const alreadyAttachedIds = new Set(currentVariant?.media_ids ?? []);
  const newlyAttachedIds = mediaIds.filter((id) => !alreadyAttachedIds.has(id));

  const { data: assets, error: assetError } = await supabase
    .from("media_assets")
    .select("id, media_type, processed_status, derived_variants")
    .eq("account_id", accountId)
    .in("id", mediaIds)
    .returns<PlannerMediaAssetRow[]>();

  if (assetError) {
    throw assetError;
  }

  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  if (assetById.size !== mediaIds.length) {
    throw new Error("Some media assets do not belong to this account.");
  }

  for (const assetId of mediaIds) {
    if (alreadyAttachedIds.has(assetId)) {
      continue;
    }
    const asset = assetById.get(assetId);
    if (asset?.processed_status !== "ready") {
      throw new Error("Select ready media assets only.");
    }
  }

  if (content.placement === "story") {
    if (mediaIds.length !== 1) {
      throw new Error("Stories require exactly one media attachment");
    }

    const asset = assetById.get(mediaIds[0]);
    if (!asset || asset.media_type !== "image") {
      throw new Error("Stories support images only");
    }

    const storyVariant = asset.derived_variants?.story;
    if (typeof storyVariant !== "string" || !storyVariant.length) {
      throw new Error("Selected media is still processing story derivatives. Try again once ready.");
    }
  }

  let canWriteAttachments = true;
  const { data: libraryRows, error: libraryError } = await supabase
    .from("media_library")
    .select("id")
    .eq("account_id", accountId)
    .in("id", mediaIds)
    .returns<Array<{ id: string }>>();

  if (libraryError) {
    if (isSchemaMissingError(libraryError)) {
      canWriteAttachments = false;
    } else {
      throw libraryError;
    }
  }

  const librarySet = new Set((libraryRows ?? []).map((row) => row.id));
  if (canWriteAttachments && newlyAttachedIds.some((id) => !librarySet.has(id))) {
    throw new Error("Some media assets are not ready for planner attachments.");
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

  if (canWriteAttachments) {
    const { error: deleteAttachmentsError } = await supabase
      .from("content_media_attachments")
      .delete()
      .eq("content_item_id", contentId);

    if (deleteAttachmentsError) {
      if (isSchemaMissingError(deleteAttachmentsError)) {
        canWriteAttachments = false;
      } else {
        throw deleteAttachmentsError;
      }
    }
  }

  if (canWriteAttachments) {
    const { error: insertAttachmentsError } = await supabase
      .from("content_media_attachments")
      .insert(
        mediaIds
          .filter((mediaId) => librarySet.has(mediaId))
          .map((mediaId, position) => ({
            content_item_id: contentId,
            media_id: mediaId,
            position,
          })),
      );

    if (insertAttachmentsError && !isSchemaMissingError(insertAttachmentsError)) {
      throw insertAttachmentsError;
    }
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("content_items")
    .update({ updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  // Banners are derived at publish time, so changing media no longer requires
  // resetting any persisted banner state.

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId,
    mediaIds,
  };
}

export async function loadPlannerMediaLibrary(input?: unknown) {
  const options = loadPlannerMediaLibrarySchema.parse(input) ?? { includeAssetIds: [] };
  return listMediaAssets({
    excludeTags: ["Tournament"],
    includeAssetIds: options.includeAssetIds,
  });
}

export async function restorePlannerContent(payload: unknown) {
  const { contentId } = restoreSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, placement, platform, deleted_at, prompt_context")
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
    const tournamentId = await syncTournamentFixtureGeneratedState({
      supabase,
      accountId,
      promptContext: content.prompt_context,
    });
    if (tournamentId) {
      revalidatePath(`/tournaments/${tournamentId}`);
    }

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
      .is("resolved_at", null)
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

      await enqueueAndDispatch({
        contentItemId: contentId,
        accountId,
        platform: content.platform,
        scheduledAt: scheduledFor ?? new Date(),
      });
    }
  }

  const tournamentId = await syncTournamentFixtureGeneratedState({
    supabase,
    accountId,
    promptContext: content.prompt_context,
  });

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
  if (tournamentId) {
    revalidatePath(`/tournaments/${tournamentId}`);
  }

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
    .select("id, account_id, deleted_at, prompt_context")
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

  const tournamentId = await syncTournamentFixtureGeneratedState({
    supabase,
    accountId,
    promptContext: content.prompt_context,
  });

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
  if (tournamentId) {
    revalidatePath(`/tournaments/${tournamentId}`);
  }

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
    .select("id, prompt_context")
    .eq("account_id", accountId)
    .not("deleted_at", "is", null)
    .returns<Array<{ id: string; prompt_context: unknown }>>();

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

  const tournamentIds = new Set<string>();
  for (const row of trashedRows ?? []) {
    const tournamentId = await syncTournamentFixtureGeneratedState({
      supabase,
      accountId,
      promptContext: row.prompt_context,
    });
    if (tournamentId) tournamentIds.add(tournamentId);
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
  for (const tournamentId of tournamentIds) {
    revalidatePath(`/tournaments/${tournamentId}`);
  }

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
    .maybeSingle<{ id: string; status: string; placement: "feed" | "story"; platform: "facebook" | "instagram"; campaign_id: string | null; account_id: string }>();

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
      resolved_at: null,
      resolution_kind: null,
      resolution_note: null,
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

    await enqueueAndDispatch({
      contentItemId: contentId,
      accountId,
      platform: content.platform,
      scheduledAt: new Date(scheduledIso),
    });
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

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
const BANNER_POSITION_ENUM = z.enum(["top", "bottom", "left", "right"]);

const updateBannerSchema = z.object({
  contentItemId: z.string().uuid(),
  // `enabled` is accepted for wire compatibility but is derived server-side from
  // the overlay text (see below) — it is never trusted from the client.
  enabled: z.boolean().nullable(),
  position: BANNER_POSITION_ENUM.nullable(),
  bgColour: z.string().regex(HEX_COLOUR).nullable(),
  textColour: z.string().regex(HEX_COLOUR).nullable(),
  // Upper-bounded generously; the shared validator normalises/caps to 20.
  textOverride: z.string().max(200).nullable(),
});

export type UpdatePlannerBannerConfigInput = z.input<typeof updateBannerSchema>;

export async function updatePlannerBannerConfig(
  input: unknown,
): Promise<{ success?: boolean; error?: string }> {
  const data = updateBannerSchema.parse(input);
  const { supabase, accountId } = await requireAuthContext();

  // Ownership check: confirm content item belongs to this account and is editable.
  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status")
    .eq("id", data.contentItemId)
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

  // Overlays are opt-in: validate the text against the shared charset rules and
  // derive banner_enabled from it (blank = off) rather than trusting the client.
  // This guarantees a post can always be turned OFF and can never be persisted
  // enabled-but-blank.
  const overlay = validateBannerText(data.textOverride);
  if (!overlay.ok) {
    return { error: overlay.reason };
  }
  const bannerEnabled = overlay.value !== null;

  const { error } = await supabase
    .from("content_variants")
    .update({
      banner_enabled: bannerEnabled,
      banner_position: data.position,
      banner_bg: data.bgColour,
      banner_text_colour: data.textColour,
      banner_text_override: overlay.value,
    })
    .eq("content_item_id", data.contentItemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/planner");
  revalidatePath(`/planner/${data.contentItemId}`);

  return { success: true };
}
