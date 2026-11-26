/**
 * Reading and changing one post's Google version, for the planner post page
 * (src/lib/google-posts/post-section.ts reads it, the actions change it).
 * Server only; service-role client, every query scoped
 * by account_id. The caller has already checked the signed-in user's brand
 * and its Google switch (src/app/(app)/planner/google-version-actions.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GOOGLE_VERSION_COLUMNS,
  googleReasonText,
  wordingIsFrozen,
  type GoogleVersionRow,
  type GoogleVersionView,
} from "@/lib/google-posts/model";
import { deriveGoogleSummary, holdForWording } from "@/lib/google-posts/summary";

function statusLine(row: GoogleVersionRow): string {
  switch (row.state) {
    case "pending":
      if (row.attempts > 0) return "Waiting to try Google again.";
      return row.scheduled_for ? "Will go to Google at its own time." : "Will go to Google at the same time as the Facebook post.";
    case "held":
      return googleReasonText(row.hold_reason) ?? "Waiting for someone to check it before it goes to Google.";
    case "claimed":
      return "Being sent to Google now.";
    case "sent":
      if (row.google_state === "LIVE") return "Live on Google.";
      if (row.google_state === "REJECTED") return "Google rejected this post.";
      return "Sent to Google, waiting for Google's approval.";
    case "uncertain":
      return "Sent, but Google's answer was lost. We are checking whether it arrived.";
    case "failed":
      return googleReasonText(row.hold_reason) ?? "This could not be sent to Google.";
    case "skipped":
      return googleReasonText(row.hold_reason) ?? "This was not sent to Google.";
    default:
      return "Google version.";
  }
}

export function toGoogleVersionView(row: GoogleVersionRow): GoogleVersionView {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    state: row.state,
    holdReason: row.hold_reason,
    statusLine: statusLine(row),
    summary: row.summary,
    summaryEdited: wordingIsFrozen(row),
    // AI wording stays credited to the AI when a person releases it unchanged.
    // A row a person froze before the column existed still reads as theirs.
    wordingSource:
      row.wording_source === "ai" ? "ai" : row.summary_edited_at !== null ? "person" : (row.wording_source ?? "facebook"),
    topicType: row.topic_type,
    eventTitle: row.event_title,
    eventStart: row.event_start,
    eventEnd: row.event_end,
    button: row.cta_type && row.cta_url ? { type: row.cta_type, url: row.cta_url } : null,
    ownTime: row.scheduled_for,
    canMove: row.state === "pending" || row.state === "held",
    googleUrl: row.state === "sent" ? row.search_url : null,
    googleState: row.google_state,
    // A sent post keeps the follow-up check's note (for example that it is no longer on Google).
    lastError: row.state === "pending" || row.state === "held" ? null : row.last_error,
    canEdit: row.state === "pending" || row.state === "held",
    canRelease: row.state === "held",
    canSkip: row.state === "pending" || row.state === "held" || row.state === "failed",
    canRetry: row.state === "failed",
  };
}

async function readRow(db: SupabaseClient, accountId: string, contentItemId: string): Promise<GoogleVersionRow | null> {
  const { data, error } = await db
    .from("gbp_posts")
    .select(GOOGLE_VERSION_COLUMNS)
    .eq("account_id", accountId)
    .eq("content_item_id", contentItemId)
    .maybeSingle<GoogleVersionRow>();
  if (error) throw new Error(`Google version lookup failed: ${error.message}`);
  return data ?? null;
}

/** The Google version of one post, or null when it has none. */
export async function getGoogleVersionForContent(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
): Promise<GoogleVersionView | null> {
  const row = await readRow(db, accountId, contentItemId);
  return row ? toGoogleVersionView(row) : null;
}

export type GoogleVersionChange = { success: true; version: GoogleVersionView } | { success: false; error: string };

export const GOOGLE_VERSION_ACTION_MESSAGES = {
  notFound: "This post has no Google version.",
  notEditable: "The Google wording can only be changed before it is sent.",
  notHeld: "This Google version is not waiting for anyone.",
  notSkippable: "This Google version can no longer be skipped.",
  notFailed: "Only a Google version that failed can be tried again.",
  notMovable: "The time can only be changed before the Google post is sent.",
  timePast: "Choose a time in the future.",
  afterEvent: "Choose a time before the event finishes.",
  emptyWording: "Write some wording for Google first (hashtags, handles, links and phone numbers are removed).",
  changed: "This Google version changed while you were looking at it. Refresh and try again.",
  saveFailed: "We could not save that change. Please try again.",
} as const;

async function change(
  db: SupabaseClient,
  accountId: string,
  row: GoogleVersionRow,
  patch: Record<string, unknown>,
): Promise<GoogleVersionChange> {
  const { data, error } = await db
    .from("gbp_posts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("account_id", accountId)
    .eq("state", row.state)
    .select(GOOGLE_VERSION_COLUMNS);
  if (error) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.saveFailed };
  const updated = Array.isArray(data) && data.length === 1 ? (data[0] as GoogleVersionRow) : null;
  if (!updated) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.changed };
  return { success: true, version: toGoogleVersionView(updated) };
}

/**
 * A person's wording. The copy rules are applied again before it is saved.
 * From then on it no longer follows the Facebook post. A version held only
 * because it had no wording becomes pending; one held as a possible alcohol
 * promotion stays held until it is released.
 */
export async function editGoogleVersionWording(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
  wording: string,
): Promise<GoogleVersionChange> {
  const row = await readRow(db, accountId, contentItemId);
  if (!row) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFound };
  if (row.state !== "pending" && row.state !== "held") return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notEditable };
  const summary = deriveGoogleSummary(wording);
  if (!summary) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.emptyWording };

  const patch: Record<string, unknown> = { summary, summary_edited_at: new Date().toISOString(), wording_source: "person" };
  const hold = holdForWording(summary);
  if (row.state === "pending" && hold) {
    // Saving is not releasing: wording that needs a person's check is held,
    // because the send no longer checks wording once it has been edited.
    Object.assign(patch, { state: "held", hold_reason: hold });
  } else if (row.state === "held" && row.hold_reason === "no_wording") {
    if (hold) patch.hold_reason = hold;
    else Object.assign(patch, { state: "pending", hold_reason: null });
  }
  return change(db, accountId, row, patch);
}

/** A person has checked a held version: it goes at its time, with the wording as it stands. */
export async function releaseGoogleVersion(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
): Promise<GoogleVersionChange> {
  const row = await readRow(db, accountId, contentItemId);
  if (!row) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFound };
  if (row.state !== "held") return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notHeld };
  // Unedited wording is what the page shows: worked out from the Facebook
  // caption as it is now, not the copy stored when the version was made.
  let summary = row.summary;
  if (!wordingIsFrozen(row)) {
    const { data: variant, error } = await db
      .from("content_variants")
      .select("body")
      .eq("content_item_id", row.content_item_id)
      .maybeSingle();
    if (error) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.saveFailed };
    summary = deriveGoogleSummary((variant as { body: string | null } | null)?.body ?? null);
  }
  if (!summary.trim()) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.emptyWording };
  // Freezing the wording stops the send from holding it again for the same reason.
  return change(db, accountId, row, {
    state: "pending",
    hold_reason: null,
    summary,
    summary_edited_at: row.summary_edited_at ?? new Date().toISOString(),
    // Wording the AI wrote stays credited to it; anything else is now the person's.
    wording_source: row.wording_source === "ai" ? "ai" : "person",
  });
}

export async function skipGoogleVersion(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
): Promise<GoogleVersionChange> {
  const row = await readRow(db, accountId, contentItemId);
  if (!row) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFound };
  if (row.state !== "pending" && row.state !== "held" && row.state !== "failed") {
    return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notSkippable };
  }
  return change(db, accountId, row, { state: "skipped", hold_reason: "skipped_by_person", next_attempt_at: null });
}

/** A failed version back in the queue, with its attempts reset. Its time is unchanged. */
export async function retryGoogleVersion(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
): Promise<GoogleVersionChange> {
  const row = await readRow(db, accountId, contentItemId);
  if (!row) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFound };
  if (row.state !== "failed") return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFailed };
  return change(db, accountId, row, {
    state: "pending",
    hold_reason: null,
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
  });
}

/**
 * A person moves a Google post to its own time (D16), or, with null, puts it
 * back on its Facebook post's time. Only before it is sent; never into the
 * past, and never past the end of its event (the sender would refuse it).
 */
export async function moveGoogleVersion(
  db: SupabaseClient,
  accountId: string,
  contentItemId: string,
  when: Date | null,
  now: Date = new Date(),
): Promise<GoogleVersionChange> {
  const row = await readRow(db, accountId, contentItemId);
  if (!row) return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notFound };
  if (row.state !== "pending" && row.state !== "held") return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.notMovable };
  if (when) {
    if (Number.isNaN(when.getTime()) || when.getTime() <= now.getTime()) {
      return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.timePast };
    }
    if (row.event_end && when.getTime() >= Date.parse(row.event_end)) {
      return { success: false, error: GOOGLE_VERSION_ACTION_MESSAGES.afterEvent };
    }
  }
  // A backoff belongs to the old time: a moved post starts clean.
  return change(db, accountId, row, { scheduled_for: when ? when.toISOString() : null, next_attempt_at: null });
}

/** One Google post of the brand by its own id, or null. For the Google post page. */
export async function getGoogleVersionById(
  db: SupabaseClient,
  accountId: string,
  versionId: string,
): Promise<GoogleVersionView | null> {
  const { data, error } = await db
    .from("gbp_posts")
    .select(GOOGLE_VERSION_COLUMNS)
    .eq("account_id", accountId)
    .eq("id", versionId)
    .maybeSingle<GoogleVersionRow>();
  if (error) throw new Error(`Google post lookup failed: ${error.message}`);
  return data ? toGoogleVersionView(data) : null;
}

/** What a planner tile needs to know about one Google post. */
export interface GooglePostTile {
  id: string;
  contentItemId: string;
  state: GoogleVersionRow["state"];
  /** Its own time (ISO), or null while it follows its Facebook post's time. */
  ownTime: string | null;
  /** When Google accepted it, for a tile that has gone out. */
  sentAt: string | null;
  eventTitle: string | null;
}

/** The most Google posts read for one planner view. */
export const GOOGLE_TILE_LIMIT = 500;

/**
 * The brand's Google posts for the planner: every one that has not been
 * skipped and that either has its own time inside the range or was made from
 * one of the given Facebook posts (the ones the calendar already shows).
 */
export async function listGooglePostTiles(
  db: SupabaseClient,
  accountId: string,
  { parentIds, startIso, endIso }: { parentIds: string[]; startIso: string; endIso: string },
): Promise<GooglePostTile[]> {
  const columns = "id, content_item_id, state, scheduled_for, sent_at, event_title";
  type TileRow = { id: string; content_item_id: string; state: GoogleVersionRow["state"]; scheduled_for: string | null; sent_at: string | null; event_title: string | null };
  const rows = new Map<string, TileRow>();

  const own = await db
    .from("gbp_posts")
    .select(columns)
    .eq("account_id", accountId)
    .neq("state", "skipped")
    .gte("scheduled_for", startIso)
    .lte("scheduled_for", endIso)
    .limit(GOOGLE_TILE_LIMIT);
  if (own.error) throw new Error(`Google posts lookup failed: ${own.error.message}`);
  for (const row of (own.data ?? []) as TileRow[]) rows.set(row.id, row);

  // In chunks, so a busy calendar never makes an over-long request URL.
  for (let start = 0; start < parentIds.length; start += 100) {
    const byParent = await db
      .from("gbp_posts")
      .select(columns)
      .eq("account_id", accountId)
      .neq("state", "skipped")
      .in("content_item_id", parentIds.slice(start, start + 100));
    if (byParent.error) throw new Error(`Google posts lookup failed: ${byParent.error.message}`);
    for (const row of (byParent.data ?? []) as TileRow[]) rows.set(row.id, row);
  }

  return [...rows.values()].map((row) => ({
    id: row.id,
    contentItemId: row.content_item_id,
    state: row.state,
    ownTime: row.scheduled_for,
    sentAt: row.sent_at,
    eventTitle: row.event_title,
  }));
}
