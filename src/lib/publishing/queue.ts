import { createServiceSupabaseClient } from "@/lib/supabase/service";

export async function enqueuePublishJob({
  contentItemId,
  scheduledFor,
}: {
  contentItemId: string;
  scheduledFor: Date | null;
}) {
  const supabase = createServiceSupabaseClient();
  const nowIso = new Date().toISOString();
  const nextAttempt = scheduledFor ? scheduledFor.toISOString() : nowIso;

  await supabase
    .from("publish_jobs")
    .insert({
      content_item_id: contentItemId,
      status: "queued",
      next_attempt_at: nextAttempt,
    })
    .throwOnError();
}

export async function markContentScheduled(
  contentItemIds: string[],
  status: "scheduled" | "queued",
) {
  if (!contentItemIds.length) return;
  const supabase = createServiceSupabaseClient();

  await supabase
    .from("content_items")
    .update({ status })
    .in("id", contentItemIds)
    .throwOnError();
}
