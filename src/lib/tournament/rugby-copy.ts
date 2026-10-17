import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ServiceWindow } from '@/lib/management-app/screening-hours';
import { formatEventDateLong, formatFriendlyTimeFromZoned } from '@/lib/utils/date';
import type { TournamentFixture } from '@/types/tournament';

import { intersectServiceWindows, plannedScreeningEndMs } from './screening';
import type { ScreenedFixture } from './screening-service';

/**
 * Customer-facing wording for a rugby screening post (tasks/SPEC-rugby-match-posts.md).
 *
 * Built only from verified screening facts: kick-off, the day's opening hours,
 * kitchen service and any screen allocation. Nothing is AI-written and nothing
 * is invented, so a line is simply left out when its fact is unknown. Times are
 * 12-hour ("8:10pm", "12pm") and dates follow the house style ("Friday 6th
 * November"), matching the rest of the app's copy.
 */

export interface RugbyMatchCopy {
  /** Caption paragraphs, without any link. Channel rules add the booking line. */
  lines: string[];
  /** Opening-time and kitchen sentences that must survive channel processing. */
  requiredLines: string[];
  /** Short note for the bottom of the match image. */
  imageNote: string;
}

type CopyFixture = Pick<TournamentFixture, 'id' | 'teamA' | 'teamB' | 'kickOffAt'>;

function zoned(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: DEFAULT_TIMEZONE });
}

function clock(iso: string): string {
  return formatFriendlyTimeFromZoned(zoned(iso));
}

function describeWindows(windows: ServiceWindow[]): string {
  return windows.map((window) => `${clock(window.startAt)} to ${clock(window.endAt)}`).join(' and ');
}

/** "20 minutes", "an hour", "1 hour and 10 minutes". */
export function describeMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} minute${rest === 1 ? '' : 's'}`;
  const hourText = hours === 1 ? 'an hour' : `${hours} hours`;
  if (!rest) return hourText;
  return `${hours === 1 ? '1 hour' : hourText} and ${rest} minute${rest === 1 ? '' : 's'}`;
}

/** Stable small hash so a fixture always gets the same opening line. */
function pickVariant(id: string, count: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % count;
}

export function buildRugbyOpeningLine(fixture: CopyFixture): string {
  const kickOff = zoned(fixture.kickOffAt);
  const date = formatEventDateLong(kickOff);
  const time = formatFriendlyTimeFromZoned(kickOff);
  const match = `${fixture.teamA} v ${fixture.teamB}`;
  const variants = [
    `${match} is on our screens on ${date}. Kick-off ${time}. 🏉`,
    `Catch ${match} with us on ${date}, kick-off ${time}. 🏉`,
    `${match}, ${date}: kick-off ${time}, live on our screens. 🏉`,
  ];
  return variants[pickVariant(fixture.id, variants.length)];
}

interface OpeningFacts {
  startsLate: boolean;
  endsEarly: boolean;
  open: string | null;
  close: string | null;
  minutesAfterKickOff: number;
  staysOpenForViewers: boolean;
}

function resolveOpeningFacts(fixture: CopyFixture, screened: ScreenedFixture): OpeningFacts {
  const bar = screened.hours.state === 'open' ? screened.hours.bar : null;
  if (!bar) {
    return { startsLate: false, endsEarly: false, open: null, close: null, minutesAfterKickOff: 0, staysOpenForViewers: false };
  }
  const kick = Date.parse(fixture.kickOffAt);
  const open = Date.parse(bar.startAt);
  const close = Date.parse(bar.endAt);
  const plannedEnd = plannedScreeningEndMs({ ...screened, kickOffAt: fixture.kickOffAt });
  return {
    startsLate: open > kick,
    endsEarly: Number.isFinite(plannedEnd) && close < plannedEnd,
    open: clock(bar.startAt),
    close: clock(bar.endAt),
    minutesAfterKickOff: (open - kick) / 60_000,
    staysOpenForViewers: screened.screening.lateFinishPolicy === 'stay_open_if_viewers',
  };
}

function buildOpeningLines(facts: OpeningFacts): string[] {
  const lines: string[] = [];
  if (facts.startsLate && facts.open) {
    lines.push(`We open at ${facts.open}, ${describeMinutes(facts.minutesAfterKickOff)} after kick-off, so you'll catch the rest of the game.`);
  }
  if (facts.endsEarly && facts.close) {
    // Owner decision, 5 September 2026: a conditional stay, never a guaranteed
    // late opening, and arrivals stay limited to the usual closing time.
    lines.push(facts.staysOpenForViewers
      ? `We usually close at ${facts.close}. If you're still here watching, we'll stay open until the final whistle. Please arrive before ${facts.close}.`
      : `We close at ${facts.close}, before the final whistle, so you may miss the end.`);
  }
  return lines;
}

function buildScreenLine(screened: ScreenedFixture): string | null {
  const screen = screened.screenLabel?.trim();
  const commentary = screened.commentary === 'on' ? 'with commentary' : screened.commentary === 'off' ? 'without commentary' : null;
  if (screen && commentary) return `Showing on: ${screen}, ${commentary}.`;
  if (screen) return `Showing on: ${screen}.`;
  if (commentary) return `Showing ${commentary}.`;
  return null;
}

function buildKitchenLine(screened: ScreenedFixture): string | null {
  const food = screened.screening.foodPromotion;
  if (!food.serviceWindows.length) return null;
  if (food.kind === 'during_screening') return `Kitchen times: ${describeWindows(food.serviceWindows)}, so you can eat while you watch.`;
  if (food.kind === 'before_match') return `Kitchen times: ${describeWindows(food.serviceWindows)}, so you can eat before kick-off.`;
  return null;
}

function buildImageNote(facts: OpeningFacts, screened: ScreenedFixture): string {
  const parts: string[] = [];
  if (facts.startsLate && facts.open) parts.push(`Doors ${facts.open}, ${describeMinutes(facts.minutesAfterKickOff)} after kick-off`);
  if (facts.endsEarly && facts.close) {
    parts.push(facts.staysOpenForViewers
      ? `Usually close ${facts.close}, open to the final whistle if you're still watching`
      : `Close ${facts.close}, before the final whistle`);
  }
  if (!parts.length && facts.open && facts.close) parts.push(`Open ${facts.open} to ${facts.close}`);
  const food = screened.screening.foodPromotion;
  if ((food.kind === 'during_screening' || food.kind === 'before_match') && food.serviceWindows.length) {
    parts.push(`Kitchen ${describeWindows(food.serviceWindows)}`);
  }
  return parts.length ? `${parts.join('. ')}.` : '';
}

export function buildRugbyMatchCopy({ fixture, screened }: { fixture: CopyFixture; screened: ScreenedFixture }): RugbyMatchCopy {
  const facts = resolveOpeningFacts(fixture, screened);
  const openingLines = buildOpeningLines(facts);
  const kitchenLine = buildKitchenLine(screened);
  const screenLine = buildScreenLine(screened);
  const lines = [buildRugbyOpeningLine(fixture), ...openingLines, screenLine, kitchenLine]
    .filter((line): line is string => Boolean(line));
  return {
    lines,
    requiredLines: [...openingLines, ...(kitchenLine ? [kitchenLine] : [])],
    imageNote: buildImageNote(facts, screened),
  };
}

// ---------------------------------------------------------------------------
// Match-day round-ups: one post for every game on the same day
// ---------------------------------------------------------------------------

export interface RugbyGame {
  fixture: CopyFixture;
  screened: ScreenedFixture;
}

const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** "the 8:10pm game", "the 8:10pm games", "the 4:40pm and 8:10pm games". */
function describeKickOffs(games: RugbyGame[]): string {
  const times = [...new Set(games.map((game) => clock(game.fixture.kickOffAt)))];
  const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
  return `the ${list} ${games.length > 1 ? 'games' : 'game'}`;
}

/** The day's kitchen service inside opening hours, or none when unknown. */
function dayKitchenWindows(screened: ScreenedFixture): ServiceWindow[] {
  const bar = screened.hours.state === 'open' ? screened.hours.bar : null;
  if (!bar || screened.hours.kitchenState !== 'known') return [];
  return screened.hours.kitchen
    .map((window) => intersectServiceWindows(window, bar))
    .filter((window): window is ServiceWindow => window !== null)
    .sort((first, second) => Date.parse(first.startAt) - Date.parse(second.startAt));
}

const LIST_LINE = /^\d{1,2}(?::\d{2})?(?:am|pm) \S.* v \S/;

/** A fixture line in a round-up list, e.g. "2:10pm England v New Zealand". */
export function isRugbyListLine(line: string): boolean {
  return LIST_LINE.test(line);
}

function buildListLine({ fixture, screened }: RugbyGame): string {
  const screen = screened.screenLabel?.trim();
  const commentary = screened.commentary === 'on' ? 'with commentary' : screened.commentary === 'off' ? 'without commentary' : null;
  const detail = [screen, commentary].filter(Boolean).join(', ');
  return `${clock(fixture.kickOffAt)} ${fixture.teamA} v ${fixture.teamB}${detail ? ` (${detail})` : ''}`;
}

export function buildRugbyRoundupOpeningLine(games: RugbyGame[]): string {
  const lead = games[0].fixture;
  const date = formatEventDateLong(zoned(lead.kickOffAt));
  const count = countWord(games.length);
  const variants = [
    `${count} games on our screens on ${date}. 🏉`,
    `${date}: ${count.toLowerCase()} games, all on our screens. 🏉`,
    `Catch ${count.toLowerCase()} games with us on ${date}. 🏉`,
  ];
  return variants[pickVariant(lead.id, variants.length)];
}

/**
 * One post for every game on the same day (owner decision, 17 October 2026).
 * Games are listed in kick-off order; doors-after-kick-off and late-finish notes
 * name the kick-off times they apply to, and the kitchen line covers the day.
 */
export function buildRugbyRoundupCopy(games: RugbyGame[]): RugbyMatchCopy {
  const withFacts = games.map((game) => ({ game, facts: resolveOpeningFacts(game.fixture, game.screened) }));
  const day = withFacts[0].facts;
  const caveats: string[] = [];

  const lateStartTimes = [...new Set(withFacts.filter(({ facts }) => facts.startsLate).map(({ game }) => game.fixture.kickOffAt))];
  for (const kickOffAt of lateStartTimes) {
    const atThatTime = withFacts.filter(({ game }) => game.fixture.kickOffAt === kickOffAt);
    const { facts } = atThatTime[0];
    caveats.push(`We open at ${facts.open}, ${describeMinutes(facts.minutesAfterKickOff)} after the ${clock(kickOffAt)} kick-off, so you'll catch the rest of ${atThatTime.length > 1 ? 'those games' : 'that game'}.`);
  }

  const late = withFacts.filter(({ facts }) => facts.endsEarly);
  const lateFinishers = late.map(({ game }) => game);
  // The stay-open policy is only set on games that run past closing, so it is
  // read from those games, not from the day's first game.
  const staysOpenForViewers = late.some(({ facts }) => facts.staysOpenForViewers);
  if (lateFinishers.length && day.close) {
    // Owner decision, 5 September 2026: a conditional stay, never a guaranteed
    // late opening, and arrivals stay limited to the usual closing time.
    caveats.push(staysOpenForViewers
      ? `We usually close at ${day.close}. If you're still here watching ${describeKickOffs(lateFinishers)}, we'll stay open until the final whistle. Please arrive before ${day.close}.`
      : `We close at ${day.close}, before the final whistle of ${describeKickOffs(lateFinishers)}, so you may miss the end.`);
  }

  const kitchen = dayKitchenWindows(games[0].screened);
  const foodKinds = new Set(games.map((game) => game.screened.screening.foodPromotion.kind));
  const kitchenLine = kitchen.length
    ? `Kitchen times: ${describeWindows(kitchen)}${foodKinds.has('during_screening') ? ', so you can eat while you watch.' : foodKinds.has('before_match') ? ', so you can eat before kick-off.' : '.'}`
    : null;

  const noteParts: string[] = [];
  if (lateStartTimes.length && day.open) noteParts.push(`Doors ${day.open}`);
  if (lateFinishers.length && day.close) {
    noteParts.push(staysOpenForViewers
      ? `Usually close ${day.close}, open to the final whistle if you're still watching`
      : `Close ${day.close}`);
  }
  if (!noteParts.length && day.open && day.close) noteParts.push(`Open ${day.open} to ${day.close}`);
  if (kitchen.length) noteParts.push(`Kitchen ${describeWindows(kitchen)}`);

  return {
    lines: [buildRugbyRoundupOpeningLine(games), ...games.map(buildListLine), ...caveats, ...(kitchenLine ? [kitchenLine] : [])],
    requiredLines: [...caveats, ...(kitchenLine ? [kitchenLine] : [])],
    imageNote: noteParts.length ? `${noteParts.join('. ')}.` : '',
  };
}

/**
 * Join caption lines into paragraphs: a blank line between paragraphs, but a
 * round-up's fixture list stays a tight list, one game per line.
 */
export function joinRugbyParagraphs(lines: string[]): string {
  return lines.reduce((text, line, index) => {
    if (index === 0) return line;
    const separator = isRugbyListLine(line) && isRugbyListLine(lines[index - 1]) ? '\n' : '\n\n';
    return `${text}${separator}${line}`;
  }, '');
}

/** The verified menu link line for Facebook, or null when food service is not verified. */
export function buildRugbyMenuLine(kickOffAt: string, menuUrl: string | null): string | null {
  if (!menuUrl) return null;
  return zoned(kickOffAt).weekday === 7
    ? `See our Sunday roast menu: ${menuUrl}`
    : `See our menu: ${menuUrl}`;
}
