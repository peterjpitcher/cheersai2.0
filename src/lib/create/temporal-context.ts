import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { buildCampaignMetadata, mapCampaignType } from '@/lib/publishing/build-campaign-metadata';
import { extractCampaignTiming } from '@/lib/scheduling/campaign-timing';
import { getProximityLabel } from '@/lib/scheduling/proximity-label';
import { calendarDayDiff } from '@/lib/scheduling/spread';
import { formatEventDateLong, formatFriendlyTimeFromZoned } from '@/lib/utils/date';
import type { ContentType } from '@/types/content';

export type TimingCueLabel =
  | 'today_imminent'
  | 'today_morning'
  | 'tomorrow'
  | 'building'
  | 'early_awareness'
  | 'recap'
  | 'promotion_ended'
  | 'promotion_last_day'
  | 'promotion_tomorrow'
  | 'promotion_this_week'
  | 'promotion_early';

/**
 * How the effective publish instant for a generation was arrived at.
 *
 * `scheduled` - the caller supplied a valid schedule.
 * `now`       - no schedule was supplied, so the post goes out immediately.
 * `invalid`   - a schedule was supplied but could not be parsed. This is
 *               deliberately NOT treated as `now`: a malformed schedule must
 *               never silently turn a future post into "happening right now".
 */
export type PublishInstantKind = 'scheduled' | 'now' | 'invalid';

export interface EffectivePublishAt {
  kind: PublishInstantKind;
  at: DateTime | null;
}

export interface GenerationTemporalContext {
  eventStart?: string;
  promotionStart?: string;
  promotionEnd?: string;
  promotionDateMode?: 'range' | 'ends_on';
  temporalProximity?: string;
  timingLabel?: TimingCueLabel;
  temporalInstruction?: string;
  proximityLabel?: string | null;
  /** ISO of the instant this post is expected to publish at. */
  effectivePublishAt?: string;
  /** Whether {@link effectivePublishAt} came from a schedule or from the clock. */
  publishAtKind?: Exclude<PublishInstantKind, 'invalid'>;
  /** The canonical absolute date the copy must use, e.g. "Saturday 19th September". */
  absoluteDateLabel?: string;
  /** Relative wording that is true for this post, e.g. ["today", "tonight"]. */
  allowedRelativeWording?: string[];
  /** Relative wording that would be false for this post. */
  forbiddenRelativeWording?: string[];
  /** True when relative wording alone is ambiguous and the date must appear too. */
  requiresAbsoluteDate?: boolean;
}

interface BuildGenerationTemporalContextInput {
  contentType: ContentType;
  brief: Record<string, unknown>;
  scheduledAt?: string | null;
  /** Injectable clock. Defaults to now in the venue timezone. */
  referenceAt?: DateTime;
}

interface GetCreatePreviewBannerLabelInput {
  contentType: ContentType;
  brief: Record<string, unknown>;
  scheduledAt?: string | null;
  slotCount?: number;
  referenceAt?: DateTime;
}

const HOUR_MS = 60 * 60 * 1000;

/** Matches proximity-label.ts: an event starting at 17:00 or later reads as "tonight". */
const EVENING_THRESHOLD_HOUR = 17;

/** Every relative form the timing block knows how to permit or forbid. */
const RELATIVE_FORMS = ['today', 'tonight', 'tomorrow'] as const;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseInDefaultZone(value: string | null | undefined): DateTime | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: DEFAULT_TIMEZONE });
  return dt.isValid ? dt : null;
}

/**
 * Resolve the single instant a generation should be written against.
 *
 * Everything downstream (prompt, post-processing, persisted generation context)
 * must use this one value so the caption, the image label and the stored
 * provenance cannot disagree.
 */
export function resolveEffectivePublishAt({
  scheduledAt,
  referenceAt,
}: {
  scheduledAt?: string | null;
  referenceAt?: DateTime;
}): EffectivePublishAt {
  const supplied = readString(scheduledAt);
  if (supplied) {
    const parsed = parseInDefaultZone(supplied);
    return parsed ? { kind: 'scheduled', at: parsed } : { kind: 'invalid', at: null };
  }
  const clock = referenceAt ?? DateTime.now();
  const at = clock.setZone(DEFAULT_TIMEZONE);
  return at.isValid ? { kind: 'now', at } : { kind: 'invalid', at: null };
}

function buildEventStart(brief: Record<string, unknown>): DateTime | null {
  const eventDate = readString(brief.eventDate);
  const eventTime = readString(brief.eventTime);
  if (!eventDate || !eventTime) return null;
  return parseInDefaultZone(`${eventDate}T${eventTime}`);
}

function formatWeekday(dt: DateTime): string {
  return dt.setLocale('en-GB').toFormat('cccc');
}

function dayDiff(earlier: DateTime, later: DateTime): number {
  return calendarDayDiff(earlier.toJSDate(), later.toJSDate(), DEFAULT_TIMEZONE);
}

/** Whole calendar days from `publishAt` to `target` in the venue timezone. */
export function calendarDayGap(publishAt: DateTime, target: DateTime): number {
  return dayDiff(publishAt, target);
}

function isEvening(dt: DateTime): boolean {
  return dt.hour >= EVENING_THRESHOLD_HOUR;
}

export interface RelativeWording {
  /** Relative wording that is true for this post. */
  allowed: string[];
  /** Relative wording that would be false for this post. */
  forbidden: string[];
  /**
   * True when relative wording alone would leave the reader guessing, so the
   * copy has to state the calendar date as well.
   *
   * Inside a week "this Saturday" is unambiguous on its own, which is how a pub
   * actually writes. Beyond it "next Saturday" is not, and further out there is
   * no natural relative form at all.
   */
  requiresAbsoluteDate: boolean;
}

/**
 * Read the permitted wording straight off the image overlay label.
 *
 * The label already encodes the day banding (getProximityLabel), including the
 * calendar-week arithmetic that separates "this Saturday" from "next Saturday"
 * across a DST boundary. Deriving the caption vocabulary from the same string
 * makes agreement between the caption and the image structural rather than a
 * rule two pieces of code have to keep in step.
 */
function allowedFromProximityLabel(
  label: string | null | undefined,
  weekday: string,
): string[] | null {
  if (!label) return null;
  const upper = label.trim().toUpperCase();
  const weekdayUpper = weekday.toUpperCase();

  if (upper === 'TODAY') return ['today'];
  if (upper === 'TONIGHT') return ['tonight'];
  if (upper === 'TOMORROW' || upper === 'TOMORROW NIGHT') return ['tomorrow'];
  if (upper === `THIS ${weekdayUpper}`) return [`this ${weekday}`];
  if (upper === `NEXT ${weekdayUpper}`) return [`next ${weekday}`];
  return null;
}

function allowedFromDayGap(
  gap: number,
  target: DateTime,
  weekday: string,
  sameDayForms?: 'auto' | 'both',
): string[] {
  if (gap === 0) {
    // A promotion runs to the end of its last day, so "today" and "tonight" are
    // both true. An event happens at a time, so only one of them is.
    return sameDayForms === 'both'
      ? ['today', 'tonight']
      : [isEvening(target) ? 'tonight' : 'today'];
  }
  if (gap === 1) return ['tomorrow'];
  if (gap >= 2 && gap <= 6) return [`this ${weekday}`];
  // Seven days out and beyond, the week arithmetic lives in getProximityLabel.
  // Without a label to read it from, permit nothing rather than guess.
  return [];
}

/**
 * Split the relative vocabulary into what is true and what is false for a post
 * that publishes `publishAt` about something happening at `target`.
 */
export function splitRelativeWording(
  publishAt: DateTime,
  target: DateTime,
  options?: { sameDayForms?: 'auto' | 'both'; proximityLabel?: string | null },
): RelativeWording {
  const gap = dayDiff(publishAt, target);
  const weekday = formatWeekday(target);
  const allowed =
    allowedFromProximityLabel(options?.proximityLabel, weekday)
    ?? allowedFromDayGap(gap, target, weekday, options?.sameDayForms);

  return {
    allowed,
    forbidden: relativeFormsFor(weekday).filter((form) => !allowed.includes(form)),
    requiresAbsoluteDate: !(gap >= 0 && gap <= 6),
  };
}

/**
 * Wording for a weekly recurrence, which has no fixed calendar date.
 *
 * Only the overlay label is available here: the next occurrence is resolved
 * inside getProximityLabel. A recurrence never needs an absolute date, which is
 * the carve-out the house style has always made for it.
 */
function weeklyRelativeWording(label: string): RelativeWording {
  const weekday = label.trim().toUpperCase().replace(/^(THIS|NEXT)\s+/, '');
  const titled = weekday.charAt(0) + weekday.slice(1).toLowerCase();
  const allowed = allowedFromProximityLabel(label, titled) ?? [];
  return {
    allowed,
    forbidden: relativeFormsFor(titled).filter((form) => !allowed.includes(form)),
    requiresAbsoluteDate: false,
  };
}

function relativeFormsFor(weekday: string): string[] {
  return [...RELATIVE_FORMS, `this ${weekday}`, `next ${weekday}`];
}

function describeEventTimingCue(
  publishAt: DateTime,
  eventStart: DateTime,
): Pick<GenerationTemporalContext, 'temporalProximity' | 'timingLabel' | 'temporalInstruction'> {
  const diffMs = eventStart.toMillis() - publishAt.toMillis();
  const diffCalendarDays = dayDiff(publishAt, eventStart);
  const timeLabel = formatFriendlyTimeFromZoned(eventStart);
  const isImminent = diffMs > 0 && diffMs <= 3 * HOUR_MS;

  if (diffMs <= 0) {
    if (Math.abs(diffMs) > 3 * HOUR_MS) {
      return {
        temporalProximity: 'reflective, warm, community pride',
        timingLabel: 'recap',
        temporalInstruction: 'The event has already started. Write this as a recap or a warm live follow-up, not a sales pitch.',
      };
    }
    return {
      temporalProximity: 'energetic, live, in-the-moment',
      timingLabel: 'today_imminent',
      temporalInstruction: 'The event is underway. Use present-tense, live wording and invite last-minute arrivals where appropriate.',
    };
  }

  if (isImminent) {
    // Names no relative day word: the timing block owns which one is true.
    const when = diffCalendarDays === 0
      ? `at ${timeLabel}`
      : `${formatWeekday(eventStart)} at ${timeLabel}`;
    return {
      temporalProximity: 'urgent, exciting, last-chance energy',
      timingLabel: 'today_imminent',
      temporalInstruction: `The event starts within a few hours (${when}). Use urgent, final-reminder wording.`,
    };
  }

  if (diffCalendarDays === 0) {
    const timingLabel: TimingCueLabel = publishAt.hour < 14 ? 'today_morning' : 'today_imminent';
    const sameDayWord = isEvening(eventStart) ? '"tonight"' : '"today"';
    return {
      temporalProximity: timingLabel === 'today_morning'
        ? 'bright, reminder, plan-your-day'
        : 'urgent, exciting, last-chance energy',
      timingLabel,
      temporalInstruction: `Write this as a same-day reminder. Use ${sameDayWord} where it fits naturally.`,
    };
  }

  if (diffCalendarDays === 1) {
    return {
      temporalProximity: "anticipation, countdown, don't miss out",
      timingLabel: 'tomorrow',
      temporalInstruction: 'Write this as a next-day reminder. Use "tomorrow" where it fits naturally.',
    };
  }

  if (diffCalendarDays <= 6) {
    return {
      temporalProximity: 'building excitement, save the date',
      timingLabel: 'building',
      temporalInstruction: 'Build anticipation. Take the timing wording from the timing block above.',
    };
  }

  return {
    temporalProximity: 'awareness, curiosity, early-bird appeal',
    timingLabel: 'early_awareness',
    temporalInstruction: 'This is an early awareness post. Take the timing wording from the timing block above, and never write vague wording like "soon".',
  };
}

function describePromotionTimingCue(
  publishAt: DateTime,
  endAt: DateTime,
): Pick<GenerationTemporalContext, 'temporalProximity' | 'timingLabel' | 'temporalInstruction'> {
  const effectiveEnd = endAt.startOf('day').endOf('day');
  if (publishAt.toMillis() > effectiveEnd.toMillis()) {
    return {
      temporalProximity: 'reflective, appreciative, next-offer tease',
      timingLabel: 'promotion_ended',
      temporalInstruction: 'The promotion has ended. Do not write as if the offer is still available.',
    };
  }

  const daysUntilEnd = dayDiff(publishAt, endAt.startOf('day'));

  if (daysUntilEnd === 0) {
    const hoursUntilEnd = effectiveEnd.diff(publishAt, 'hours').hours;
    return {
      temporalProximity: 'urgent, last-chance, clear deadline',
      timingLabel: 'promotion_last_day',
      temporalInstruction: hoursUntilEnd <= 6
        ? 'The promotion ends tonight. Make that deadline clear and create a final-rush feel.'
        : 'The promotion ends today. Use last-chance wording.',
    };
  }

  if (daysUntilEnd === 1) {
    return {
      temporalProximity: 'urgent, countdown, deadline-led',
      timingLabel: 'promotion_tomorrow',
      temporalInstruction: 'The promotion ends tomorrow. Use "tomorrow" where it fits naturally.',
    };
  }

  if (daysUntilEnd >= 2 && daysUntilEnd <= 6) {
    return {
      temporalProximity: 'momentum, clear deadline, value-led',
      timingLabel: 'promotion_this_week',
      temporalInstruction: 'Keep the offer moving without overstating urgency. Take the deadline wording from the timing block above.',
    };
  }

  return {
    temporalProximity: 'value-led, awareness, deadline-aware',
    timingLabel: 'promotion_early',
    temporalInstruction: 'Reinforce the value of the offer and take the deadline wording from the timing block above.',
  };
}

export function getCreatePreviewBannerLabel({
  contentType,
  brief,
  scheduledAt,
  slotCount = 1,
  referenceAt,
}: GetCreatePreviewBannerLabelInput): string | null {
  if (!['event', 'promotion', 'weekly_recurring'].includes(contentType)) return null;

  const effective = resolveEffectivePublishAt({ scheduledAt, referenceAt });
  if (effective.kind === 'invalid' || !effective.at) return null;
  const publishAt = effective.at;

  try {
    const metadata = buildCampaignMetadata(contentType, brief, slotCount);
    if (
      contentType === 'promotion'
      && typeof metadata.endDate === 'string'
      && typeof metadata.startDate !== 'string'
    ) {
      metadata.startDate = publishAt.toISODate();
    }
    const campaignTiming = extractCampaignTiming({
      campaign_type: mapCampaignType(contentType),
      metadata,
    });
    return getProximityLabel({ referenceAt: publishAt, campaignTiming });
  } catch {
    return null;
  }
}

export function buildGenerationTemporalContext({
  contentType,
  brief,
  scheduledAt,
  referenceAt,
}: BuildGenerationTemporalContextInput): GenerationTemporalContext {
  const effective = resolveEffectivePublishAt({ scheduledAt, referenceAt });
  // An unparseable schedule yields no temporal claims at all. Guessing here is
  // how a post for an event three weeks away ends up saying "happening now".
  if (effective.kind === 'invalid' || !effective.at) return {};

  const publishAt = effective.at;
  const publishFacts = {
    effectivePublishAt: publishAt.toISO() ?? undefined,
    publishAtKind: effective.kind,
  } satisfies Pick<GenerationTemporalContext, 'effectivePublishAt' | 'publishAtKind'>;

  const previewLabel = () =>
    getCreatePreviewBannerLabel({ contentType, brief, scheduledAt, referenceAt });

  if (contentType === 'event') {
    const eventStart = buildEventStart(brief);
    if (!eventStart) return publishFacts;
    const proximityLabel = previewLabel();
    const wording = splitRelativeWording(publishAt, eventStart, { proximityLabel });
    return {
      ...publishFacts,
      eventStart: eventStart.toISO() ?? undefined,
      absoluteDateLabel: formatEventDateLong(eventStart),
      allowedRelativeWording: wording.allowed,
      forbiddenRelativeWording: wording.forbidden,
      requiresAbsoluteDate: wording.requiresAbsoluteDate,
      proximityLabel,
      ...describeEventTimingCue(publishAt, eventStart),
    };
  }

  if (contentType === 'promotion') {
    const endDate = readString(brief.endDate);
    const endAt = parseInDefaultZone(endDate);
    if (!endAt) return publishFacts;

    const startDate = readString(brief.startDate);
    const startAt = parseInDefaultZone(startDate);
    // No proximity label is passed here on purpose. Before a promotion starts
    // the overlay describes its START ("THIS FRIDAY") while the caption talks
    // about the DEADLINE. Those are different facts, not a contradiction, so the
    // caption's wording comes from the gap to the end date alone.
    const wording = splitRelativeWording(publishAt, endAt, { sameDayForms: 'both' });

    return {
      ...publishFacts,
      promotionStart: startAt?.toISO() ?? undefined,
      promotionEnd: endAt.toISO() ?? undefined,
      promotionDateMode: startDate ? 'range' : 'ends_on',
      absoluteDateLabel: formatEventDateLong(endAt),
      allowedRelativeWording: wording.allowed,
      forbiddenRelativeWording: wording.forbidden,
      requiresAbsoluteDate: wording.requiresAbsoluteDate,
      proximityLabel: previewLabel(),
      ...describePromotionTimingCue(publishAt, endAt),
    };
  }

  if (contentType === 'weekly_recurring') {
    const proximityLabel = previewLabel();
    if (!proximityLabel) return publishFacts;
    const wording = weeklyRelativeWording(proximityLabel);
    return {
      ...publishFacts,
      proximityLabel,
      allowedRelativeWording: wording.allowed,
      forbiddenRelativeWording: wording.forbidden,
      requiresAbsoluteDate: wording.requiresAbsoluteDate,
      temporalProximity: 'routine, familiar, timely reminder',
      temporalInstruction: 'Write this as a familiar, routine reminder. Take the timing wording from the timing block above.',
    };
  }

  return publishFacts;
}
