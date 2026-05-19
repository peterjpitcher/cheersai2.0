import { requireAuthContext } from "@/lib/auth/server";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface PlannerNotificationHistoryItem {
  id: string;
  message: string;
  category: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

type NotificationRow = {
  id: string;
  urgency: string;
  title: string;
  body: string | null;
  message: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
  read_at: string | null;
};

export async function listPlannerNotifications(limit = 50): Promise<PlannerNotificationHistoryItem[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, urgency, title, body, message, category, metadata, resource_type, resource_id, created_at, read_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<NotificationRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      message: row.message ?? row.title,
      category: row.category,
      metadata: row.metadata,
      createdAt: row.created_at,
      readAt: row.read_at,
    }));
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Count publish jobs currently in 'failed' status for the authenticated account.
 * Used by the Attention Needed banner on the planner page.
 */
export async function getFailedPublishCount(): Promise<number> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { count, error } = await supabase
      .from("publish_jobs")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "failed");

    if (error) {
      if (isSchemaMissingError(error)) return 0;
      console.error("[notifications] getFailedPublishCount error:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    if (isSchemaMissingError(error)) return 0;
    console.error("[notifications] getFailedPublishCount unexpected error:", error);
    return 0;
  }
}

/**
 * Count unread, non-dismissed notifications for the authenticated account.
 * Used by the NotificationBadge component.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .is("read_at", null)
      .is("dismissed_at", null);

    if (error) {
      if (isSchemaMissingError(error)) return 0;
      console.error("[notifications] getUnreadNotificationCount error:", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    if (isSchemaMissingError(error)) return 0;
    console.error("[notifications] getUnreadNotificationCount unexpected error:", error);
    return 0;
  }
}
