import { DateTime } from "luxon";

import type { EventCampaignFormValues, PromotionCampaignFormValues } from "@/lib/create/schema";
import type { ManagementEventDetail, ManagementMenuSpecialItem } from "@/lib/management-app/client";
import { buildEventFactSheet, stripImportedFormatting, toneForCategory, type CopyTone, type EventFactSheet } from "@/lib/management-app/event-facts";
import type { PromotionWindow } from "@/lib/management-app/promotion-window";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { eventEndFromDuration } from "@/lib/scheduling/event-end";
import type { PlatformCtaLinks } from "@/types/content";

interface EventPrefillResult {
  fields: Partial<
    Pick<
      EventCampaignFormValues,
      "name" | "description" | "startDate" | "startTime" | "ctaUrl" | "linkInBioUrl" | "prompt"
    >
  > & {
    bookingUrl?: string;
    metaAdsShortLink?: string;
    metaAdsDestinationUrl?: string;
    eventCategoryName?: string;
    eventCategorySlug?: string;
    paymentMode?: string;
    bookingMode?: string;
    price?: number;
    pricePerSeat?: number;
    capacity?: number;
    seatsRemaining?: number;
    isFree?: boolean;
    ctaLinks?: PlatformCtaLinks;
    /**
     * For Google profile event posts (tasks/SPEC-gbp-posting-reintroduction.md §3).
     * endTime is the management app's end time, or start plus its duration when it has none;
     * endDate is set only for an event that ends on a later day than the form would work out.
     */
    endTime?: string;
    endDate?: string;
    managementEventId?: string;
    googleCtaUrl?: string;
    takesBookings?: boolean;
    /** What the management app knows about the event, for the copy prompt. */
    facts?: EventFactSheet;
    /** A starting tone for this kind of event, when the category suggests one. */
    suggestedTone?: CopyTone;
    /** When posts may start: after the last event of the same type (set by the import action). */
    promotionWindow?: PromotionWindow;
  };
  sourceLabel: string;
}

interface PromotionPrefillResult {
  fields: Partial<
    Pick<PromotionCampaignFormValues, "name" | "offerSummary" | "endDate" | "prompt">
  >;
  sourceLabel: string;
}

const DEFAULT_PROMOTION_WINDOW_DAYS = 7;

export function mapManagementEventToEventCampaignPrefill(
  detail: ManagementEventDetail,
): EventPrefillResult {
  const name = detail.name?.trim() || "Imported event";
  const startDate = resolveEventStartDate(detail) ?? DateTime.now().toISODate() ?? "";
  const startTime = resolveEventStartTime(detail) ?? "19:00";
  // Imported text arrives with Markdown and Windows line endings, which social
  // copy would show literally (and the model echoes the Markdown headline).
  const description = stripImportedFormatting(detail.brief ?? "") || undefined;
  const facebookCtaUrl =
    detail.ctaLinks?.facebook?.trim() ||
    detail.cta_links?.facebook?.trim() ||
    detail.facebookShortLink?.trim() ||
    detail.facebook_short_link?.trim() ||
    undefined;
  const bookingUrl = detail.bookingUrl?.trim() || detail.booking_url?.trim() || undefined;
  const linkInBioUrl =
    detail.ctaLinks?.instagram?.trim() ||
    detail.cta_links?.instagram?.trim() ||
    detail.linkInBioShortLink?.trim() ||
    detail.link_in_bio_short_link?.trim() ||
    undefined;
  const metaAdsShortLink =
    detail.ctaLinks?.meta_ads?.trim() ||
    detail.cta_links?.meta_ads?.trim() ||
    detail.metaAdsShortLink?.trim() ||
    detail.meta_ads_short_link?.trim() ||
    undefined;
  const metaAdsDestinationUrl =
    detail.metaAdsDestinationUrl?.trim() || detail.meta_ads_destination_url?.trim() || undefined;
  const googleCtaUrl =
    detail.ctaLinks?.gbp?.trim() ||
    detail.cta_links?.gbp?.trim() ||
    detail.googleBusinessProfileShortLink?.trim() ||
    detail.google_business_profile_short_link?.trim() ||
    undefined;
  // Only from the event's real start: the fallbacks above are placeholders, not facts.
  const hasRealStart = Boolean(resolveEventStartDate(detail) && resolveEventStartTime(detail));
  const eventEnd = hasRealStart ? resolveEventEndPrefill(detail, startDate, startTime) : null;
  const eventCategoryName = detail.categoryName?.trim() || detail.category?.name?.trim() || undefined;
  const eventCategorySlug = detail.categorySlug?.trim() || detail.category?.slug?.trim() || undefined;

  const highlightsLine = Array.isArray(detail.highlights) && detail.highlights.length
    ? `Highlights: ${detail.highlights.join(", ")}.`
    : "";
  const performerLine = detail.performer_name
    ? `Performer: ${detail.performer_name}${detail.performer_type ? ` (${detail.performer_type})` : ""}.`
    : "";
  const bookingLine = [
    detail.booking_mode ? `booking mode ${detail.booking_mode}` : "",
    detail.payment_mode ? `payment mode ${detail.payment_mode}` : "",
    typeof detail.price_per_seat === "number" && detail.price_per_seat > 0
      ? `price £${formatPrice(detail.price_per_seat)} per person`
      : typeof detail.price === "number" && detail.price > 0
        ? `price £${formatPrice(detail.price)}`
        : detail.is_free === true
          ? "free event"
          : "",
  ].filter(Boolean).join(", ");
  const capacityLine = [
    typeof detail.capacity === "number" ? `capacity ${detail.capacity}` : "",
    typeof detail.seats_remaining === "number" ? `${detail.seats_remaining} seats remaining` : "",
  ].filter(Boolean).join(", ");

  const promptParts = [
    `Imported from management app event "${name}".`,
    detail.event_status ? `Current status: ${detail.event_status}.` : "",
    bookingLine ? `Booking details: ${bookingLine}.` : "",
    capacityLine ? `Capacity signal: ${capacityLine}.` : "",
    highlightsLine,
    performerLine,
  ].filter(Boolean);

  return {
    fields: {
      name,
      description,
      startDate,
      startTime,
      ctaUrl: facebookCtaUrl,
      bookingUrl,
      linkInBioUrl,
      metaAdsShortLink,
      metaAdsDestinationUrl,
      eventCategoryName,
      eventCategorySlug,
      paymentMode: detail.payment_mode ?? undefined,
      bookingMode: detail.booking_mode ?? undefined,
      price: detail.price ?? undefined,
      pricePerSeat: detail.price_per_seat ?? undefined,
      capacity: detail.capacity ?? undefined,
      seatsRemaining: detail.seats_remaining ?? undefined,
      isFree: detail.is_free ?? undefined,
      ctaLinks: {
        ...(facebookCtaUrl ? { facebook: facebookCtaUrl } : {}),
        ...(linkInBioUrl ? { instagram: linkInBioUrl } : {}),
      },
      ...(eventEnd ?? {}),
      managementEventId: detail.id,
      googleCtaUrl,
      takesBookings: Boolean(bookingUrl),
      facts: buildEventFactSheet({ ...detail, categoryName: eventCategoryName ?? null }),
      suggestedTone: toneForCategory(eventCategoryName ?? eventCategorySlug) ?? undefined,
      prompt: promptParts.join(" "),
    },
    sourceLabel: `${name} (${startDate}${startTime ? ` ${startTime}` : ""})`,
  } satisfies EventPrefillResult;
}

export function mapManagementSpecialToPromotionPrefill(
  special: ManagementMenuSpecialItem,
): PromotionPrefillResult {
  const name = special.name?.trim() || "Imported special";
  const description = special.description?.trim() || `Feature this special: ${name}.`;

  const endDateCandidate = parseIsoDateToLocalDate(special.offers?.availableThrough);
  const endDate = endDateCandidate || deriveDefaultPromotionEndDate();

  const promptParts = [
    `Imported from management menu special "${name}".`,
    special.section ? `Section: ${special.section}.` : "",
    special.offers?.availableThrough ? "Emphasize limited availability before it ends." : "",
  ].filter(Boolean);

  return {
    fields: {
      name,
      offerSummary: description,
      endDate,
      prompt: promptParts.join(" "),
    },
    sourceLabel: `${name} (ends ${endDate})`,
  } satisfies PromotionPrefillResult;
}

function resolveEventStartDate(detail: ManagementEventDetail): string | null {
  if (detail.date && /^\d{4}-\d{2}-\d{2}$/.test(detail.date)) {
    return detail.date;
  }

  if (detail.startDate) {
    return parseIsoDateToLocalDate(detail.startDate);
  }

  return null;
}

function resolveEventStartTime(detail: ManagementEventDetail): string | null {
  if (detail.time && /^\d{2}:\d{2}$/.test(detail.time)) {
    return detail.time;
  }

  if (detail.startDate) {
    const parsed = DateTime.fromISO(detail.startDate, { zone: DEFAULT_TIMEZONE });
    if (parsed.isValid) {
      return parsed.toFormat("HH:mm");
    }
  }

  return null;
}

/**
 * The end to pre-fill: the management app's own end time when it has one
 * (HH:MM or HH:MM:SS), otherwise start plus its duration. Nothing is guessed
 * when it holds neither.
 */
function resolveEventEndPrefill(
  detail: ManagementEventDetail,
  startDate: string,
  startTime: string,
): { endTime: string; endDate?: string } | null {
  const explicit = detail.end_time?.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/);
  if (explicit) return { endTime: `${explicit[1]}:${explicit[2]}` };
  return eventEndFromDuration({ startDate, startTime, durationMinutes: detail.duration_minutes });
}

function parseIsoDateToLocalDate(value: string | null | undefined): string | null {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = DateTime.fromISO(value, { zone: DEFAULT_TIMEZONE });
  if (!parsed.isValid) return null;
  return parsed.toISODate();
}

function deriveDefaultPromotionEndDate(): string {
  const baseline = DateTime.now().setZone(DEFAULT_TIMEZONE).startOf("day");
  return baseline.plus({ days: DEFAULT_PROMOTION_WINDOW_DAYS }).toISODate() ?? baseline.toISODate() ?? "";
}

function formatPrice(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(2);
}
