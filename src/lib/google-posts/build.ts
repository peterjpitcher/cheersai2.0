/**
 * Building a Google version from a Facebook feed post
 * (tasks/SPEC-gbp-posting-reintroduction.md, decisions D5, D6 and D12).
 * Pure: no database, no network, no env. The caller supplies the post, its
 * copy, its campaign, the destination, and the event details already looked
 * up (see ./management-lookup.ts).
 *
 * Rules:
 * - Only a Facebook FEED post that is approved (not a draft), not trashed and
 *   scheduled no more than a few minutes in the past. Never a story, never an
 *   Instagram item.
 * - Event campaigns (D13, Peter, 26 November 2026): every Facebook feed post
 *   of the campaign gets a Google post. The earliest upcoming one is THE
 *   event's Google post (the caller decides which that is); the later ones
 *   are reminders, sent as STANDARD posts with the same button and no
 *   source_event_key. source_event_key on the event's own post is the
 *   campaign's stored key, else mgmt:<id> for a matched management event,
 *   else campaign:<campaign id>, and the partial unique index on
 *   (account_id, source_event_key, local_post_parent) guarantees one such
 *   post per event.
 * - The event's own post, with a start and an end and the end still ahead: an
 *   EVENT post, the title cut at a word boundary to 58 characters, a BOOK
 *   button when the event takes bookings, otherwise LEARN_MORE (D6), and only
 *   with an https Google link. With no end: a STANDARD post, so the event is
 *   still announced. An event that has already ended gets nothing, reminders
 *   included.
 * - Other posts: STANDARD, with a LEARN_MORE button only when the campaign
 *   holds a googleCtaUrl.
 * - The wording is derived from the Facebook copy (./summary.ts); wording that
 *   looks like an alcohol price promotion, or that is empty, makes the version
 *   `held` for a person.
 */

import { DateTime } from "luxon";

import type { GoogleCtaType, GoogleVersionInsert } from "@/lib/google-posts/model";
import { deriveGoogleSummary, holdForWording } from "@/lib/google-posts/summary";

/** A post scheduled further in the past than this is never given a Google version. */
export const CREATE_GRACE_MS = 5 * 60 * 1000;
export const GOOGLE_EVENT_TITLE_MAX = 58;

const SOURCE_EVENT_KEY = /^(mgmt|campaign):.+/;

/** The content_items columns the builder reads (production's v1 shape). */
export interface ParentItem {
  id: string;
  account_id: string;
  campaign_id: string | null;
  platform: string | null;
  placement: string | null;
  status: string;
  scheduled_for: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface CampaignInfo {
  id: string;
  campaign_type: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
}

/** An event's details once resolved, from the campaign or the management app. */
export interface ResolvedEvent {
  title: string | null;
  start: string | null;
  end: string | null;
  googleCtaUrl: string | null;
  takesBookings: boolean;
  managementEventId: string | null;
}

export type IneligibleReason =
  | "not_facebook"
  | "not_feed"
  | "draft"
  | "trashed"
  | "not_scheduled"
  | "in_the_past"
  | "event_over"
  | "invalid_destination";

export const INELIGIBLE_TEXT: Record<IneligibleReason, string> = {
  not_facebook: "not a Facebook post",
  not_feed: "a story, not a feed post",
  draft: "still a draft",
  trashed: "in the bin",
  not_scheduled: "has no scheduled time",
  in_the_past: "its time has passed",
  event_over: "the event has finished",
  invalid_destination: "the Google location is not valid",
};

export type BuildResult = { ok: true; row: GoogleVersionInsert } | { ok: false; reason: IneligibleReason };

/** Why a post can never have a Google version, or null when it might. */
export function parentIneligibility(item: ParentItem, now: Date): IneligibleReason | null {
  if (item.platform !== "facebook") return "not_facebook";
  if ((item.placement ?? "feed") !== "feed") return "not_feed";
  if (item.deleted_at) return "trashed";
  if (item.status === "draft") return "draft";
  if (!item.scheduled_for || Number.isNaN(Date.parse(item.scheduled_for))) return "not_scheduled";
  if (Date.parse(item.scheduled_for) < now.getTime() - CREATE_GRACE_MS) return "in_the_past";
  return null;
}

/** Cut at a word boundary to `max` code points. */
export function cutTitle(title: string, max = GOOGLE_EVENT_TITLE_MAX): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const points = Array.from(clean);
  if (points.length <= max) return clean;
  const head = points.slice(0, max + 1).join("");
  const space = head.lastIndexOf(" ");
  const cut = space > 0 ? head.slice(0, space) : points.slice(0, max).join("");
  return cut.replace(/[\s,;:.\-]+$/u, "").trim();
}

function httpsOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** What the campaign itself says about its event, before any management lookup. */
export function eventFromCampaign(campaign: CampaignInfo): ResolvedEvent & {
  storedKey: string | null;
  /** London date and time of the start, for an exact management match. */
  startDate: string | null;
  startTime: string | null;
} {
  const metadata = campaign.metadata ?? {};
  const brief = (metadata.brief && typeof metadata.brief === "object" ? metadata.brief : {}) as Record<string, unknown>;
  const storedKey = text(metadata.sourceEventKey);
  const keyId = storedKey?.startsWith("mgmt:") ? storedKey.slice(5) : null;
  const start = text(metadata.eventStart);
  const end = text(metadata.eventEnd);
  return {
    title: text(metadata.eventTitle) ?? text(brief.eventName) ?? text(campaign.name),
    start: start && !Number.isNaN(Date.parse(start)) ? start : null,
    end: end && !Number.isNaN(Date.parse(end)) ? end : null,
    googleCtaUrl: httpsOrNull(metadata.googleCtaUrl),
    takesBookings: metadata.takesBookings === true,
    managementEventId: keyId ?? text(brief.managementEventId),
    storedKey: storedKey && SOURCE_EVENT_KEY.test(storedKey) ? storedKey : null,
    startDate: text(metadata.startDate) ?? text(brief.eventDate),
    startTime: (text(metadata.startTime) ?? text(brief.eventTime))?.slice(0, 5) ?? null,
  };
}

/** True when the campaign holds its own start and end, so no management lookup is wanted. */
export function campaignEventIsComplete(campaign: CampaignInfo): boolean {
  const event = eventFromCampaign(campaign);
  return Boolean(event.start && event.end);
}

/** The campaign's event with what the management app matched laid over it. */
export function mergeMatchedEvent(
  campaign: CampaignInfo,
  matched: { managementEventId: string; start: string | null; end: string | null; googleCtaUrl: string | null; takesBookings: boolean } | null,
): ResolvedEvent {
  const fromCampaign = eventFromCampaign(campaign);
  if (!matched) return fromCampaign;
  const useMatchedTimes = Boolean(matched.start && matched.end);
  return {
    title: fromCampaign.title,
    start: useMatchedTimes ? matched.start : fromCampaign.start,
    end: useMatchedTimes ? matched.end : fromCampaign.end,
    googleCtaUrl: httpsOrNull(matched.googleCtaUrl) ?? fromCampaign.googleCtaUrl,
    takesBookings: matched.takesBookings || fromCampaign.takesBookings,
    managementEventId: matched.managementEventId,
  };
}

export interface BuildInput {
  item: ParentItem;
  body: string | null;
  campaign: CampaignInfo | null;
  localPostParent: string;
  now: Date;
  /**
   * For an event campaign: true when this post is the event's own Google post
   * (the earliest upcoming Facebook feed post of a campaign that has none
   * yet); false for a later post, which becomes a STANDARD reminder.
   */
  isFirstEventPost: boolean;
  /** For an event campaign: the details resolved from the campaign and, if needed, the management app. */
  event: ResolvedEvent | null;
}

export function buildGoogleVersion(input: BuildInput): BuildResult {
  const { item, campaign, now } = input;
  const ineligible = parentIneligibility(item, now);
  if (ineligible) return { ok: false, reason: ineligible };
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(input.localPostParent)) return { ok: false, reason: "invalid_destination" };

  const summary = deriveGoogleSummary(input.body);
  const hold = holdForWording(summary);
  const base = {
    account_id: item.account_id,
    content_item_id: item.id,
    local_post_parent: input.localPostParent,
    state: hold ? ("held" as const) : ("pending" as const),
    hold_reason: hold,
    summary,
  };

  const isEvent = campaign?.campaign_type === "event";
  if (!isEvent || !campaign) {
    const ctaUrl = httpsOrNull(campaign?.metadata?.googleCtaUrl);
    return {
      ok: true,
      row: {
        ...base,
        source_event_key: null,
        topic_type: "STANDARD",
        cta_type: ctaUrl ? "LEARN_MORE" : null,
        cta_url: ctaUrl,
        event_title: null,
        event_start: null,
        event_end: null,
      },
    };
  }

  const fromCampaign = eventFromCampaign(campaign);
  const event = input.event ?? fromCampaign;

  const ctaUrl = httpsOrNull(event.googleCtaUrl);
  const ctaType: GoogleCtaType | null = ctaUrl ? (event.takesBookings ? "BOOK" : "LEARN_MORE") : null;

  const start = event.start ? DateTime.fromISO(event.start) : null;
  const end = event.end ? DateTime.fromISO(event.end) : null;
  if (end?.isValid && end.toMillis() <= now.getTime()) return { ok: false, reason: "event_over" };

  // A later post of the event: a reminder, sent as a standard post with the
  // event's button. No event key, so the one-per-event index never sees it.
  if (!input.isFirstEventPost) {
    return {
      ok: true,
      row: {
        ...base,
        source_event_key: null,
        topic_type: "STANDARD",
        cta_type: ctaType,
        cta_url: ctaUrl,
        event_title: null,
        event_start: null,
        event_end: null,
      },
    };
  }

  const sourceEventKey =
    fromCampaign.storedKey ??
    (event.managementEventId ? `mgmt:${event.managementEventId}` : null) ??
    `campaign:${campaign.id}`;

  const title = event.title ? cutTitle(event.title) : "";
  const canBeEvent = Boolean(start?.isValid && end?.isValid && end.toMillis() > (start?.toMillis() ?? 0) && title);

  return {
    ok: true,
    row: {
      ...base,
      source_event_key: sourceEventKey,
      topic_type: canBeEvent ? "EVENT" : "STANDARD",
      cta_type: ctaType,
      cta_url: ctaUrl,
      event_title: canBeEvent ? title : null,
      event_start: canBeEvent ? (start?.toUTC().toISO() ?? null) : null,
      event_end: canBeEvent ? (end?.toUTC().toISO() ?? null) : null,
    },
  };
}
