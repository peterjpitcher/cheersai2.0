/**
 * The Instagram booking line names the event (tasks/SPEC-instagram-booking-line-names-event.md).
 *
 * Instagram posts cannot carry a link, so an event post ends "... through the link in our bio",
 * and the bio page lists every upcoming event. "Book a place for each person through the link in
 * our bio" leaves the reader to guess which listing the post meant; "Book Snowball Showdown
 * through the link in our bio" does not. The prompt asks for the name, and the tidy-up makes sure.
 */

/** Words that say what kind of event it is, not which one: "Snowball Showdown Cash Bingo" is "Snowball Showdown". */
const EVENT_TYPE_WORDS = new Set([
  "a",
  "and",
  "bingo",
  "cash",
  "christmas",
  "edition",
  "evening",
  "event",
  "festive",
  "halloween",
  "live",
  "music",
  "night",
  "of",
  "party",
  "quiz",
  "special",
  "tasting",
  "the",
  "xmas",
]);

/** Generic lines with nothing worth keeping, replaced outright rather than prefixed. */
const GENERIC_LINE = /^(?:link in (?:our |the )?bio(?: to book)?|details in (?:our |the )?bio)[.!]?$/i;

/** Lower case, "&" read as "and", punctuation and apostrophes dropped: for comparing names only. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hasDistinctiveWord(words: readonly string[]): boolean {
  return words.some((word) => !EVENT_TYPE_WORDS.has(word));
}

/**
 * The forms of an event's name a booking line may use: the whole name, each part either side of
 * a colon, and each of those without its trailing event-type words. A part made only of such
 * words ("Festive Music Bingo" is fine, "Quiz Night" is not) does not identify the event.
 */
function nameForms(eventName: string): string[] {
  const forms = new Set<string>();
  const whole = comparable(eventName);
  if (whole) forms.add(whole);
  for (const part of [eventName, ...eventName.split(":")]) {
    const words = comparable(part).split(" ").filter(Boolean);
    if (!hasDistinctiveWord(words)) continue;
    let end = words.length;
    while (end > 0 && EVENT_TYPE_WORDS.has(words[end - 1])) end -= 1;
    for (const kept of [words, words.slice(0, end)]) {
      forms.add(kept.join(" "));
      // "Book House of Horrors" names "The House of Horrors Halloween Party" too.
      if (kept[0] === "the" && kept.length > 1) forms.add(kept.slice(1).join(" "));
    }
  }
  return [...forms];
}

/** Whether a booking line says which event it is for. */
export function bookingLineNamesEvent(line: string, eventName: string): boolean {
  const text = ` ${comparable(line)} `;
  return nameForms(eventName).some((form) => text.includes(` ${form} `));
}

/**
 * The event's name as a booking line says it: the first part before a colon that identifies the
 * event ("Sleigh My Name" for "Sleigh My Name: Festive Music Bingo"), otherwise the whole name.
 */
export function bookingName(eventName: string): string {
  const whole = eventName.trim();
  if (!whole.includes(":")) return whole;
  const part = whole
    .split(":")
    .map((piece) => piece.trim())
    .find((piece) => hasDistinctiveWord(comparable(piece).split(" ").filter(Boolean)));
  return part || whole;
}

/** "Book a place..." reads on after "For <name>, "; a word with more capitals keeps them. */
function lowerFirstWord(line: string): string {
  return /^[A-Z][a-z]+\b/.test(line) ? `${line[0].toLowerCase()}${line.slice(1)}` : line;
}

/**
 * The line to publish: kept as written when it names the event; otherwise the name goes in
 * front and the model's wording (often how booking works) stays.
 */
export function nameEventInBookingLine(line: string | null | undefined, eventName: string): string {
  const name = bookingName(eventName);
  const trimmed = line?.trim() ?? "";
  if (!trimmed || GENERIC_LINE.test(trimmed)) return `Book ${name} through the link in our bio.`;
  if (bookingLineNamesEvent(trimmed, eventName)) return trimmed;
  return `For ${name}, ${lowerFirstWord(trimmed)}`;
}
