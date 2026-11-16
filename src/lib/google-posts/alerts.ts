/**
 * Alerts about Google versions (tasks/SPEC-gbp-posting-reintroduction.md,
 * section 8). Server only.
 *
 * notify-failures reads publish_jobs only, and a Google version never has a
 * publish job, so it can never see a Google problem: the Google cron raises
 * its own alerts here, through the shared insertNotification helper.
 *
 * One alert per incident. insertNotification only skips a repeat within 24
 * hours, which is not enough for an incident that lasts days (a post still
 * processing, a send that cannot be confirmed), so this module first looks for
 * an alert of the same kind for the same version raised since the incident
 * began (`since`), with no time window.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GOOGLE_ALERT_CATEGORIES, GOOGLE_ALERT_RESOURCE, type GoogleAlertKind } from "@/lib/google-posts/model";
import { insertNotification } from "@/lib/notifications/insert";

const TITLES: Record<GoogleAlertKind, string> = {
  failed: "A Google post could not be sent",
  rejected: "Google rejected a post",
  processing: "A Google post is still waiting for Google's approval",
  unconfirmed: "We could not confirm a Google post",
  reconnect: "Google needs to be reconnected",
};

export type GoogleAlertResult = "raised" | "already_raised" | "failed";

export async function raiseGoogleAlert(
  db: SupabaseClient,
  {
    accountId,
    versionId,
    kind,
    body,
    since,
  }: {
    accountId: string;
    versionId: string;
    kind: GoogleAlertKind;
    body: string;
    /** When the incident began; an alert of this kind for this version raised since then counts as this one. */
    since: string;
  },
): Promise<GoogleAlertResult> {
  const category = GOOGLE_ALERT_CATEGORIES[kind];

  const { data: existing, error: lookupError } = await db
    .from("notifications")
    .select("id")
    .eq("account_id", accountId)
    .eq("category", category)
    .eq("resource_type", GOOGLE_ALERT_RESOURCE)
    .eq("resource_id", versionId)
    .gte("created_at", since)
    .limit(1);

  if (lookupError) return "failed";
  if (Array.isArray(existing) && existing.length > 0) return "already_raised";

  const result = await insertNotification({
    supabase: db,
    accountId,
    category,
    title: TITLES[kind],
    body,
    resourceType: GOOGLE_ALERT_RESOURCE,
    resourceId: versionId,
  });

  if (result.status === "failed") return "failed";
  return result.status === "duplicate" ? "already_raised" : "raised";
}
