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
  dismissed_at: string | null;
};

export interface ActiveFailedPost {
  id: string;
  platform: string;
  placement: string;
  scheduledFor: string | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
}

type ActiveFailedJobRow = {
  id: string;
  last_error: string | null;
  error_message?: string | null;
  updated_at: string | null;
  content_items:
    | {
        id: string;
        platform: string | null;
        placement: string | null;
        scheduled_for: string | null;
      }
    | Array<{
        id: string;
        platform: string | null;
        placement: string | null;
        scheduled_for: string | null;
      }>
    | null;
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
      .select("id, urgency, title, body, message, category, metadata, resource_type, resource_id, created_at, read_at, dismissed_at")
      .eq("account_id", accountId)
      .is("dismissed_at", null)
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
      .select("id, content_items!inner(id)", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "failed")
      .is("resolved_at", null)
      .is("content_items.deleted_at", null);

    if (error) {
      if (isSchemaMissingError(error)) {
        return getFailedContentFallbackCount();
      }
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

async function getFailedContentFallbackCount(): Promise<number> {
  const { supabase, accountId } = await requireAuthContext();

  const { count, error } = await supabase
    .from("content_items")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "failed")
    .is("deleted_at", null);

  if (error) {
    if (!isSchemaMissingError(error)) {
      console.error("[notifications] failed content fallback count error:", error.message);
    }
    return 0;
  }

  return count ?? 0;
}

export async function listActiveFailedPosts(limit = 100): Promise<ActiveFailedPost[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("publish_jobs")
      .select("id, last_error, error_message, updated_at, content_items!inner(id, platform, placement, scheduled_for)")
      .eq("account_id", accountId)
      .eq("status", "failed")
      .is("resolved_at", null)
      .eq("content_items.status", "failed")
      .is("content_items.deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit)
      .returns<ActiveFailedJobRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) return [];
      throw error;
    }

    return (data ?? []).flatMap((row) => {
      const content = Array.isArray(row.content_items) ? row.content_items[0] : row.content_items;
      if (!content?.id) return [];
      return [{
        id: content.id,
        platform: content.platform ?? "unknown",
        placement: content.placement ?? "feed",
        scheduledFor: content.scheduled_for,
        lastError: row.last_error ?? row.error_message ?? null,
        lastAttemptedAt: row.updated_at,
      }];
    });
  } catch (error) {
    if (isSchemaMissingError(error)) return [];
    throw error;
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
