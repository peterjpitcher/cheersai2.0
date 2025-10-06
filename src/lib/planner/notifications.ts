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
  message: string;
  category: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

export async function listPlannerNotifications(limit = 50): Promise<PlannerNotificationHistoryItem[]> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, message, category, metadata, created_at, read_at")
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
      message: row.message,
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
