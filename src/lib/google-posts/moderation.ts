/**
 * Google's moderation checks on sent versions
 * (tasks/SPEC-gbp-posting-reintroduction.md, section 8). Server only.
 *
 * "Sent" means Google accepted the post, not that anyone can see it. After a
 * send the post is read at about 2, 10 and 30 minutes, then hourly to 24
 * hours. The schedule is worked out from the time since sent_at, so a missed
 * run simply catches up.
 * - LIVE: checks stop.
 * - REJECTED: one alert, checks stop, no automatic retry.
 * - Still PROCESSING after 24 hours: one alert, then one check a day until the
 *   event ends (EVENT) or 7 days after sending (STANDARD).
 * - A read that fails is tried again on the schedule. last_checked_at is the
 *   last SUCCESSFUL read, so 6 hours without one raises one "cannot confirm"
 *   alert.
 * - A post Google no longer has (removed by hand, decision D9): checks stop.
 */

import { raiseGoogleAlert } from "@/lib/google-posts/alerts";
import type { GoogleBrand } from "@/lib/google-posts/brands";
import type { GooglePostsDeps } from "@/lib/google-posts/deps";
import { getLocalPost, GOOGLE_READ_TIMEOUT_MS } from "@/lib/google-posts/google-api";
import { GOOGLE_VERSION_COLUMNS, type GoogleAlertKind, type GoogleVersionRow } from "@/lib/google-posts/model";
import { createTokenSource, type TokenSource } from "@/lib/google-posts/send";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Minutes after sending at which the post is read during its first day. */
export const CHECK_OFFSETS_MINUTES = [2, 10, 30, ...Array.from({ length: 24 }, (_, index) => (index + 1) * 60)];
export const MODERATION_BATCH = 10;
export const PROCESSING_ALERT_MS = DAY;
export const READ_OUTAGE_ALERT_MS = 6 * HOUR;
export const STANDARD_WATCH_MS = 7 * DAY;
const UNREADABLE_TEXT =
  "We have not been able to read this post on Google for six hours, so we cannot say whether it is showing. Check the profile.";

/** The shortest wait before reading again after a failed read. */
const RETRY_READ_MS = 10 * MINUTE;

export interface ModerationSummary {
  checked: number;
  live: number;
  rejected: number;
  processing: number;
  readFailures: number;
  alerts: number;
  errors: number;
}

export function emptyModerationSummary(): ModerationSummary {
  return { checked: 0, live: 0, rejected: 0, processing: 0, readFailures: 0, alerts: 0, errors: 0 };
}

/** When to read next, or null to stop. */
export function nextCheckAt(row: Pick<GoogleVersionRow, "sent_at" | "topic_type" | "event_end">, nowMs: number): string | null {
  const sentAt = row.sent_at ? Date.parse(row.sent_at) : nowMs;
  const elapsed = nowMs - sentAt;
  const offset = CHECK_OFFSETS_MINUTES.find((minutes) => minutes * MINUTE > elapsed);
  if (offset !== undefined) return new Date(sentAt + offset * MINUTE).toISOString();

  const stopAt = row.topic_type === "EVENT" && row.event_end ? Date.parse(row.event_end) : sentAt + STANDARD_WATCH_MS;
  const next = nowMs + DAY;
  return next <= stopAt ? new Date(next).toISOString() : null;
}

export async function checkSentVersions(
  deps: GooglePostsDeps,
  brand: GoogleBrand,
  {
    deadline,
    tokens,
    summary = emptyModerationSummary(),
  }: { deadline: number; tokens?: TokenSource; summary?: ModerationSummary },
): Promise<ModerationSummary> {
  const { db } = deps;
  const source = tokens ?? createTokenSource(deps, brand.accountId);
  const nowIso = deps.now().toISOString();

  const { data, error } = await db
    .from("gbp_posts")
    .select(GOOGLE_VERSION_COLUMNS)
    .eq("account_id", brand.accountId)
    .eq("state", "sent")
    .lte("next_check_at", nowIso)
    .order("next_check_at", { ascending: true })
    .limit(MODERATION_BATCH);
  if (error) {
    summary.errors += 1;
    return summary;
  }

  const update = async (row: GoogleVersionRow, patch: Record<string, unknown>): Promise<void> => {
    const { error: updateError } = await db
      .from("gbp_posts")
      .update({ ...patch, updated_at: deps.now().toISOString() })
      .eq("id", row.id)
      .eq("account_id", brand.accountId)
      .eq("state", "sent");
    if (updateError) summary.errors += 1;
  };

  const alert = async (row: GoogleVersionRow, kind: GoogleAlertKind, body: string, since: string): Promise<void> => {
    const result = await raiseGoogleAlert(db, { accountId: brand.accountId, versionId: row.id, kind, body, since });
    if (result === "raised") summary.alerts += 1;
    if (result === "failed") summary.errors += 1;
  };

  for (const row of (data ?? []) as GoogleVersionRow[]) {
    if (deps.now().getTime() + GOOGLE_READ_TIMEOUT_MS + 2_000 > deadline) break;
    if (!row.google_post_name) continue;
    summary.checked += 1;
    const sentAt = row.sent_at ?? row.updated_at;

    const token = await source.get();
    const result = token.ok ? await getLocalPost(deps.fetch, token.accessToken, row.google_post_name) : null;
    const now = deps.now().getTime();

    if (result?.ok) {
      const state = typeof result.data.state === "string" ? result.data.state : null;
      const base = {
        google_state: state ?? row.google_state,
        search_url: typeof result.data.searchUrl === "string" ? result.data.searchUrl : row.search_url,
        last_checked_at: new Date(now).toISOString(),
        check_attempts: row.check_attempts + 1,
        last_error: null,
      };
      if (state === "LIVE") {
        summary.live += 1;
        await update(row, { ...base, next_check_at: null });
      } else if (state === "REJECTED") {
        summary.rejected += 1;
        await update(row, { ...base, next_check_at: null });
        await alert(row, "rejected", "Google rejected this post. It will not be sent again automatically.", sentAt);
      } else {
        summary.processing += 1;
        await update(row, { ...base, next_check_at: nextCheckAt(row, now) });
        if (now - Date.parse(sentAt) >= PROCESSING_ALERT_MS) {
          await alert(row, "processing", "Google has not approved this post after a day. It will be checked once a day.", sentAt);
        }
      }
      continue;
    }

    if (result && !result.ok && result.kind === "http" && result.status === 404) {
      // Removed on Google by hand (D9): nothing left to watch.
      await update(row, {
        check_attempts: row.check_attempts + 1,
        last_error: "This post is no longer on Google.",
        next_check_at: null,
      });
      continue;
    }

    // The read failed (or no token): try again on the schedule.
    summary.readFailures += 1;
    // Never later than an hour, so an outage is noticed; never sooner than ten minutes.
    const scheduled = nextCheckAt(row, now);
    const retryAt = scheduled ? Math.min(Math.max(now + RETRY_READ_MS, Date.parse(scheduled)), now + HOUR) : null;
    await update(row, {
      check_attempts: row.check_attempts + 1,
      last_error: "We could not read this post on Google. We will try again.",
      next_check_at: retryAt === null ? null : new Date(retryAt).toISOString(),
    });
    const lastGood = row.last_checked_at ?? sentAt;
    if (now - Date.parse(lastGood) >= READ_OUTAGE_ALERT_MS) {
      await alert(row, "unconfirmed", UNREADABLE_TEXT, lastGood);
    }
  }

  return summary;
}
