import { DateTime } from "luxon";

import { formatFriendlyTimeFromZoned } from "@/lib/utils/date";

/**
 * The facts about an event that the management app already knows, in plain
 * words, for the copy prompt (tasks/SPEC-event-copy-engine.md B2).
 *
 * The 17 October 2026 review found these never reached the AI: Tinsel & Tipples
 * gave its price in 1 of 14 posts and its over-18s rule in none, and no post
 * gave a doors time. Everything here is read from the event record; nothing is
 * inferred, and a fact the record does not hold is left out.
 */
export interface EventFactSheet {
  category?: string;
  times?: string;
  price?: string;
  booking?: string;
  host?: string;
  highlights?: string[];
  pastEvent?: string;
  faqs?: Array<{ question: string; answer: string }>;
}

export interface EventFactsSource {
  time?: string | null;
  end_time?: string | null;
  doors_time?: string | null;
  last_entry_time?: string | null;
  categoryName?: string | null;
  payment_mode?: string | null;
  booking_mode?: string | null;
  price?: number | null;
  ticket_price?: number | null;
  price_per_seat?: number | null;
  is_free?: boolean | null;
  online_discount_type?: string | null;
  online_discount_value?: number | null;
  online_discount_ends_at?: string | null;
  performer_name?: string | null;
  highlights?: string[] | null;
  previous_event_summary?: string | null;
  attendance_note?: string | null;
  faqs?: Array<{ question: string; answer: string }> | null;
}

const MAX_FAQS = 8;
const MAX_ANSWER_CHARS = 320;

/** "19:00" or "19:00:00" to "7pm"; null when not a time. */
export function friendlyClock(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const zoned = DateTime.fromObject({ hour: Number(match[1]), minute: Number(match[2]) }, { zone: "Europe/London" });
  return zoned.isValid ? formatFriendlyTimeFromZoned(zoned) : null;
}

function money(value: number): string {
  return Number.isInteger(value) ? `£${value}` : `£${value.toFixed(2)}`;
}

function describeTimes(source: EventFactsSource): string | undefined {
  const start = friendlyClock(source.time);
  const end = friendlyClock(source.end_time);
  const doors = friendlyClock(source.doors_time);
  const lastEntry = friendlyClock(source.last_entry_time);
  const parts = [
    start && end ? `${start} to ${end}` : start ? `starts ${start}` : null,
    doors ? `doors ${doors}` : null,
    lastEntry ? `last entry ${lastEntry}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("; ") : undefined;
}

/**
 * The management app's `price` already has any live online discount taken off,
 * so the full (walk-up) price is the per-seat or ticket price.
 */
function describePrice(source: EventFactsSource): string | undefined {
  if (source.is_free === true || source.payment_mode === "free") return "Free entry";
  const amount = [source.price_per_seat, source.ticket_price, source.price]
    .find((value): value is number => typeof value === "number" && value > 0);
  if (amount === undefined) return undefined;
  const discount = source.online_discount_value;
  if (typeof discount === "number" && discount > 0) {
    const online = source.online_discount_type === "percent"
      ? `${discount}% off`
      : money(Math.max(0, amount - discount));
    const until = source.online_discount_ends_at
      ? DateTime.fromISO(source.online_discount_ends_at, { zone: "Europe/London" })
      : null;
    const untilText = until?.isValid ? ` until ${until.toFormat("d LLLL")}` : "";
    return `${online} per person when booked online in advance${untilText}; ${money(amount)} on the night`;
  }
  const perPerson = `${money(amount)} per person`;
  return source.payment_mode === "cash_only"
    ? `${perPerson}, paid in cash on arrival`
    : source.payment_mode === "prepaid"
      ? `${perPerson}, paid when booking`
      : perPerson;
}

function describeBooking(source: EventFactsSource): string | undefined {
  switch (source.booking_mode) {
    case "communal":
      return "Shared tables: book a place for each person";
    case "table":
      return "Book a table";
    case "general":
      return "General admission";
    case "mixed":
      return "Tables and general admission";
    default:
      return undefined;
  }
}

function clean(text: string | null | undefined): string | undefined {
  const cleaned = stripImportedFormatting(text ?? "");
  return cleaned || undefined;
}

export function buildEventFactSheet(source: EventFactsSource): EventFactSheet {
  const faqs = (source.faqs ?? [])
    .map((faq) => ({ question: clean(faq.question), answer: clean(faq.answer) }))
    .filter((faq): faq is { question: string; answer: string } => Boolean(faq.question && faq.answer))
    .slice(0, MAX_FAQS)
    .map((faq) => ({
      question: faq.question,
      answer: faq.answer.length > MAX_ANSWER_CHARS ? `${faq.answer.slice(0, MAX_ANSWER_CHARS).replace(/\s+\S*$/, "")}...` : faq.answer,
    }));
  const pastEvent = [clean(source.previous_event_summary), clean(source.attendance_note)].filter(Boolean).join(" ");
  const sheet: EventFactSheet = {
    category: clean(source.categoryName),
    times: describeTimes(source),
    price: describePrice(source),
    booking: describeBooking(source),
    host: clean(source.performer_name),
    highlights: (source.highlights ?? []).map((item) => clean(item)).filter((item): item is string => Boolean(item)),
    pastEvent: pastEvent || undefined,
    faqs,
  };
  return Object.fromEntries(
    Object.entries(sheet).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined)),
  ) as EventFactSheet;
}

/**
 * Imported event text carries Markdown and Windows line endings; social copy
 * shows both literally, and the model tends to echo a Markdown headline.
 */
export function stripImportedFormatting(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type CopyTone = "friendly_warm" | "professional" | "playful" | "sophisticated" | "community_focused";

/**
 * A tone to start from, by kind of event. Themed and hosted nights suit playful
 * copy; food and tastings warm; sport and cash bingo a community feel. The owner
 * can change it in the wizard; unknown categories keep the default.
 */
export function toneForCategory(category: string | null | undefined): CopyTone | null {
  const value = category?.toLowerCase() ?? "";
  if (!value) return null;
  if (/cash\s*bingo/.test(value)) return "community_focused";
  if (/music\s*bingo|drag|party|parties|karaoke|halloween|disco|quiz/.test(value)) return "playful";
  if (/tasting|food|dining|supper|roast|brunch|wine|gin/.test(value)) return "friendly_warm";
  if (/sport|rugby|football|match/.test(value)) return "community_focused";
  return null;
}
