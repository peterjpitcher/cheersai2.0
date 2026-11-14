/**
 * Build timing-compatible campaign metadata from the wizard brief.
 *
 * extractCampaignTiming() in src/lib/scheduling/campaign-timing.ts expects
 * top-level startDate, eventStart, endDate, dayOfWeek, and time fields.
 * The wizard previously wrote { brief, slotCount } which broke planner
 * banner labels and publish-time proximity calculations. Weekly recurring
 * now carries daysOfWeek plus a back-compat dayOfWeek (first day) and an
 * endDate so the link-in-bio card expires with the campaign run.
 */

import { DateTime } from 'luxon';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { resolveEventEnd } from '@/lib/scheduling/event-end';
import type { ContentType } from '@/types/content';

/**
 * Build campaign metadata from a wizard brief in a shape that is compatible
 * with extractCampaignTiming(). Includes the original brief for audit fidelity.
 */
export function buildCampaignMetadata(
  contentType: ContentType,
  brief: Record<string, unknown>,
  slotCount: number,
): Record<string, unknown> {
  const base = { brief, slotCount };

  if (contentType === 'event') {
    const eventDate = brief.eventDate as string | undefined;
    const eventTime = brief.eventTime as string | undefined;
    const eventEndDate = (brief.eventEndDate as string | undefined) ?? null;

    let eventStart: string | null = null;
    if (eventDate && eventTime) {
      const dt = DateTime.fromISO(`${eventDate}T${eventTime}`, { zone: DEFAULT_TIMEZONE });
      if (dt.isValid) eventStart = dt.toISO();
    }

    // For Google profile event posts (tasks/SPEC-gbp-posting-reintroduction.md §3):
    // the publish worker builds the Google event from these, with no management
    // app call at publish time. eventEnd is null when no end can be resolved,
    // which makes the event not eligible for Google and changes nothing else.
    const resolvedEnd = resolveEventEnd({
      startDate: eventDate,
      startTime: eventTime,
      endDate: eventEndDate,
      endTime: brief.eventEndTime as string | undefined,
    });
    const managementEventId = typeof brief.managementEventId === 'string' ? brief.managementEventId.trim() : '';

    return {
      ...base,
      eventStart,
      startDate: eventDate ?? null,
      startTime: eventTime ?? null,
      endDate: eventEndDate,
      eventEnd: resolvedEnd.ok ? resolvedEnd.end : null,
      eventEndProblem: resolvedEnd.ok ? null : resolvedEnd.reason,
      eventTitle: typeof brief.eventName === 'string' ? brief.eventName : null,
      sourceEventKey: managementEventId ? `mgmt:${managementEventId}` : null,
      googleCtaUrl: typeof brief.googleCtaUrl === 'string' ? brief.googleCtaUrl : null,
      takesBookings: brief.takesBookings === true,
      placements: Array.isArray(brief.placements) ? brief.placements : ['feed'],
    };
  }

  if (contentType === 'promotion') {
    return {
      ...base,
      startDate: (brief.startDate as string | undefined) ?? null,
      endDate: (brief.endDate as string | undefined) ?? null,
      offerSummary: (brief.offerSummary as string | undefined) ?? null,
      couponCode: (brief.couponCode as string | undefined) ?? null,
      placements: Array.isArray(brief.placements) ? brief.placements : ['feed'],
    };
  }

  if (contentType === 'weekly_recurring') {
    const daysOfWeek = Array.isArray(brief.daysOfWeek) ? (brief.daysOfWeek as number[]) : [];
    return {
      ...base,
      daysOfWeek,
      // Back-compat: extractCampaignTiming, the link-in-bio card, and the
      // publish-worker banner label all read a single top-level dayOfWeek.
      dayOfWeek: daysOfWeek[0] ?? 1,
      time: brief.time as string,
      // Consumed by extractCampaignTiming (endAt) so the link-in-bio card expires.
      endDate: (brief.endDate as string | undefined) ?? null,
      // Read by the link-in-bio card (resolveCampaignCtaLabel) for the button text.
      ctaLabel: (brief.ctaLabel as string | undefined) ?? null,
    };
  }

  // instant_post or other types — base metadata only
  return base;
}

/**
 * Map wizard content types to campaign_type values that extractCampaignTiming
 * understands. weekly_recurring -> 'weekly' is required because the timing
 * module checks campaign_type === "weekly".
 */
export function mapCampaignType(contentType: ContentType): string {
  if (contentType === 'weekly_recurring') return 'weekly';
  return contentType;
}
