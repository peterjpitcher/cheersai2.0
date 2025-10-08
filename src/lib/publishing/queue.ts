import { createServiceSupabaseClient } from "@/lib/supabase/service";

interface EnqueuePublishJobOptions {
  contentItemId: string;
  variantId?: string | null;
  placement?: "feed" | "story";
  scheduledFor: Date | null;
}

export async function enqueuePublishJob({
  contentItemId,
  variantId,
  placement,
  scheduledFor,
}: EnqueuePublishJobOptions) {
  const supabase = createServiceSupabaseClient();

  let resolvedPlacement = placement ?? null;
  if (!resolvedPlacement || !variantId) {
    const { data: itemRow, error: itemError } = await supabase
      .from("content_items")
      .select("placement")
      .eq("id", contentItemId)
      .maybeSingle<{ placement: "feed" | "story" }>();

    if (itemError) {
      throw itemError;
    }

    resolvedPlacement = resolvedPlacement ?? itemRow?.placement ?? "feed";
  }

  let resolvedVariantId = variantId ?? null;
  if (!resolvedVariantId) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentItemId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("No variant found for content item");
    }

    resolvedVariantId = variantRow.id;
  }

  const nowIso = new Date().toISOString();
  const nextAttempt = scheduledFor ? scheduledFor.toISOString() : nowIso;

  await supabase
    .from("publish_jobs")
    .insert({
      content_item_id: contentItemId,
      variant_id: resolvedVariantId,
      status: "queued",
      next_attempt_at: nextAttempt,
      placement: resolvedPlacement,
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
