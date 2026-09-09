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

/**
 * Split the relative vocabulary into what is true and what is false for a post
 * that publishes `publishAt` about something happening at `target`.
 *
 * Banding matches getProximityLabel so the caption and the image strip can never
 * make contradictory claims. Phase 1 permits no "this/next <weekday>" form: the
 * house style is the full absolute date outside the same-day and next-day cases.
 */
export function splitRelativeWording(
  publishAt: DateTime,
  target: DateTime,
  options?: { sameDayForms?: 'auto' | 'both' },
): { allowed: string[]; forbidden: string[] } {
  const gap = dayDiff(publishAt, target);
  const allowed: string[] = [];

  if (gap === 0) {
    // A promotion runs to the end of its last day, so "today" and "tonight" are
    // both true. An event happens at a time, so only one of them is.
    if (options?.sameDayForms === 'both') {
      allowed.push('today', 'tonight');
    } else {
      allowed.push(isEvening(target) ? 'tonight' : 'today');
    }
  } else if (gap === 1) {
    allowed.push('tomorrow');
  }

  const forbidden = RELATIVE_FORMS.filter((form) => !allowed.includes(form));
  return { allowed, forbidden: [...forbidden] };
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
      temporalInstruction: 'Build anticipation and lead with the date from the timing block above.',
    };
  }

  return {
    temporalProximity: 'awareness, curiosity, early-bird appeal',
    timingLabel: 'early_awareness',
    temporalInstruction: 'This is an early awareness post. Use the calendar date from the timing block, never vague wording like "soon".',
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
      temporalInstruction: 'Keep the offer moving without overstating urgency. Take the deadline from the timing block above.',
    };
  }

  return {
    temporalProximity: 'value-led, awareness, deadline-aware',
    timingLabel: 'promotion_early',
    temporalInstruction: 'Reinforce the value of the offer and state the deadline from the timing block above.',
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
    const wording = splitRelativeWording(publishAt, eventStart);
    return {
      ...publishFacts,
      eventStart: eventStart.toISO() ?? undefined,
      absoluteDateLabel: formatEventDateLong(eventStart),
      allowedRelativeWording: wording.allowed,
      forbiddenRelativeWording: wording.forbidden,
      proximityLabel: previewLabel(),
      ...describeEventTimingCue(publishAt, eventStart),
    };
  }

  if (contentType === 'promotion') {
    const endDate = readString(brief.endDate);
    const endAt = parseInDefaultZone(endDate);
    if (!endAt) return publishFacts;

    const startDate = readString(brief.startDate);
    const startAt = parseInDefaultZone(startDate);
    const wording = splitRelativeWording(publishAt, endAt, { sameDayForms: 'both' });

    return {
      ...publishFacts,
      promotionStart: startAt?.toISO() ?? undefined,
      promotionEnd: endAt.toISO() ?? undefined,
      promotionDateMode: startDate ? 'range' : 'ends_on',
      absoluteDateLabel: formatEventDateLong(endAt),
      allowedRelativeWording: wording.allowed,
      forbiddenRelativeWording: wording.forbidden,
      proximityLabel: previewLabel(),
      ...describePromotionTimingCue(publishAt, endAt),
    };
  }

  if (contentType === 'weekly_recurring') {
    const proximityLabel = previewLabel();
    if (!proximityLabel) return publishFacts;
    return {
      ...publishFacts,
      proximityLabel,
      temporalProximity: 'routine, familiar, timely reminder',
      temporalInstruction: `This recurring event is ${proximityLabel.toLowerCase()}. Use that relative timing naturally where it fits.`,
    };
  }

  return publishFacts;
}
