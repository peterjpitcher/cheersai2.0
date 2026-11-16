/**
 * The Google wording of a post, derived from the Facebook post's approved copy
 * (tasks/SPEC-gbp-posting-reintroduction.md, section 6 and decision D12).
 *
 * Deterministic and pure: no AI call, no env, no database. The same rules run
 * on a person's manual edit before it is saved, so what Google receives always
 * follows them.
 *
 * Copy rules:
 * 1. Remove URLs (the link becomes the post's button instead), email
 *    addresses, phone numbers, hashtags and @handles. Google's post rules do
 *    not allow contact details in the text, and hashtags and handles mean
 *    nothing on Google.
 * 2. Tidy what is left: a lead-in that pointed at a removed item ("Book
 *    here:", "Call us on", an arrow) goes with it, as do "link in bio" lines,
 *    doubled spaces, empty brackets and runs of empty lines.
 * 3. Cut to at most 1,500 characters, counted as Unicode code points (which
 *    is how Postgres counts them), at the end of a sentence where one is near
 *    the limit, otherwise at a word boundary. A surrogate pair is never split.
 *
 * Alcohol price promotions: Google restricts posts that promote regulated
 * products on price, so a version whose wording looks like one is HELD for a
 * person to release (hold_reason 'alcohol_promotion'). The detector is small
 * and conservative: it needs BOTH price-off wording and an alcohol word in the
 * same sentence ("2 for 1 cocktails", "happy hour on pints", "20% off wine"),
 * or a price fixed to an alcohol word ("£4 pints", "cocktails just £6"). A
 * ticket price for an event with no price-off wording (a quiz, music bingo,
 * cash bingo, live sport, a tasting night at £25 a head) passes. A false
 * match costs one click to release; a missed one is caught by Google's own
 * moderation as REJECTED, which raises an alert.
 */

export const GOOGLE_SUMMARY_MAX_CHARS = 1500;

/** Placeholders left where something was removed, so a lead-in can be found. Never in output. */
const CONTACT = "\u0001"; // a link, email address or phone number
const TAG = "\u0002"; // a hashtag or handle
const PLACEHOLDERS = /[\u0000-\u0002]/g;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;
/** Bare domains such as example.co.uk/book. Only common endings, so ordinary words with a full stop are safe. */
const BARE_DOMAIN_PATTERN =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:co\.uk|org\.uk|com|uk|org|net|pub|bar|io|info|events|london)(?:\/[^\s<>"')\]]*)?(?![\p{L}\p{N}])/giu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** UK numbers: +44 or 0, then 9 or 10 more digits, with optional spaces, dashes or brackets. */
const PHONE_PATTERN = /(?:\+44\s?(?:\(0\)\s?)?|\(?\b0)(?:\d[\s-]?\)?\s?){8,9}\d\b/gu;
const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;
const HANDLE_PATTERN = /(^|[^\p{L}\p{N}_.])@[A-Za-z0-9_.]*[A-Za-z0-9_]/gu;
const LINK_IN_BIO_PATTERN = /[^.!?\n]*\blink\s+in\s+(?:our\s+|the\s+|my\s+)?bio\b[^.!?\n]*[.!?]?/giu;

/** Words that introduce a link, number or address: their clause goes when what it pointed at is removed. */
const LEAD_IN =
  /\b(?:book|booking|bookings|reserve|reservations?|order|tickets?|buy|grab|find out|more|details|info|information|call|ring|phone|text|whatsapp|email|e-mail|message|dm|contact|visit|see|check|link|tap|click|head|menu|website|online)\b/iu;
/** Pointer marks that sat just before a removed item. */
const POINTERS_BEFORE = new RegExp(`(?:[ \\t]*(?:\u{1F449}|\u{1F447}|\u27A1\uFE0F?|\u2192|>>|>|:|-|\u2013|=))*[ \\t]*(?=[${CONTACT}${TAG}])`, "gu");
/** Where a clause starts, looking back from a removed item. A colon is not one: "Book here: <link>" is one clause. */
const CLAUSE_BREAKS = [",", ";", "(", " - ", " \u2013 ", " \u2014 "];

/** Replace links, emails and phone numbers, then hashtags and handles, with placeholders. */
function markRemovals(text: string): string {
  return text
    .replace(EMAIL_PATTERN, CONTACT)
    .replace(URL_PATTERN, CONTACT)
    .replace(BARE_DOMAIN_PATTERN, CONTACT)
    .replace(PHONE_PATTERN, CONTACT)
    .replace(HASHTAG_PATTERN, (_match, before: string) => `${before}${TAG}`)
    .replace(HANDLE_PATTERN, (_match, before: string) => `${before}${TAG}`);
}

/**
 * One sentence: a removed contact item takes its lead-in clause with it
 * ("Book here: <link>", "call us on <number> to book", ", reserve at <link>"),
 * plus a short tail of up to four words after it. Anything else just loses
 * the item.
 */
function tidySentence(sentence: string): string {
  let out = sentence.replace(POINTERS_BEFORE, "");
  let index = out.indexOf(CONTACT);
  while (index >= 0) {
    const before = out.slice(0, index);
    let after = out.slice(index + 1);
    const clauseStart = Math.max(0, ...CLAUSE_BREAKS.map((mark) => {
      const at = before.lastIndexOf(mark);
      return at < 0 ? 0 : at + mark.length;
    }));
    const clause = before.slice(clauseStart);
    if (LEAD_IN.test(clause)) {
      const ending = after.match(/[.!?]+\s*$/u)?.[0] ?? "";
      const tail = after.slice(0, after.length - ending.length);
      const tailWords = tail.split(/\s+/u).filter(Boolean);
      if (tailWords.length <= 4 && !tail.includes(CONTACT)) after = ending;
      const kept = before.slice(0, clauseStart).replace(/[\s,;(\-\u2013\u2014]+$/u, "");
      out = kept ? `${kept}${after}` : after;
    } else {
      out = `${before} ${after}`;
    }
    index = out.indexOf(CONTACT);
  }
  return out.split(TAG).join(" ");
}

function tidyLine(line: string): string {
  const sentences = line.split(/(?<=[.!?])\s+/u).map(tidySentence);
  return sentences
    .map((sentence) =>
      sentence
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([,;:])(?=[,;:.!?])/g, "")
        .replace(/^[,;:.!?\s]+/u, "")
        .replace(/[,;:\s]+$/u, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
}

/** Cut to at most `max` code points, at a sentence end near the limit, else at a word boundary. */
export function cutToLimit(text: string, max = GOOGLE_SUMMARY_MAX_CHARS): string {
  const points = Array.from(text);
  if (points.length <= max) return text;

  const head = points.slice(0, max).join("");
  const minimum = Math.floor(head.length * 0.6);

  let sentenceEnd = -1;
  for (const match of head.matchAll(/[.!?](?=\s|$)/g)) {
    if (match.index !== undefined && match.index >= minimum) sentenceEnd = match.index + 1;
  }
  if (sentenceEnd > 0) return head.slice(0, sentenceEnd).trimEnd();

  const space = head.search(/\s\S*$/);
  if (space > 0) return head.slice(0, space).trimEnd();
  // One unbroken run of text: cut on a code point, never inside a surrogate pair.
  return head.trimEnd();
}

/**
 * The Google wording for a Facebook post's copy (or a person's edit). Returns
 * an empty string when nothing is left.
 */
export function deriveGoogleSummary(source: string | null | undefined): string {
  if (!source) return "";
  const normalised = source.replace(/\r\n?/g, "\n").replace(PLACEHOLDERS, "").normalize("NFC");
  const withoutBio = normalised.replace(LINK_IN_BIO_PATTERN, "");
  const marked = markRemovals(withoutBio);

  // A line that only held removed items goes; a line that was empty already stays as a paragraph break.
  const lines = marked
    .split("\n")
    .map((line) => ({ was: line.trim(), now: tidyLine(line) }))
    .filter((line) => line.now || !line.was)
    .map((line) => line.now);
  const joined = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cutToLimit(joined);
}

const ALCOHOL_WORDS =
  "beers?|pints?|lagers?|ales?|ciders?|stouts?|ipas?|wines?|prosecco|champagne|fizz|bubbly|cava|gins?|g&ts?|vodkas?|rums?|whisk(?:e)?y|whiskies|tequila|cocktails?|mocktails?|spirits?|shots?|jagerbombs?|j[aä]gerbombs?|aperol|spritz(?:es)?|sangria|pimm'?s|negronis?|margaritas?|mojitos?|bottles? of|buckets? of|drinks?|booze|alcohol";
const DISCOUNT_WORDS =
  "2\\s*(?:for|4)\\s*1|two\\s+for\\s+one|3\\s*for\\s*2|bogof|buy\\s+one,?\\s+get\\s+one|happy\\s+hours?|\\d+\\s*%\\s*off|half[-\\s]price|price\\s+off|money\\s+off|discount(?:s|ed)?|cheap(?:er|est)?|bottomless|reduced|(?:drinks?|bar)\\s+(?:deals?|offers?)|(?:deals?|offers?)\\s+on|special\\s+price|free\\s+(?:drinks?|pints?|glass(?:es)?|shots?|bottles?|prosecco|fizz|cocktails?)";
const PRICE = "£\\s?\\d+(?:\\.\\d{2})?|\\d+(?:\\.\\d{2})?\\s?p\\b|\\d+\\s?quid";

const ALCOHOL_RE = new RegExp(`\\b(?:${ALCOHOL_WORDS})(?![\\p{L}])`, "iu");
const DISCOUNT_RE = new RegExp(`(?:${DISCOUNT_WORDS})`, "iu");
/** "£4 pints", "£5 house wine", "£6.50 cocktails". */
const PRICE_THEN_ALCOHOL = new RegExp(`(?:${PRICE})\\s+(?:[\\p{L}-]+\\s+)?(?:${ALCOHOL_WORDS})(?![\\p{L}])`, "iu");
/** "pints for £3", "cocktails just £6", "wine £4". */
const ALCOHOL_THEN_PRICE = new RegExp(
  `\\b(?:${ALCOHOL_WORDS})\\s*(?:[-:]\\s*)?(?:(?:for|at|just|only|from|now|all|a|each)\\s+){0,2}(?:${PRICE})`,
  "iu",
);

/** True when the wording looks like an alcohol price promotion (see the rule at the top of this file). */
export function looksLikeAlcoholPromotion(text: string | null | undefined): boolean {
  if (!text) return false;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u);
  return sentences.some(
    (sentence) =>
      PRICE_THEN_ALCOHOL.test(sentence) ||
      ALCOHOL_THEN_PRICE.test(sentence) ||
      (DISCOUNT_RE.test(sentence) && ALCOHOL_RE.test(sentence)),
  );
}

export type GoogleWordingHold = "alcohol_promotion" | "no_wording";

/** Why a version with this wording must wait for a person, or null when it may go out. */
export function holdForWording(summary: string): GoogleWordingHold | null {
  if (!summary.trim()) return "no_wording";
  if (looksLikeAlcoholPromotion(summary)) return "alcohol_promotion";
  return null;
}
