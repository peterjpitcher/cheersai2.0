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

export interface GenerationTemporalContext {
  eventStart?: string;
  promotionStart?: string;
  promotionEnd?: string;
  promotionDateMode?: 'range' | 'ends_on';
  temporalProximity?: string;
  timingLabel?: TimingCueLabel;
  temporalInstruction?: string;
  proximityLabel?: string | null;
}

interface BuildGenerationTemporalContextInput {
  contentType: ContentType;
  brief: Record<string, unknown>;
  scheduledAt?: string | null;
}

interface GetCreatePreviewBannerLabelInput {
  contentType: ContentType;
  brief: Record<string, unknown>;
  scheduledAt?: string | null;
  slotCount?: number;
}

const HOUR_MS = 60 * 60 * 1000;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseInDefaultZone(value: string | null | undefined): DateTime | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: DEFAULT_TIMEZONE });
  return dt.isValid ? dt : null;
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

function formatDayMonth(dt: DateTime): string {
  return dt.setLocale('en-GB').toFormat('d LLLL');
}

function dayDiff(earlier: DateTime, later: DateTime): number {
  return calendarDayDiff(earlier.toJSDate(), later.toJSDate(), DEFAULT_TIMEZONE);
}

function describeEventTimingCue(
  scheduledAt: string | null | undefined,
  eventStart: DateTime,
): Pick<GenerationTemporalContext, 'temporalProximity' | 'timingLabel' | 'temporalInstruction'> {
  const scheduled = parseInDefaultZone(scheduledAt ?? null);
  if (!scheduled) {
    return {
      temporalProximity: 'energetic, live, in-the-moment',
      timingLabel: 'today_imminent',
      temporalInstruction: 'Use live, present-tense wording such as "today", "tonight", or "happening now" where natural.',
    };
  }

  const diffMs = eventStart.toMillis() - scheduled.toMillis();
  const diffCalendarDays = dayDiff(scheduled, eventStart);
  const weekday = formatWeekday(eventStart);
  const dayMonth = formatDayMonth(eventStart);
  const timeLabel = formatFriendlyTimeFromZoned(eventStart);
  const isImminent = diffMs > 0 && diffMs <= 3 * HOUR_MS;

  if (diffMs <= 0) {
    if (Math.abs(diffMs) > 3 * HOUR_MS) {
      return {
        temporalProximity: 'reflective, warm, community pride',
        timingLabel: 'recap',
        temporalInstruction: `The event has already started. Write this as a recap or live follow-up for ${weekday} ${dayMonth}.`,
      };
    }
    return {
      temporalProximity: 'energetic, live, in-the-moment',
      timingLabel: 'today_imminent',
      temporalInstruction: 'The event is underway now. Use present-tense, live wording and invite last-minute arrivals where appropriate.',
    };
  }

  if (isImminent) {
    const when = diffCalendarDays === 0 ? `today at ${timeLabel}` : `${weekday} at ${timeLabel}`;
    return {
      temporalProximity: 'urgent, exciting, last-chance energy',
      timingLabel: 'today_imminent',
      temporalInstruction: `The event is in just a few hours (${when}). Use urgent, final-reminder wording.`,
    };
  }

  if (diffCalendarDays === 0) {
    const timingLabel: TimingCueLabel = scheduled.hour < 14 ? 'today_morning' : 'today_imminent';
    return {
      temporalProximity: timingLabel === 'today_morning'
        ? 'bright, reminder, plan-your-day'
        : 'urgent, exciting, last-chance energy',
      timingLabel,
      temporalInstruction: `The event is today at ${timeLabel}. Naturally use "today" or "tonight" where it fits.`,
    };
  }

  if (diffCalendarDays === 1) {
    return {
      temporalProximity: "anticipation, countdown, don't miss out",
      timingLabel: 'tomorrow',
      temporalInstruction: `The event is tomorrow (${weekday} ${dayMonth}). Use "tomorrow" naturally in the copy.`,
    };
  }

  if (diffCalendarDays <= 6) {
    return {
      temporalProximity: 'building excitement, save the date',
      timingLabel: 'building',
      temporalInstruction: `The event is on ${formatEventDateLong(eventStart)} at ${timeLabel}. Use this full date in the copy; do not fall back to vague relative or countdown wording.`,
    };
  }

  return {
    temporalProximity: 'awareness, curiosity, early-bird appeal',
    timingLabel: 'early_awareness',
    temporalInstruction: `The event is on ${formatEventDateLong(eventStart)} at ${timeLabel}. Use the clear calendar date instead of "soon".`,
  };
}

function describePromotionTimingCue(
  scheduledAt: string | null | undefined,
  endAt: DateTime,
): Pick<GenerationTemporalContext, 'temporalProximity' | 'timingLabel' | 'temporalInstruction'> {
  const scheduled = parseInDefaultZone(scheduledAt ?? null);
  if (!scheduled) {
    return {
      temporalProximity: 'immediate, clear, offer-led',
      timingLabel: 'promotion_last_day',
      temporalInstruction: 'Drive immediate interest in the promotion and invite guests to take advantage now.',
    };
  }

  const effectiveEnd = endAt.startOf('day').endOf('day');
  if (scheduled.toMillis() > effectiveEnd.toMillis()) {
    return {
      temporalProximity: 'reflective, appreciative, next-offer tease',
      timingLabel: 'promotion_ended',
      temporalInstruction: 'The promotion has ended. Do not write as if the offer is still available.',
    };
  }

  const daysUntilEnd = dayDiff(scheduled, endAt.startOf('day'));
  const endWeekday = formatWeekday(endAt);
  const endDayMonth = formatDayMonth(endAt);

  if (daysUntilEnd === 0) {
    const hoursUntilEnd = effectiveEnd.diff(scheduled, 'hours').hours;
    return {
      temporalProximity: 'urgent, last-chance, clear deadline',
      timingLabel: 'promotion_last_day',
      temporalInstruction: hoursUntilEnd <= 6
        ? 'The promotion ends tonight. Make that deadline clear and create a final-rush feel.'
        : `The promotion ends today (${endWeekday} ${endDayMonth}). Use last-chance wording.`,
    };
  }

  if (daysUntilEnd === 1) {
    return {
      temporalProximity: 'urgent, countdown, deadline-led',
      timingLabel: 'promotion_tomorrow',
      temporalInstruction: `The promotion ends tomorrow (${endWeekday} ${endDayMonth}). Use "tomorrow" naturally in the copy.`,
    };
  }

  if (daysUntilEnd >= 2 && daysUntilEnd <= 6) {
    return {
      temporalProximity: 'momentum, clear deadline, value-led',
      timingLabel: 'promotion_this_week',
      temporalInstruction: `The promotion ends on ${endWeekday} ${endDayMonth}. Keep the offer moving without overstating urgency.`,
    };
  }

  return {
    temporalProximity: 'value-led, awareness, deadline-aware',
    timingLabel: 'promotion_early',
    temporalInstruction: `The promotion finishes on ${endWeekday} ${endDayMonth}. Reinforce the value and include the deadline clearly.`,
  };
}

export function getCreatePreviewBannerLabel({
  contentType,
  brief,
  scheduledAt,
  slotCount = 1,
}: GetCreatePreviewBannerLabelInput): string | null {
  if (!scheduledAt) return null;
  if (!['event', 'promotion', 'weekly_recurring'].includes(contentType)) return null;

  const referenceAt = parseInDefaultZone(scheduledAt);
  if (!referenceAt) return null;

  try {
    const metadata = buildCampaignMetadata(contentType, brief, slotCount);
    if (
      contentType === 'promotion'
      && typeof metadata.endDate === 'string'
      && typeof metadata.startDate !== 'string'
    ) {
      metadata.startDate = referenceAt.toISODate();
    }
    const campaignTiming = extractCampaignTiming({
      campaign_type: mapCampaignType(contentType),
      metadata,
    });
    return getProximityLabel({ referenceAt, campaignTiming });
  } catch {
    return null;
  }
}

export function buildGenerationTemporalContext({
  contentType,
  brief,
  scheduledAt,
}: BuildGenerationTemporalContextInput): GenerationTemporalContext {
  if (contentType === 'event') {
    const eventStart = buildEventStart(brief);
    if (!eventStart) return {};
    return {
      eventStart: eventStart.toISO() ?? undefined,
      proximityLabel: getCreatePreviewBannerLabel({ contentType, brief, scheduledAt }),
      ...describeEventTimingCue(scheduledAt, eventStart),
    };
  }

  if (contentType === 'promotion') {
    const endDate = readString(brief.endDate);
    const endAt = parseInDefaultZone(endDate);
    if (!endAt) return {};

    const startDate = readString(brief.startDate);
    const startAt = parseInDefaultZone(startDate);

    return {
      promotionStart: startAt?.toISO() ?? undefined,
      promotionEnd: endAt.toISO() ?? undefined,
      promotionDateMode: startDate ? 'range' : 'ends_on',
      proximityLabel: getCreatePreviewBannerLabel({ contentType, brief, scheduledAt }),
      ...describePromotionTimingCue(scheduledAt, endAt),
    };
  }

  if (contentType === 'weekly_recurring') {
    const proximityLabel = getCreatePreviewBannerLabel({ contentType, brief, scheduledAt });
    if (!proximityLabel) return {};
    return {
      proximityLabel,
      temporalProximity: 'routine, familiar, timely reminder',
      temporalInstruction: `This recurring event is ${proximityLabel.toLowerCase()}. Use that relative timing naturally where it fits.`,
    };
  }

  return {};
}
