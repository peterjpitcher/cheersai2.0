import { DateTime } from "luxon";

import type { EventCampaignFormValues, PromotionCampaignFormValues } from "@/lib/create/schema";
import type { ManagementEventDetail, ManagementMenuSpecialItem } from "@/lib/management-app/client";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

interface EventPrefillResult {
  fields: Partial<
    Pick<
      EventCampaignFormValues,
      "name" | "description" | "startDate" | "startTime" | "ctaUrl" | "linkInBioUrl" | "prompt"
    >
  > & {
    metaAdsShortLink?: string;
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
  const description = detail.brief?.trim() || undefined;
  const facebookCtaUrl =
    detail.facebookShortLink?.trim() || detail.facebook_short_link?.trim() || undefined;
  const linkInBioUrl =
    detail.linkInBioShortLink?.trim() || detail.link_in_bio_short_link?.trim() || undefined;
  const metaAdsShortLink =
    detail.metaAdsShortLink?.trim() || detail.meta_ads_short_link?.trim() || undefined;

  const highlightsLine = Array.isArray(detail.highlights) && detail.highlights.length
    ? `Highlights: ${detail.highlights.join(", ")}.`
    : "";
  const performerLine = detail.performer_name
    ? `Performer: ${detail.performer_name}${detail.performer_type ? ` (${detail.performer_type})` : ""}.`
    : "";

  const promptParts = [
    `Imported from management app event "${name}".`,
    detail.event_status ? `Current status: ${detail.event_status}.` : "",
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
      linkInBioUrl,
      metaAdsShortLink,
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
