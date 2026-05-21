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

const PROBLEM_NOTIFICATION_CATEGORIES = [
  "publish_failed",
  "story_publish_failed",
  "connection_expiring",
  "connection_expired",
  "connection_disconnected",
  "connection_needs_action",
  "media_derivative_failed",
] as const;

const PROBLEM_NOTIFICATION_FILTER = `urgency.eq.urgent,category.in.(${PROBLEM_NOTIFICATION_CATEGORIES.join(",")})`;
const HEADER_BADGE_LOOKBACK_DAYS = 30;

export function isHeaderBadgeNotification(row: {
  urgency?: string | null;
  category?: string | null;
}): boolean {
  const category = row.category;
  return row.urgency === "urgent" ||
    (typeof category === "string" &&
      PROBLEM_NOTIFICATION_CATEGORIES.includes(category as typeof PROBLEM_NOTIFICATION_CATEGORIES[number]));
}

export async function listPlannerNotifications(limit = 50): Promise<PlannerNotificationHistoryItem[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, urgency, title, body, message, category, metadata, resource_type, resource_id, created_at, read_at")
      .eq("account_id", accountId)
      .or(PROBLEM_NOTIFICATION_FILTER)
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
 * Count recent unread, non-dismissed problem notifications for the authenticated account.
 * Routine activity rows remain available in notification history, but should not
 * keep the global header badge permanently lit. Old problem rows remain in
 * history without keeping the global badge stuck on stale backlog.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const { supabase, accountId } = await requireAuthContext();
  const cutoffIso = new Date(Date.now() - HEADER_BADGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .is("read_at", null)
      .is("dismissed_at", null)
      .or(PROBLEM_NOTIFICATION_FILTER)
      .gte("created_at", cutoffIso);

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
