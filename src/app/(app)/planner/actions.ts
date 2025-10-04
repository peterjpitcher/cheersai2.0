"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OWNER_ACCOUNT_ID } from "@/lib/constants";
import { enqueuePublishJob } from "@/lib/publishing/queue";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const approveSchema = z.object({
  contentId: z.string().uuid(),
});

const dismissSchema = z.object({
  notificationId: z.string().uuid(),
});

const deleteSchema = z.object({
  contentId: z.string().uuid(),
});

export async function approveDraftContent(payload: unknown) {
  const { contentId } = approveSchema.parse(payload);
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("id, status, scheduled_for, account_id")
    .eq("id", contentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!content || content.account_id !== OWNER_ACCOUNT_ID) {
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
    await enqueuePublishJob({
      contentItemId: contentId,
      scheduledFor,
    });
  }

  const scheduledIso = scheduledFor ? scheduledFor.toISOString() : null;

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: content.account_id,
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
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("id", notificationId)
    .eq("account_id", OWNER_ACCOUNT_ID);

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
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id")
    .eq("id", contentId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content || content.account_id !== OWNER_ACCOUNT_ID) {
    throw new Error("Content item not found");
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
    .eq("id", contentId);

  if (deleteError) {
    throw deleteError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: OWNER_ACCOUNT_ID,
      category: "content_deleted",
      message: "Scheduled post deleted",
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
  };
}
