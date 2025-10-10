"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DateTime } from "luxon";

import { enqueuePublishJob } from "@/lib/publishing/queue";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

const approveSchema = z.object({
  contentId: z.string().uuid(),
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


export async function approveDraftContent(payload: unknown) {
  const { contentId } = approveSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("id, status, scheduled_for, account_id, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

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
    .select("id, status, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{ id: string; status: string; placement: "feed" | "story" }>();

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
  const desiredStart = desiredSlot.startOf("minute");

  if (desiredStart < nowSlot) {
    throw new Error("That time has already passed. Choose a future time.");
  }

  const scheduledIso = desiredStart.toUTC().toISO();

  if (!scheduledIso) {
    throw new Error("Unable to determine a valid schedule time.");
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

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    scheduledFor: scheduledIso,
    timezone,
  };
}
