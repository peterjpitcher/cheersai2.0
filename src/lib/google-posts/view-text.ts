/**
 * Plain words for the Google section of the planner post page (decision D12).
 * The sentence on where a version is (statusLine) and which buttons apply
 * (canEdit and the rest) come from the view itself; this module adds the short
 * chip label, the button and moderation words, the event times and the
 * character count.
 *
 * Pure and browser-safe: no env, no database.
 */

import { DateTime } from "luxon";

import type { GoogleCtaType, GoogleVersionView } from "@/lib/google-posts/model";

/** The status chip tones that already have design tokens (--c-status-{tone}-fg and -bg). */
export type GoogleChipTone = "posted" | "publishing" | "scheduled" | "draft" | "failed";

export interface GoogleChip {
  label: string;
  tone: GoogleChipTone;
}

/** Only a Facebook feed post can have a Google version. */
export function postCanHaveGoogleVersion(post: { platform: string | null; placement: string | null }): boolean {
  return post.platform === "facebook" && post.placement === "feed";
}

/** The short label for the chip beside the "Google" heading. */
export function googleStateChip(view: Pick<GoogleVersionView, "state" | "googleState">): GoogleChip {
  switch (view.state) {
    case "pending":
      return { label: "Waiting for its time", tone: "scheduled" };
    case "held":
      return { label: "Held", tone: "draft" };
    case "claimed":
      return { label: "Sending", tone: "publishing" };
    case "sent":
      if (view.googleState === "LIVE") return { label: "Posted", tone: "posted" };
      if (view.googleState === "REJECTED") return { label: "Rejected", tone: "failed" };
      return { label: "Sent", tone: "publishing" };
    case "uncertain":
      return { label: "Could not confirm", tone: "failed" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    case "skipped":
      return { label: "Skipped", tone: "draft" };
    default:
      return { label: "Google version", tone: "draft" };
  }
}

const BUTTON_LABELS: Record<GoogleCtaType, string> = {
  BOOK: "Book",
  LEARN_MORE: "Learn more",
};

export function googleButtonLabel(type: GoogleCtaType | string): string {
  return type in BUTTON_LABELS ? BUTTON_LABELS[type as GoogleCtaType] : "Button";
}

/** Google's own moderation state in plain words; null before anything was sent. */
export function googleModerationLabel(state: string | null | undefined): string | null {
  if (!state) return null;
  switch (state) {
    case "LIVE":
      return "Live";
    case "PROCESSING":
      return "Google is still checking it";
    case "REJECTED":
      return "Rejected by Google";
    default:
      return "Not known yet";
  }
}

/**
 * An event's times in the owner's time zone, for example
 * "Saturday 21 November 2026, 19:00 to 23:00". An end on another day names
 * that day too. Null when there is no valid start.
 */
export function formatGoogleEventTimes(start: string | null, end: string | null, zone: string): string | null {
  if (!start) return null;
  const from = DateTime.fromISO(start, { zone: "utc" }).setZone(zone);
  if (!from.isValid) return null;
  const day = "cccc d LLLL yyyy";
  const first = `${from.toFormat(day)}, ${from.toFormat("HH:mm")}`;
  if (!end) return first;
  const to = DateTime.fromISO(end, { zone: "utc" }).setZone(zone);
  if (!to.isValid) return first;
  if (to.hasSame(from, "day")) return `${first} to ${to.toFormat("HH:mm")}`;
  return `${first} to ${to.toFormat(day)}, ${to.toFormat("HH:mm")}`;
}

/** Characters as Google and Postgres count them: Unicode code points, so an emoji is one. */
export function countGoogleCharacters(text: string): number {
  return Array.from(text).length;
}
