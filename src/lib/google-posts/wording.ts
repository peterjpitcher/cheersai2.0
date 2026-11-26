/**
 * Wording written for Google (tasks/SPEC-gbp-separate-posts.md, decisions D15
 * and D17). Server only; service-role client, every query scoped by account_id.
 *
 * A Google post starts with wording derived from its Facebook post (the
 * fallback, see ./summary.ts) and wording_source 'awaiting_ai'. This job asks
 * the AI to write wording for Google from that Facebook copy, checks it, and
 * stores it with wording_source 'ai', after which it is frozen: the sender no
 * longer re-derives it from the Facebook post.
 *
 * The AI may only re-say what the Facebook copy says. checkGoogleWording()
 * refuses a draft that contains a number, a price, a time (each compared whole,
 * with its currency sign or am/pm), a day, a month or the word "free" that is
 * not in the Facebook copy or the event details, a
 * banned phrase, or wording the copy rules would hold (a drinks price offer).
 * A refused draft is tried again on a later run; after MAX_WORDING_ATTEMPTS
 * refusals the post goes back to following the Facebook wording
 * (wording_source 'facebook'), so a Google post is never left without wording
 * and never sent with wording that failed a check. A call that fails outright
 * (an outage, a timeout) is not a refusal and never counts towards giving up.
 *
 * Never touched: a post a person has edited or released, a held post (a
 * person is already looking at its wording), a post already sent, and the
 * posts marked 'facebook' (D17: the four of 26 November 2026).
 *
 * Nothing logged here holds the post's text.
 */

import { DateTime } from "luxon";

import { replaceEmDashes } from "@/lib/ai/postprocess";
import { detectBannedPhrases } from "@/lib/ai/voice";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { GoogleBrand } from "@/lib/google-posts/brands";
import type { GooglePostsDeps } from "@/lib/google-posts/deps";
import { deriveGoogleSummary, holdForWording } from "@/lib/google-posts/summary";
import { createLogger } from "@/lib/logging";

const logger = createLogger("google-posts");

/** Drafts tried for one post before it goes back to following the Facebook wording. */
export const MAX_WORDING_ATTEMPTS = 3;
/** Posts written per brand per run. One AI call can take most of a minute. */
export const WORDING_BATCH = 2;
/** A new call starts only with this much of the run left. */
export const WORDING_CALL_BUDGET_MS = 50_000;
/** Shorter than this is not a post. */
const MIN_WORDING_CHARS = 40;

export interface GoogleWordingInput {
  /** The venue's name, as the brand has it. */
  venueName: string | null;
  topicType: "STANDARD" | "EVENT";
  eventTitle: string | null;
  /** The event's times in plain London words, when the post is an event post. */
  eventWhen: string | null;
  /** The Facebook post's approved copy. */
  facebookCopy: string;
}

/** Writes one draft. Supplied through deps so tests never reach OpenAI. */
export type GoogleWordingWriter = (input: GoogleWordingInput, context: { accountId: string }) => Promise<string>;

export interface WordingSummary {
  written: number;
  /** A draft was refused, or the AI call failed; it will be tried again. */
  retried: number;
  /** Gave up after MAX_WORDING_ATTEMPTS: the post follows the Facebook wording. */
  fellBack: number;
  errors: number;
}

export function emptyWordingSummary(): WordingSummary {
  return { written: 0, retried: 0, fellBack: 0, errors: 0 };
}

export const GOOGLE_WORDING_SYSTEM_PROMPT = [
  "You rewrite a venue's approved Facebook post as a post for its Google profile, the panel people see when they search for the venue on Google or Google Maps.",
  "Readers are deciding whether to visit or book. Google shows only the first line or two before a 'more' link.",
  "Rules:",
  "1. Use only facts that are in the Facebook post or the event details given. Never add, change or guess a price, time, date, day, offer, age rule or any other fact. If a fact is not given, leave it out.",
  "2. Open with the most useful detail: what it is, when, and the venue and place name if the Facebook post gives them.",
  "3. Plain British English. Short sentences. Warm, not hyped. No exclamation marks.",
  "4. No hashtags, no @ handles, no links, no phone numbers, no email addresses, and no 'link in bio' or 'book via the link' lines. Google adds its own button.",
  "5. At most one emoji, and none is fine.",
  "6. Between 60 and 150 words. Use short paragraphs separated by a blank line.",
  "7. Never use a long dash. Use a comma or a full stop.",
  "8. Write times and dates exactly as the Facebook post writes them.",
  "Return only the wording.",
].join("\n");

export function buildGoogleWordingPrompt(input: GoogleWordingInput): string {
  const lines = [
    input.venueName ? `Venue: ${input.venueName}` : null,
    input.topicType === "EVENT" && input.eventTitle ? `This is an event post for: ${input.eventTitle}` : null,
    input.eventWhen ? `Event time: ${input.eventWhen}` : null,
    "Facebook post:",
    '"""',
    input.facebookCopy.trim(),
    '"""',
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

/** An event's start and end as London wall-clock words, or null. GMT and BST are handled by the zone. */
export function describeEventWhen(start: string | null, end: string | null, zone: string = DEFAULT_TIMEZONE): string | null {
  if (!start) return null;
  const from = DateTime.fromISO(start, { zone: "utc" }).setZone(zone);
  if (!from.isValid) return null;
  const first = `${from.toFormat("cccc d LLLL yyyy")}, ${from.toFormat("h:mma").toLowerCase()}`;
  if (!end) return first;
  const to = DateTime.fromISO(end, { zone: "utc" }).setZone(zone);
  if (!to.isValid) return first;
  return `${first} to ${to.toFormat("h:mma").toLowerCase()}`;
}

const CALENDAR_WORDS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "today", "tonight", "tomorrow", "weekend", "midnight", "noon", "midday",
] as const;

/**
 * Every number in the text WITH what makes it a price or a time: a currency
 * sign in front, and "am", "pm", "p" or "%" behind. So "£5", "7pm", "6:30pm",
 * "11th" and "20%" give "£5", "7pm", "6:30pm", "11" and "20%". A draft's
 * tokens must each match one of the source's exactly, so "£7" is not excused
 * by a "7pm" in the source, and "7am" is not excused by "7pm".
 */
function numberTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(/([£$€])?\s?(\d+(?:[.:]\d+)?)\s?(am|pm|p\b|%)?/g)) {
    const [, currency = "", digits, unit = ""] = match;
    tokens.push(`${currency}${digits.replace(/^0+(?=\d)/, "")}${unit}`);
  }
  return tokens;
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
}

export type WordingRefusal =
  | "empty"
  | "too_short"
  | "new_number"
  | "new_date_word"
  | "new_free_claim"
  | "banned_phrase"
  | "would_be_held";

/**
 * Checks an AI draft against what it was given. Returns the wording ready to
 * store (the copy rules applied), or why it was refused. Pure.
 */
export function checkGoogleWording(
  draft: string,
  input: GoogleWordingInput,
): { ok: true; summary: string } | { ok: false; reason: WordingRefusal } {
  // Long dashes are never published: the copy engine's own repair, then a comma for the shorter dash.
  const cleaned = deriveGoogleSummary(replaceEmDashes(draft).replace(/\s*–\s*/g, ", "));
  if (!cleaned.trim()) return { ok: false, reason: "empty" };
  if (Array.from(cleaned).length < MIN_WORDING_CHARS) return { ok: false, reason: "too_short" };

  const source = [input.facebookCopy, input.eventTitle ?? "", input.eventWhen ?? "", input.venueName ?? ""].join("\n");

  const known = new Set(numberTokens(source));
  if (numberTokens(cleaned).some((token) => !known.has(token))) return { ok: false, reason: "new_number" };

  // "may" is left out of the calendar words: it is also an ordinary word ("you may book").
  const sourceWords = wordSet(source);
  const draftWords = wordSet(cleaned);
  if (CALENDAR_WORDS.some((word) => draftWords.has(word) && !sourceWords.has(word))) {
    return { ok: false, reason: "new_date_word" };
  }
  if (draftWords.has("free") && !sourceWords.has("free")) return { ok: false, reason: "new_free_claim" };

  if (detectBannedPhrases(cleaned).length > 0) return { ok: false, reason: "banned_phrase" };
  // The derived wording was not held (the post is pending), so a draft that would be is refused, never used to hold it.
  if (holdForWording(cleaned)) return { ok: false, reason: "would_be_held" };

  return { ok: true, summary: cleaned };
}

interface WaitingRow {
  id: string;
  content_item_id: string;
  topic_type: "STANDARD" | "EVENT";
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
  wording_attempts: number;
  updated_at: string;
}

/**
 * Writes Google wording for the brand's waiting posts, oldest first, a few a
 * run. Each change is a compare-and-set on the row as it was read, so a
 * person's edit or a send that happened meanwhile always wins.
 */
export async function writeGoogleWordings(
  deps: GooglePostsDeps,
  brand: GoogleBrand,
  { deadline, summary = emptyWordingSummary() }: { deadline: number; summary?: WordingSummary },
): Promise<WordingSummary> {
  const writer = deps.writeWording;
  if (!writer) return summary;
  const { db } = deps;

  const { data, error } = await db
    .from("gbp_posts")
    .select("id, content_item_id, topic_type, event_title, event_start, event_end, wording_attempts, updated_at")
    .eq("account_id", brand.accountId)
    .eq("state", "pending")
    .eq("wording_source", "awaiting_ai")
    .is("summary_edited_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(WORDING_BATCH);
  if (error) {
    summary.errors += 1;
    return summary;
  }
  const rows = (data ?? []) as WaitingRow[];
  if (!rows.length) return summary;

  const { data: account } = await db.from("accounts").select("business_name, display_name").eq("id", brand.accountId).maybeSingle();
  const names = account as { business_name: string | null; display_name: string | null } | null;
  const venueName = names?.business_name?.trim() || names?.display_name?.trim() || null;

  for (const row of rows) {
    if (deps.now().getTime() + WORDING_CALL_BUDGET_MS > deadline) break;

    const { data: variant, error: variantError } = await db
      .from("content_variants")
      .select("body")
      .eq("content_item_id", row.content_item_id)
      .maybeSingle();
    if (variantError) {
      summary.errors += 1;
      continue;
    }
    const facebookCopy = ((variant as { body: string | null } | null)?.body ?? "").trim();

    const update = async (patch: Record<string, unknown>): Promise<boolean> => {
      const { data: changed, error: updateError } = await db
        .from("gbp_posts")
        .update({ ...patch, updated_at: deps.now().toISOString() })
        .eq("id", row.id)
        .eq("account_id", brand.accountId)
        .eq("state", "pending")
        .eq("wording_source", "awaiting_ai")
        .is("summary_edited_at", null)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (updateError) {
        summary.errors += 1;
        return false;
      }
      return Array.isArray(changed) && changed.length === 1;
    };

    // Nothing to rewrite: the post keeps following its Facebook post.
    if (!facebookCopy) {
      if (await update({ wording_source: "facebook" })) summary.fellBack += 1;
      continue;
    }

    const input: GoogleWordingInput = {
      venueName,
      topicType: row.topic_type,
      eventTitle: row.event_title,
      eventWhen: row.topic_type === "EVENT" ? describeEventWhen(row.event_start, row.event_end) : null,
      facebookCopy,
    };

    let draft: string;
    try {
      draft = await writer(input, { accountId: brand.accountId });
    } catch (caught) {
      // An outage or a timeout says nothing about the wording, so it does not
      // count towards giving up: the post is simply asked again next run.
      summary.retried += 1;
      logger.warn("a Google wording draft could not be written", {
        accountId: brand.accountId,
        versionId: row.id,
        reason: caught instanceof Error && caught.name === "AbortError" ? "timeout" : "ai_failed",
      });
      continue;
    }

    const checked = checkGoogleWording(draft, input);
    if (checked.ok) {
      if (await update({ summary: checked.summary, wording_source: "ai" })) summary.written += 1;
      continue;
    }

    const attempts = row.wording_attempts + 1;
    const gaveUp = attempts >= MAX_WORDING_ATTEMPTS;
    const stored = await update({ wording_attempts: attempts, ...(gaveUp ? { wording_source: "facebook" } : {}) });
    if (stored) {
      if (gaveUp) summary.fellBack += 1;
      else summary.retried += 1;
    }
    // The reason only: never the draft or the Facebook copy.
    logger.warn("a Google wording draft was not used", { accountId: brand.accountId, versionId: row.id, reason: checked.reason, attempts, gaveUp });
  }

  return summary;
}
