/**
 * Sending Google versions (tasks/SPEC-gbp-posting-reintroduction.md, section 7
 * and decision D12). Server only; service-role client, every query scoped by
 * account_id. Called from the google-posts cron, never from publish-scheduler,
 * so a Google problem can never delay Facebook or Instagram.
 *
 * A version is due when it is `pending`, its next_attempt_at (a backoff) is
 * empty or past, and its Facebook post's CURRENT scheduled time has passed:
 * the version always follows the parent. At send time the parent decides:
 * trashed, missing or back to draft: skipped; moved later: left pending;
 * failed on Facebook or posted: sent anyway (Google is independent). More than
 * 24 hours late (a cron outage) or an event whose end has passed (the EVENT
 * post and its standard reminders alike): skipped.
 *
 * Every check (parent, switch, connection, destination, wording, token, image)
 * runs BEFORE the claim, and the claim is made immediately before the request,
 * so a failure before sending can never age into `uncertain`. Every state
 * change is a compare-and-set on the state it expects, and a change that
 * matches no row means another run owns the version.
 *
 * A request whose answer was lost is `uncertain` and is never re-sent blindly:
 * reconcileUncertain() lists the location's posts and adopts a match; with no
 * match after the grace period it allows exactly one more send (resend_count);
 * still unclear raises one alert and it stays `uncertain`.
 *
 * Nothing logged here holds a token, a signed URL or the post's text.
 */

import { MEDIA_BUCKET } from "@/lib/constants";
import type { GoogleAccessTokenResult } from "@/lib/connections/google-token";
import { raiseGoogleAlert } from "@/lib/google-posts/alerts";
import { checkGoogleBrand, type GoogleBrand } from "@/lib/google-posts/brands";
import type { GooglePostsDeps } from "@/lib/google-posts/deps";
import {
  buildLocalPostBody,
  createLocalPost,
  GOOGLE_CREATE_TIMEOUT_MS,
  listLocalPosts,
  londonParts,
  type GoogleCallResult,
  type GoogleLocalPost,
} from "@/lib/google-posts/google-api";
import {
  GOOGLE_VERSION_COLUMNS,
  GOOGLE_VERSION_REASONS,
  type GoogleAlertKind,
  type GoogleVersionReason,
  type GoogleVersionRow,
  type GoogleVersionState,
} from "@/lib/google-posts/model";
import { deriveGoogleSummary, holdForWording } from "@/lib/google-posts/summary";
import { createLogger } from "@/lib/logging";

const logger = createLogger("google-posts");

/** Versions sent per brand per run. */
export const SEND_BATCH = 5;
/** Pending versions read per page, before working out which are due. */
export const PENDING_SCAN_LIMIT = 500;
/** Pages of pending versions read per brand per run (at most 5,000 rows). */
export const PENDING_SCAN_PAGES = 10;
/** Sends tried (429, 5xx, a token or image outage) before giving up as failed. */
export const MAX_SEND_ATTEMPTS = 5;
/** Later than this after the post's time (a cron outage), a version is skipped. */
export const LATE_LIMIT_MS = 24 * 60 * 60 * 1000;
/** A claim older than this is treated as uncertain, never re-sent blindly. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;
/** How long after an unanswered send the location's posts are first checked for it. */
export const RECONCILE_GRACE_MS = 10 * 60 * 1000;
/** How often an uncertain version is checked again once it has used its one re-send. */
export const RECONCILE_AGAIN_MS = 60 * 60 * 1000;
/** Uncertain this long with no answer either way: one "cannot confirm" alert. */
export const UNCERTAIN_ALERT_MS = 6 * 60 * 60 * 1000;
/** Signed image links last an hour, the app's existing default. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** The first moderation check after a send. */
export const FIRST_CHECK_MS = 2 * 60 * 1000;

const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 30 * 60 * 1000;
const LIST_PAGES = 3;
const MIN_IMAGE_BYTES = 10 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Ids per `in` filter, so a request URL stays short. */
const IN_CHUNK = 100;

export interface SendSummary {
  sent: number;
  skipped: number;
  held: number;
  failed: number;
  retrying: number;
  uncertain: number;
  adopted: number;
  resent: number;
  alerts: number;
  errors: number;
}

export function emptySendSummary(): SendSummary {
  return { sent: 0, skipped: 0, held: 0, failed: 0, retrying: 0, uncertain: 0, adopted: 0, resent: 0, alerts: 0, errors: 0 };
}

/** One access token per brand per run; a 401 forces one refresh. */
export interface TokenSource {
  get: (forceRefresh?: boolean) => Promise<GoogleAccessTokenResult>;
}

export function createTokenSource(deps: GooglePostsDeps, accountId: string): TokenSource {
  let cached: Promise<GoogleAccessTokenResult> | null = null;
  return {
    get: (forceRefresh = false) => {
      if (forceRefresh || !cached) {
        cached = deps.getAccessToken(deps.db, accountId, forceRefresh ? { forceRefresh: true } : undefined);
      }
      return cached;
    },
  };
}

interface ParentRow {
  id: string;
  account_id: string;
  platform: string | null;
  placement: string | null;
  status: string;
  scheduled_for: string | null;
  deleted_at: string | null;
}

interface RunContext {
  deps: GooglePostsDeps;
  brand: GoogleBrand;
  tokens: TokenSource;
  summary: SendSummary;
  /** Absolute time (ms, on deps.now()) by which no new request may start. */
  deadline: number;
}

/** Exponential backoff with jitter: about 1, 2, 4, 8 then 16 minutes, never more than 30. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Changes a version only if it is still in `from`. True when this run made the change. */
async function transition(
  ctx: RunContext,
  row: Pick<GoogleVersionRow, "id">,
  from: GoogleVersionState,
  patch: Record<string, unknown>,
  { unchangedSince }: { unchangedSince?: string } = {},
): Promise<boolean> {
  let query = ctx.deps.db
    .from("gbp_posts")
    .update({ ...patch, updated_at: iso(ctx.deps.now().getTime()) })
    .eq("id", row.id)
    .eq("account_id", ctx.brand.accountId)
    .eq("state", from);
  // The claim also requires the row to be exactly as read, so a person's edit
  // saved meanwhile is never overwritten by the wording this run worked out.
  if (unchangedSince) query = query.eq("updated_at", unchangedSince);
  const { data, error } = await query.select("id");
  if (error) {
    ctx.summary.errors += 1;
    logger.error("could not update a Google version", new Error(error.message), {
      accountId: ctx.brand.accountId,
      versionId: row.id,
      from,
      to: patch.state ?? from,
    });
    return false;
  }
  return Array.isArray(data) && data.length === 1;
}

async function alert(
  ctx: RunContext,
  row: Pick<GoogleVersionRow, "id">,
  kind: GoogleAlertKind,
  body: string,
  since: string,
): Promise<void> {
  const result = await raiseGoogleAlert(ctx.deps.db, { accountId: ctx.brand.accountId, versionId: row.id, kind, body, since });
  if (result === "raised") ctx.summary.alerts += 1;
  if (result === "failed") {
    ctx.summary.errors += 1;
    logger.error("could not record a Google alert", new Error("notification insert failed"), {
      accountId: ctx.brand.accountId,
      versionId: row.id,
      kind,
    });
  }
}

async function skip(ctx: RunContext, row: GoogleVersionRow, reason: GoogleVersionReason): Promise<void> {
  const done = await transition(ctx, row, row.state, {
    state: "skipped",
    hold_reason: reason,
    last_error: GOOGLE_VERSION_REASONS[reason],
    next_attempt_at: null,
  });
  if (done) ctx.summary.skipped += 1;
}

/** Fails a version and raises the matching alert (if any). */
async function fail(
  ctx: RunContext,
  row: GoogleVersionRow,
  from: GoogleVersionState,
  reason: GoogleVersionReason,
  {
    alertKind,
    googleMessage,
    since,
  }: { alertKind: GoogleAlertKind | null; googleMessage?: string | null; since: string },
): Promise<void> {
  const text = googleMessage ? `${GOOGLE_VERSION_REASONS[reason]} Google said: ${googleMessage}` : GOOGLE_VERSION_REASONS[reason];
  const done = await transition(ctx, row, from, {
    state: "failed",
    hold_reason: reason,
    last_error: text,
    next_attempt_at: null,
  });
  if (!done) return;
  ctx.summary.failed += 1;
  if (alertKind) await alert(ctx, row, alertKind, text, since);
}

/** Back to pending after a temporary problem, or failed once the attempts run out. */
async function retryLater(
  ctx: RunContext,
  row: GoogleVersionRow,
  from: GoogleVersionState,
  reason: GoogleVersionReason,
  attempts: number,
  since: string,
): Promise<void> {
  if (attempts >= MAX_SEND_ATTEMPTS) {
    await fail(ctx, row, from, "still_failing", { alertKind: "failed", since });
    return;
  }
  const now = ctx.deps.now().getTime();
  const done = await transition(ctx, row, from, {
    state: "pending",
    attempts,
    next_attempt_at: iso(now + backoffMs(attempts, ctx.deps.random)),
    last_error: GOOGLE_VERSION_REASONS[reason],
  });
  if (done) ctx.summary.retrying += 1;
}

type ImageResult = { ok: true; url: string | null } | { ok: false };

/**
 * The Facebook post's plain feed image: the stored asset its variant uses,
 * never the story rendition and never the date strip the Facebook worker
 * renders at publish time. JPG or PNG, 10 KB to 5 MB where the size is
 * stored. Google's 250 by 250 minimum cannot be checked: media_assets holds
 * no dimensions. A video or an unsuitable file means no image (the post goes
 * out with its words); a signing failure is temporary and tried again.
 */
async function feedImage(ctx: RunContext, mediaIds: string[] | null): Promise<ImageResult> {
  const mediaId = mediaIds?.[0];
  if (!mediaId) return { ok: true, url: null };
  const { db } = ctx.deps;
  const { data: asset, error } = await db
    .from("media_assets")
    .select("id, storage_path, media_type, mime_type, size_bytes")
    .eq("account_id", ctx.brand.accountId)
    .eq("id", mediaId)
    .maybeSingle<{ id: string; storage_path: string; media_type: string; mime_type: string | null; size_bytes: number | null }>();
  if (error) return { ok: false };
  if (!asset || asset.media_type !== "image") return { ok: true, url: null };

  const path = asset.storage_path.startsWith(`${MEDIA_BUCKET}/`) ? asset.storage_path.slice(MEDIA_BUCKET.length + 1) : asset.storage_path;
  const mime = (asset.mime_type ?? "").toLowerCase();
  const extensionOk = /\.(jpe?g|png)$/i.test(path);
  const typeOk = mime ? ["image/jpeg", "image/jpg", "image/png"].includes(mime) : extensionOk;
  const size = typeof asset.size_bytes === "number" ? asset.size_bytes : null;
  const sizeOk = size === null || (size >= MIN_IMAGE_BYTES && size <= MAX_IMAGE_BYTES);
  if (!typeOk || !sizeOk) return { ok: true, url: null };

  const { data: signed, error: signError } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) return { ok: false };
  return { ok: true, url: signed.signedUrl };
}

type ParentDecision = { due: true } | { due: false; skip: GoogleVersionReason | null };

/** What the parent's current state means for a pending version. */
export function decideFromParent(row: GoogleVersionRow, parent: ParentRow | null, nowMs: number): ParentDecision {
  if (!parent || parent.deleted_at) return { due: false, skip: "parent_removed" };
  if (parent.status === "draft" || !parent.scheduled_for) return { due: false, skip: "parent_draft" };
  const scheduled = Date.parse(parent.scheduled_for);
  if (scheduled > nowMs) return { due: false, skip: null };
  if (nowMs - scheduled > LATE_LIMIT_MS) return { due: false, skip: "too_late" };
  // An EVENT post, or a standard reminder of an event (which keeps the event's end), is never sent after the event.
  if (row.event_end && Date.parse(row.event_end) <= nowMs) return { due: false, skip: "event_over" };
  return { due: true };
}

function stillHasTime(ctx: RunContext, needMs: number): boolean {
  return ctx.deps.now().getTime() + needMs <= ctx.deadline;
}

/** Claimed rows a run left behind (it crashed or timed out): treated as uncertain, never re-sent blindly. */
async function sweepStaleClaims(ctx: RunContext): Promise<void> {
  const cutoff = iso(ctx.deps.now().getTime() - STALE_CLAIM_MS);
  const { data, error } = await ctx.deps.db
    .from("gbp_posts")
    .select(GOOGLE_VERSION_COLUMNS)
    .eq("account_id", ctx.brand.accountId)
    .eq("state", "claimed")
    .lt("claimed_at", cutoff)
    .limit(20);
  if (error) {
    ctx.summary.errors += 1;
    return;
  }
  for (const row of (data ?? []) as GoogleVersionRow[]) {
    // Google is asked only once the grace period after the claim has passed.
    const claimedMs = row.claimed_at ? Date.parse(row.claimed_at) : ctx.deps.now().getTime();
    const done = await transition(ctx, row, "claimed", {
      state: "uncertain",
      next_attempt_at: iso(Math.max(ctx.deps.now().getTime(), claimedMs + RECONCILE_GRACE_MS)),
      last_error: GOOGLE_VERSION_REASONS.cannot_confirm,
    });
    if (done) ctx.summary.uncertain += 1;
  }
}

function normaliseText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A post on Google that is this version: same event title and start, or same opening words created after the claim. */
export function matchesVersion(post: GoogleLocalPost, row: GoogleVersionRow): boolean {
  if (row.topic_type === "EVENT") {
    if (post.topicType !== "EVENT" || !row.event_title || !row.event_start) return false;
    if (normaliseText(post.event?.title) !== normaliseText(row.event_title)) return false;
    const start = londonParts(row.event_start);
    const date = post.event?.schedule?.startDate;
    const time = post.event?.schedule?.startTime;
    return (
      date?.year === start.date.year &&
      date?.month === start.date.month &&
      date?.day === start.date.day &&
      (time?.hours ?? 0) === start.time.hours &&
      (time?.minutes ?? 0) === start.time.minutes
    );
  }
  const opening = normaliseText(row.summary).slice(0, 80);
  if (!opening || !normaliseText(post.summary).startsWith(opening)) return false;
  const claimed = row.claimed_at ? Date.parse(row.claimed_at) : Number.NaN;
  const created = post.createTime ? Date.parse(post.createTime) : Number.NaN;
  return Number.isFinite(claimed) && Number.isFinite(created) && created >= claimed - 60 * 1000;
}

async function findOnGoogle(
  ctx: RunContext,
  accessToken: string,
  row: GoogleVersionRow,
): Promise<{ ok: true; post: GoogleLocalPost | null } | { ok: false }> {
  let pageToken: string | undefined;
  for (let page = 0; page < LIST_PAGES; page += 1) {
    const result = await listLocalPosts(ctx.deps.fetch, accessToken, row.local_post_parent, pageToken);
    if (!result.ok) return { ok: false };
    const match = (result.data.localPosts ?? []).find((post) => matchesVersion(post, row));
    if (match) return { ok: true, post: match };
    pageToken = result.data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return { ok: true, post: null };
}

function sentPatch(post: GoogleLocalPost, nowMs: number): Record<string, unknown> {
  return {
    state: "sent",
    google_post_name: post.name,
    search_url: typeof post.searchUrl === "string" ? post.searchUrl : null,
    google_state: typeof post.state === "string" ? post.state : "PROCESSING",
    sent_at: iso(nowMs),
    next_check_at: iso(nowMs + FIRST_CHECK_MS),
    check_attempts: 0,
    last_checked_at: null,
    last_error: null,
    next_attempt_at: null,
    hold_reason: null,
  };
}

/** Uncertain versions whose time to reconcile has come. */
async function reconcileUncertain(ctx: RunContext): Promise<void> {
  const nowIso = iso(ctx.deps.now().getTime());
  const { data, error } = await ctx.deps.db
    .from("gbp_posts")
    .select(GOOGLE_VERSION_COLUMNS)
    .eq("account_id", ctx.brand.accountId)
    .eq("state", "uncertain")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(3);
  if (error) {
    ctx.summary.errors += 1;
    return;
  }

  for (const row of (data ?? []) as GoogleVersionRow[]) {
    if (!stillHasTime(ctx, 15_000)) return;
    const now = ctx.deps.now().getTime();
    const claimedAt = row.claimed_at ?? row.updated_at;
    const token = await ctx.tokens.get();
    const found = token.ok ? await findOnGoogle(ctx, token.accessToken, row) : ({ ok: false } as const);

    if (found.ok && found.post?.name) {
      const done = await transition(ctx, row, "uncertain", sentPatch(found.post, now));
      if (done) ctx.summary.adopted += 1;
      continue;
    }

    if (found.ok && row.resend_count < 1) {
      // Nothing on Google after the grace period: exactly one more send is allowed.
      const done = await transition(ctx, row, "uncertain", {
        state: "pending",
        resend_count: row.resend_count + 1,
        next_attempt_at: null,
        last_error: null,
      });
      if (done) ctx.summary.resent += 1;
      continue;
    }

    // Still unclear: the one re-send is used up, or Google could not be asked.
    const unclearFor = now - Date.parse(claimedAt);
    if (found.ok || unclearFor >= UNCERTAIN_ALERT_MS) {
      await alert(ctx, row, "unconfirmed", GOOGLE_VERSION_REASONS.cannot_confirm, claimedAt);
    }
    await transition(ctx, row, "uncertain", {
      next_attempt_at: iso(now + (found.ok ? RECONCILE_AGAIN_MS : RECONCILE_GRACE_MS)),
    });
  }
}

interface DueVersion {
  row: GoogleVersionRow;
  parent: ParentRow;
  body: string | null;
  mediaIds: string[] | null;
}

/** Which pending versions are due, after skipping those whose parent rules them out. */
async function findDue(ctx: RunContext): Promise<DueVersion[]> {
  const { db } = ctx.deps;
  const now = ctx.deps.now().getTime();
  const parentById = new Map<string, ParentRow>();
  const due: GoogleVersionRow[] = [];

  // Paged by creation time, so many future versions created earlier can never
  // hide a later-created one that is due now. Keyset paging with a seen set,
  // as a page can end inside a run of identical times.
  const seen = new Set<string>();
  let from: string | null = null;
  for (let page = 0; page < PENDING_SCAN_PAGES; page += 1) {
    let query = db
      .from("gbp_posts")
      .select(GOOGLE_VERSION_COLUMNS)
      .eq("account_id", ctx.brand.accountId)
      .eq("state", "pending");
    if (from) query = query.gte("created_at", from);
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PENDING_SCAN_LIMIT);
    if (error) {
      ctx.summary.errors += 1;
      return [];
    }
    const rows = (data ?? []) as GoogleVersionRow[];
    const unseen = rows.filter((row) => !seen.has(row.id));
    if (!unseen.length) break;
    for (const row of unseen) seen.add(row.id);

    // Due-ness lives on the parent, so nothing is cut short before the parents are read.
    const pending = unseen.filter((row) => !row.next_attempt_at || Date.parse(row.next_attempt_at) <= now);
    // Read in chunks so a long pending list never makes an over-long request URL.
    const ids = pending.map((row) => row.content_item_id);
    for (let start = 0; start < ids.length; start += IN_CHUNK) {
      const { data: parentData, error: parentError } = await db
        .from("content_items")
        .select("id, account_id, platform, placement, status, scheduled_for, deleted_at")
        .eq("account_id", ctx.brand.accountId)
        .in("id", ids.slice(start, start + IN_CHUNK));
      if (parentError) {
        ctx.summary.errors += 1;
        return [];
      }
      for (const parent of (parentData ?? []) as ParentRow[]) parentById.set(parent.id, parent);
    }

    for (const row of pending) {
      const decision = decideFromParent(row, parentById.get(row.content_item_id) ?? null, now);
      if (decision.due) due.push(row);
      else if (decision.skip) await skip(ctx, row, decision.skip);
    }

    if (rows.length < PENDING_SCAN_LIMIT) break;
    from = rows[rows.length - 1].created_at;
  }
  if (!due.length) return [];

  const chosen = due
    .sort((a, b) => Date.parse(parentById.get(a.content_item_id)?.scheduled_for ?? "") - Date.parse(parentById.get(b.content_item_id)?.scheduled_for ?? ""))
    .slice(0, SEND_BATCH);
  const { data: variants, error: variantError } = await db
    .from("content_variants")
    .select("content_item_id, body, media_ids")
    .in("content_item_id", chosen.map((row) => row.content_item_id));
  if (variantError) {
    ctx.summary.errors += 1;
    return [];
  }
  const variantById = new Map(
    ((variants ?? []) as Array<{ content_item_id: string; body: string | null; media_ids: string[] | null }>).map((variant) => [
      variant.content_item_id,
      variant,
    ]),
  );
  return chosen.map((row) => ({
    row,
    parent: parentById.get(row.content_item_id) as ParentRow,
    body: variantById.get(row.content_item_id)?.body ?? null,
    mediaIds: variantById.get(row.content_item_id)?.media_ids ?? null,
  }));
}

type SendOutcome = "done" | "stop_brand";

async function sendOne(ctx: RunContext, due: DueVersion): Promise<SendOutcome> {
  const { row } = due;
  const now = ctx.deps.now().getTime();
  const nowIso = iso(now);

  // The switch, the connection and the destination, read again now.
  const check = await checkGoogleBrand(ctx.deps.db, ctx.brand.accountId);
  if (!check.ok) {
    if (check.reason === "switched_off") {
      await skip(ctx, row, "switched_off");
      return "stop_brand";
    }
    if (check.reason === "connection_missing") {
      await fail(ctx, row, "pending", "connection_missing", { alertKind: null, since: nowIso });
      return "stop_brand";
    }
    ctx.summary.errors += 1;
    return "stop_brand";
  }
  if (check.brand.localPostParent !== row.local_post_parent) {
    // Never retargeted: the version was prepared for another profile.
    await fail(ctx, row, "pending", "destination_changed", { alertKind: "failed", since: row.created_at });
    return "done";
  }

  // The wording follows the Facebook post until a person edits or releases it.
  let summary = row.summary;
  if (!row.summary_edited_at) {
    summary = deriveGoogleSummary(due.body);
    const hold = holdForWording(summary);
    if (hold) {
      const done = await transition(ctx, row, "pending", { state: "held", hold_reason: hold, summary });
      if (done) ctx.summary.held += 1;
      return "done";
    }
  }

  const token = await ctx.tokens.get();
  if (!token.ok) {
    if (token.reason === "reconnect_needed") {
      await fail(ctx, row, "pending", "reconnect_needed", { alertKind: "reconnect", since: nowIso });
      return "stop_brand";
    }
    if (token.reason === "not_connected") {
      await fail(ctx, row, "pending", "connection_missing", { alertKind: null, since: nowIso });
      return "stop_brand";
    }
    await retryLater(ctx, row, "pending", "token_unavailable", row.attempts + 1, nowIso);
    return "stop_brand";
  }

  const image = await feedImage(ctx, due.mediaIds);
  if (!image.ok) {
    await retryLater(ctx, row, "pending", "google_unavailable", row.attempts + 1, nowIso);
    return "done";
  }

  let request;
  try {
    request = buildLocalPostBody({ ...row, summary }, image.url);
  } catch {
    await fail(ctx, row, "pending", "google_refused", { alertKind: "failed", since: nowIso });
    return "done";
  }

  // The claim, immediately before the request. Zero rows: another run owns it.
  const attempts = row.attempts + 1;
  const claimedAt = iso(ctx.deps.now().getTime());
  const claimed = await transition(
    ctx,
    row,
    "pending",
    { state: "claimed", claimed_at: claimedAt, attempts, summary },
    { unchangedSince: row.updated_at },
  );
  // Zero rows: another run owns it, or a person changed it since it was read
  // (the next run reads it afresh).
  if (!claimed) return "done";
  const claimedRow: GoogleVersionRow = { ...row, state: "claimed", claimed_at: claimedAt, attempts, summary };

  let result: GoogleCallResult<GoogleLocalPost> = await createLocalPost(ctx.deps.fetch, token.accessToken, row.local_post_parent, request);

  if (!result.ok && result.kind === "http" && result.status === 401) {
    // One forced refresh and one more try; a second 401 needs the owner.
    const fresh = await ctx.tokens.get(true);
    if (!fresh.ok) {
      if (fresh.reason === "try_again") {
        await retryLater(ctx, claimedRow, "claimed", "token_unavailable", attempts, claimedAt);
      } else {
        await fail(ctx, claimedRow, "claimed", "reconnect_needed", { alertKind: "reconnect", since: claimedAt });
      }
      return "stop_brand";
    }
    result = await createLocalPost(ctx.deps.fetch, fresh.accessToken, row.local_post_parent, request);
    if (!result.ok && result.kind === "http" && result.status === 401) {
      await fail(ctx, claimedRow, "claimed", "reconnect_needed", { alertKind: "reconnect", since: claimedAt });
      return "stop_brand";
    }
  }

  const after = ctx.deps.now().getTime();
  if (result.ok) {
    if (!result.data?.name) {
      // Accepted, but with nothing to track it by: find it the way a lost answer is found.
      const done = await transition(ctx, claimedRow, "claimed", { state: "uncertain", next_attempt_at: iso(after + RECONCILE_GRACE_MS) });
      if (done) ctx.summary.uncertain += 1;
      return "done";
    }
    const done = await transition(ctx, claimedRow, "claimed", sentPatch(result.data, after));
    if (done) ctx.summary.sent += 1;
    return "done";
  }

  if (result.kind === "no_answer") {
    const done = await transition(ctx, claimedRow, "claimed", {
      state: "uncertain",
      next_attempt_at: iso(after + RECONCILE_GRACE_MS),
      last_error: GOOGLE_VERSION_REASONS.cannot_confirm,
    });
    if (done) ctx.summary.uncertain += 1;
    return "done";
  }

  if (result.kind === "not_sent") {
    await retryLater(ctx, claimedRow, "claimed", "google_unavailable", attempts, claimedAt);
    return "done";
  }

  const { status, message } = result;
  if (status === 429) {
    // Once Google has approved access a 429 is a real rate limit, so it is retried.
    await retryLater(ctx, claimedRow, "claimed", "google_busy", attempts, claimedAt);
    return "stop_brand";
  }
  if (status === 503) {
    // Unavailable: Google did not take the request, so it is safe to send again later.
    await retryLater(ctx, claimedRow, "claimed", "google_unavailable", attempts, claimedAt);
    return "done";
  }
  if (status >= 500) {
    // Any other server error may have created the post anyway. It is treated
    // like a lost answer: Google is checked first and it is re-sent at most once.
    const done = await transition(ctx, claimedRow, "claimed", {
      state: "uncertain",
      next_attempt_at: iso(after + RECONCILE_GRACE_MS),
      last_error: GOOGLE_VERSION_REASONS.cannot_confirm,
    });
    if (done) ctx.summary.uncertain += 1;
    return "done";
  }
  if (status === 403) {
    await fail(ctx, claimedRow, "claimed", "not_permitted", { alertKind: "failed", googleMessage: message, since: claimedAt });
    return "done";
  }
  if (status === 404) {
    await fail(ctx, claimedRow, "claimed", "profile_not_found", { alertKind: "failed", googleMessage: message, since: claimedAt });
    return "done";
  }
  // 400 and anything else: Google refused this post. Its own words are kept, sanitised.
  await fail(ctx, claimedRow, "claimed", "google_refused", { alertKind: "failed", googleMessage: message, since: claimedAt });
  return "done";
}

/**
 * One brand's sending step: stale claims, uncertain versions, then up to
 * SEND_BATCH due versions, stopping before the deadline.
 */
export async function sendDueVersions(
  deps: GooglePostsDeps,
  brand: GoogleBrand,
  { deadline, tokens, summary = emptySendSummary() }: { deadline: number; tokens?: TokenSource; summary?: SendSummary },
): Promise<SendSummary> {
  const ctx: RunContext = { deps, brand, tokens: tokens ?? createTokenSource(deps, brand.accountId), summary, deadline };

  await sweepStaleClaims(ctx);
  await reconcileUncertain(ctx);

  const due = await findDue(ctx);
  for (const item of due) {
    // Room for one full create and a retry after a 401.
    if (!stillHasTime(ctx, 2 * GOOGLE_CREATE_TIMEOUT_MS + 2_000)) break;
    try {
      const outcome = await sendOne(ctx, item);
      if (outcome === "stop_brand") break;
    } catch (error) {
      ctx.summary.errors += 1;
      logger.error("a Google version could not be processed", error instanceof Error ? new Error(error.message) : new Error("unknown"), {
        accountId: brand.accountId,
        versionId: item.row.id,
      });
    }
  }

  return ctx.summary;
}

