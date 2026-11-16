/**
 * Google versions: the shape of a public.gbp_posts row and the words used for
 * its states (tasks/SPEC-gbp-posting-reintroduction.md, decision D12).
 *
 * A Google version is ATTACHED to one Facebook feed post. It is never a
 * content item and never a publish job, so nothing here touches the content
 * `Platform` type or the Facebook and Instagram publish worker.
 *
 * Pure and browser-safe: no env, no database.
 */

export const GOOGLE_VERSION_STATES = ["pending", "held", "claimed", "sent", "uncertain", "failed", "skipped"] as const;
export type GoogleVersionState = (typeof GOOGLE_VERSION_STATES)[number];

export type GoogleTopicType = "STANDARD" | "EVENT";
export type GoogleCtaType = "BOOK" | "LEARN_MORE";

/** Why a version is waiting for a person. */
export type GoogleHoldReason = "alcohol_promotion" | "no_wording";

/** A public.gbp_posts row, as the service client returns it. */
export interface GoogleVersionRow {
  id: string;
  account_id: string;
  content_item_id: string;
  source_event_key: string | null;
  local_post_parent: string;
  google_post_name: string | null;
  search_url: string | null;
  google_state: string | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  check_attempts: number;
  last_error: string | null;
  state: GoogleVersionState;
  hold_reason: string | null;
  topic_type: GoogleTopicType;
  summary: string;
  cta_type: GoogleCtaType | null;
  cta_url: string | null;
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
  attempts: number;
  next_attempt_at: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  summary_edited_at: string | null;
  resend_count: number;
  created_at: string;
  updated_at: string;
}

/** Every column the sender, the checks and the read API need. */
export const GOOGLE_VERSION_COLUMNS =
  "id, account_id, content_item_id, source_event_key, local_post_parent, google_post_name, search_url, google_state, last_checked_at, next_check_at, check_attempts, last_error, state, hold_reason, topic_type, summary, cta_type, cta_url, event_title, event_start, event_end, attempts, next_attempt_at, claimed_at, sent_at, summary_edited_at, resend_count, created_at, updated_at";

/** The fields written when a version is created. Matches the migration's NOT NULLs and CHECKs. */
export interface GoogleVersionInsert {
  account_id: string;
  content_item_id: string;
  source_event_key: string | null;
  local_post_parent: string;
  state: "pending" | "held";
  hold_reason: GoogleHoldReason | null;
  topic_type: GoogleTopicType;
  summary: string;
  cta_type: GoogleCtaType | null;
  cta_url: string | null;
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
}

/** Plain words for the reasons a version is held or skipped, or why a send failed. */
export const GOOGLE_VERSION_REASONS = {
  alcohol_promotion:
    "This wording looks like a drinks price offer, which Google restricts. Check the Google wording, then release it or skip it.",
  no_wording: "There is no wording left for Google once hashtags, handles and links are removed. Write some, then release it.",
  parent_removed: "The Facebook post this belongs to was removed, so the Google version was not sent.",
  parent_draft: "The Facebook post this belongs to went back to draft, so the Google version was not sent.",
  too_late: "The Google version was more than a day late, so it was not sent.",
  event_over: "The event had already finished, so the Google version was not sent.",
  switched_off: "Google posting was switched off for this brand, so the Google version was not sent.",
  skipped_by_person: "Someone chose not to send this to Google.",
  destination_changed:
    "The Google profile was changed after this was prepared, so it was not sent. Create it again for the new profile.",
  reconnect_needed: "Google needs to be reconnected before this can be sent.",
  connection_missing: "The Google connection is not active, so this was not sent.",
  not_permitted: "Google refused this post for the connected profile. Check the Google connection.",
  profile_not_found: "Google could not find the connected profile. Reconnect Google and choose the profile again.",
  still_failing: "Google kept refusing or timing out, so we stopped trying.",
  google_busy: "Google asked us to slow down. We will try again shortly.",
  cannot_confirm: "We could not confirm whether Google received this post. Check the profile before sending it again.",
} as const;

export type GoogleVersionReason = keyof typeof GOOGLE_VERSION_REASONS;
