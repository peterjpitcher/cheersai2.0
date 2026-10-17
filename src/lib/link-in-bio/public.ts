import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from "@/lib/constants";
import { normaliseStoragePath, resolvePreviewCandidates, type PreviewCandidate } from "@/lib/library/data";
import { createLogger } from "@/lib/logging";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
} from "@/lib/banner/config";
import { extractCampaignTiming, getNextWeeklyOccurrenceForDays } from "@/lib/scheduling/campaign-timing";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import {
  getManagementEventDetail,
  listManagementEvents,
  type ManagementApiConfig,
  type ManagementEventDetail,
  type ManagementEventListItem,
} from "@/lib/management-app/client";

import type {
  LinkInBioFont,
  LinkInBioProfile,
  LinkInBioTheme,
  LinkInBioTemplate,
  PublicCampaignCard,
  PublicLinkInBioPageData,
  PublicLinkInBioTile,
  PublicWebsiteEvent,
} from "./types";

interface LinkInBioProfileRow {
  account_id: string;
  slug: string;
  display_name: string | null;
  bio: string | null;
  logo_url: string | null;
  hero_media_id: string | null;
  theme: LinkInBioTheme | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  booking_url: string | null;
  menu_url: string | null;
  parking_url: string | null;
  directions_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  template: string;
  font_family: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkInBioTileRow {
  id: string;
  account_id: string;
  title: string;
  subtitle: string | null;
  cta_label: string;
  cta_url: string | null;
  media_asset_id: string | null;
  tile_type: string | null;
  embed_data: Record<string, unknown> | null;
  position: number | null;
  enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

interface CampaignVariantRow {
  media_ids: string[] | null;
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
}

interface CampaignContentRow {
  id: string;
  campaign_id: string | null;
  scheduled_for: string | null;
  status: string;
  placement: "feed" | "story";
  prompt_context: Record<string, unknown> | null;
  content_variants: CampaignVariantRow[] | CampaignVariantRow | null;
  platform: "facebook" | "instagram";
  campaigns: {
    id: string;
    name: string | null;
    campaign_type: string;
    link_in_bio_url: string | null;
    account_id: string;
    metadata: Record<string, unknown> | null;
  } | null;
}

interface PostingDefaultsRow {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
}

interface MediaAssetRow {
  id: string;
  media_type: "image" | "video";
  storage_path: string;
  derived_variants: Record<string, string> | null;
}

type PublicPreviewShape = "square" | "story";
type PublicMediaPreview = { url: string; shape: PublicPreviewShape };
type PublicMediaPreviewByShape = Partial<Record<PublicPreviewShape, PublicMediaPreview>>;

interface AccountRow {
  timezone: string | null;
}

interface ManagementConnectionRow {
  base_url: string | null;
  api_key: string | null;
  enabled: boolean | null;
}

interface CampaignEntry {
  scheduled: DateTime;
  slotLabel: string | null;
  mediaId: string | null;
  platform: CampaignContentRow["platform"];
  promptContext: Record<string, unknown> | null;
  bannerOverrides: PostBannerOverrides;
}

interface CampaignAggregate {
  id: string;
  name: string;
  linkUrl: string;
  campaignType: string;
  campaignMetadata: Record<string, unknown>;
  earliest: DateTime | null;
  latest: DateTime | null;
  entries: CampaignEntry[];
}

type ServiceSupabaseClient = NonNullable<ReturnType<typeof tryCreateServiceSupabaseClient>>;

const logger = createLogger("link-in-bio");

const WEBSITE_EVENT_LIMIT = 6;
/** An event stays listed until it started this many hours ago. */
const WEBSITE_EVENT_GRACE_HOURS = 4;
/**
 * How long one fetch of the management "what's on" list is reused.
 *
 * The list used to sit in `unstable_cache` for five minutes. That cache is
 * stale-while-revalidate: the first visitor after a quiet spell got the old
 * copy while a refresh ran for whoever came next. The Anchor's page is seen
 * about once every two days, so most of its visitors saw a list days old (past
 * events at the top, new ones missing). Now every render fetches fresh, and a
 * result is reused only for this long, so a burst of views (and the metadata
 * and page renders of one request) share one fetch instead of each making up
 * to eleven management calls. See tasks/SPEC-link-in-bio-freshness.md.
 */
const WEBSITE_EVENTS_REUSE_MS = 60_000;
/**
 * Timeout for each management call. The management app's logs for the 30 days
 * to 17 October 2026 show at worst 641ms for the list and 1.7s for an event
 * detail during a page refresh, so this leaves headroom without holding the
 * page for the six seconds it used to allow.
 */
const WEBSITE_EVENTS_TIMEOUT_MS = 2_500;
/**
 * Detail candidates fetched beyond what is rendered. Detail data can still drop
 * an event (no name anywhere, or a status that turns out to be cancelled), so a
 * small buffer backfills rather than leaving a short list. Without it we would
 * have to fetch details for every listed event just in case, which is the cost
 * this change removes.
 */
const WEBSITE_EVENT_DETAIL_BUFFER = 4;
const MANAGEMENT_EVENT_STATUSES = "scheduled,rescheduled,postponed,sold_out";
const FALLBACK_WEBSITE_BASE_URL = "https://the-anchor.pub";

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toIsoOrNull(value: DateTime | null | undefined): string | null {
  if (!value?.isValid) return null;
  return value.toISO();
}

function resolveDefaultCampaignCtaLabel(campaignType: string) {
  switch (campaignType) {
    case "event":
      return "Book now";
    case "weekly":
      return "Book a table";
    case "promotion":
    case "instant":
    default:
      return "Learn more";
  }
}

function resolveCampaignCtaLabel(
  campaignType: string,
  campaignMetadata: Record<string, unknown>,
  promptContext: Record<string, unknown> | null,
): string {
  return (
    readString(promptContext?.ctaLabel)
    ?? readString(campaignMetadata.ctaLabel)
    ?? resolveDefaultCampaignCtaLabel(campaignType)
  );
}

function resolveCampaignSummary(campaignMetadata: Record<string, unknown>): string | null {
  const brief = readRecord(campaignMetadata.brief);
  const candidates = [
    readString(campaignMetadata.offerSummary),
    readString(brief?.offerSummary),
    readString(campaignMetadata.description),
    readString(brief?.description),
    readString(campaignMetadata.prompt),
    readString(brief?.prompt),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const looksLikeInternalBrief = /(^|\n)\s*#{1,6}\s|\*\*|Customer-Facing|Event purpose|Accuracy guardrails/i.test(candidate);
    if (looksLikeInternalBrief || candidate.length > 220) continue;
    return candidate.length > 140 ? `${candidate.slice(0, 137).trimEnd()}...` : candidate;
  }

  return null;
}

function resolveCampaignDisplayWindow(aggregate: CampaignAggregate, referenceAt: DateTime) {
  const fallbackStart = aggregate.earliest;
  const fallbackEnd = aggregate.latest?.endOf("day") ?? null;

  try {
    const timing = extractCampaignTiming({
      campaign_type: aggregate.campaignType,
      metadata: aggregate.campaignMetadata,
    });

    if (aggregate.campaignType === "weekly" && timing.weeklyDayOfWeek) {
      const activeUntil = timing.endAt?.isValid ? timing.endAt.endOf("day") : null;
      if (activeUntil && referenceAt > activeUntil) {
        return {
          startsAt: fallbackStart,
          endsAt: activeUntil,
        };
      }

      const days = timing.weeklyDaysOfWeek?.length
        ? timing.weeklyDaysOfWeek
        : [timing.weeklyDayOfWeek];
      const nextOccurrence = getNextWeeklyOccurrenceForDays(
        referenceAt,
        days,
        timing.timezone,
        timing.startTime,
      );
      const occurrenceEnd = nextOccurrence.endOf("day");
      return {
        startsAt: nextOccurrence,
        endsAt: activeUntil && activeUntil < occurrenceEnd ? activeUntil : occurrenceEnd,
      };
    }

    if (aggregate.campaignType === "promotion") {
      return {
        startsAt: timing.startAt?.isValid ? timing.startAt : fallbackStart,
        endsAt: timing.endAt?.isValid ? timing.endAt.endOf("day") : fallbackEnd,
      };
    }

    if (aggregate.campaignType === "event") {
      return {
        startsAt: timing.startAt?.isValid ? timing.startAt : fallbackStart,
        endsAt: timing.startAt?.isValid ? timing.startAt.endOf("day") : fallbackEnd,
      };
    }
  } catch {
    // Fall back to the content schedule if older metadata is incomplete.
  }

  return {
    startsAt: fallbackStart,
    endsAt: fallbackEnd,
  };
}

function resolveCampaignActiveEnd(
  displayEndsAt: DateTime | null,
  fallbackScheduledAt: DateTime,
): DateTime {
  const fallback = fallbackScheduledAt.endOf("day");
  if (!displayEndsAt?.isValid) return fallback;
  return DateTime.max(displayEndsAt.endOf("day"), fallback);
}

function shapeProfile(row: LinkInBioProfileRow): LinkInBioProfile {
  return {
    accountId: row.account_id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    logoUrl: row.logo_url ?? null,
    heroMediaId: row.hero_media_id,
    theme: row.theme ?? {},
    phoneNumber: row.phone_number,
    whatsappNumber: row.whatsapp_number,
    bookingUrl: row.booking_url,
    menuUrl: row.menu_url,
    parkingUrl: row.parking_url,
    directionsUrl: row.directions_url,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    websiteUrl: row.website_url,
    template: (row.template ?? 'classic') as LinkInBioTemplate,
    fontFamily: (row.font_family ?? 'inter') as LinkInBioFont,
    isPublished: row.is_published ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies LinkInBioProfile;
}

function resolveCampaignLinkUrl(campaign: NonNullable<CampaignContentRow["campaigns"]>): string {
  const direct = campaign.link_in_bio_url?.trim();
  if (direct) return direct;

  const metadata = campaign.metadata ?? {};
  const fallback = typeof metadata.linkInBioUrl === "string" ? metadata.linkInBioUrl.trim() : "";
  if (fallback) return fallback;

  const ctaUrl = typeof metadata.ctaUrl === "string" ? metadata.ctaUrl.trim() : "";
  return ctaUrl;
}

function normaliseWebsiteBaseUrl(value: string | null | undefined): string {
  const candidate = readString(value) ?? FALLBACK_WEBSITE_BASE_URL;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return FALLBACK_WEBSITE_BASE_URL;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return FALLBACK_WEBSITE_BASE_URL;
  }
}

function parseEventTimeParts(value: string | null | undefined): { hour: number; minute: number } | null {
  const match = readString(value)?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function parseManagementEventStart(
  listItem: ManagementEventListItem,
  detail: ManagementEventDetail | null,
  timezone: string,
): DateTime | null {
  const explicitStart = detail?.startDate ?? listItem.startDate;
  if (explicitStart) {
    const parsed = DateTime.fromISO(explicitStart, { zone: timezone }).setZone(timezone);
    if (parsed.isValid) return parsed;
  }

  const dateValue = detail?.date ?? listItem.date;
  if (!dateValue) return null;

  const date = DateTime.fromISO(dateValue, { zone: timezone });
  if (!date.isValid) return null;

  const time = parseEventTimeParts(detail?.time ?? listItem.time);
  if (!time) return date.startOf("day");
  return date.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
}

function cleanPublicEventText(value: string | null | undefined): string | null {
  const text = readString(value);
  if (!text) return null;
  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > 128 ? `${plain.slice(0, 125).trimEnd()}...` : plain;
}

function isVisibleManagementEventStatus(status: string | null | undefined): boolean {
  const normalised = status?.trim().toLowerCase();
  if (!normalised) return true;
  return !["cancelled", "canceled", "draft", "archived", "deleted"].includes(normalised);
}

function resolveWebsiteEventImage(detail: ManagementEventDetail | null): string | null {
  if (!detail) return null;
  const candidates = [
    detail.heroImageUrl,
    detail.thumbnailImageUrl,
    detail.posterImageUrl,
    detail.imageUrl,
    ...(detail.image ?? []),
  ];
  return candidates.map((value) => readString(value)).find((value): value is string => Boolean(value && isHttpUrl(value))) ?? null;
}

function resolveWebsiteEventSummary(detail: ManagementEventDetail | null): string | null {
  if (!detail) return null;
  return (
    cleanPublicEventText(detail.shortDescription)
    ?? cleanPublicEventText(detail.description)
    ?? cleanPublicEventText(detail.brief)
    ?? cleanPublicEventText(detail.longDescription)
    ?? null
  );
}

function resolveWebsiteEventLink(
  listItem: ManagementEventListItem,
  detail: ManagementEventDetail | null,
  websiteBaseUrl: string,
): string {
  const direct = [
    detail?.linkInBioShortLink,
    detail?.link_in_bio_short_link,
    detail?.ctaLinks?.instagram,
    detail?.cta_links?.instagram,
    detail?.bookingUrl,
    detail?.booking_url,
    listItem.bookingUrl,
    listItem.booking_url,
  ].map((value) => readString(value)).find((value): value is string => Boolean(value));

  if (direct) return direct;

  const eventPath = detail?.slug ?? listItem.slug ?? detail?.id ?? listItem.id;
  return `${websiteBaseUrl}/events/${encodeURIComponent(eventPath)}`;
}

function resolveWebsiteEventCtaLabel(detail: ManagementEventDetail | null, ctaUrl: string): string {
  const soldOut = detail?.is_full === true || detail?.event_status === "sold_out";
  if (soldOut) return "See details";
  if (/\/book|booking|ticket|l\.the-anchor\.pub/i.test(ctaUrl)) return "Book now";
  return "View event";
}

function shapePublicWebsiteEvent(
  listItem: ManagementEventListItem,
  detail: ManagementEventDetail | null,
  timezone: string,
  websiteBaseUrl: string,
): PublicWebsiteEvent | null {
  const startsAt = parseManagementEventStart(listItem, detail, timezone);
  if (!startsAt?.isValid) return null;

  const name = readString(detail?.name) ?? readString(listItem.name);
  if (!name) return null;

  const status = detail?.event_status ?? listItem.event_status ?? null;
  if (!isVisibleManagementEventStatus(status)) return null;

  const ctaUrl = resolveWebsiteEventLink(listItem, detail, websiteBaseUrl);

  return {
    id: detail?.id ?? listItem.id,
    slug: detail?.slug ?? listItem.slug ?? null,
    name,
    startsAt: startsAt.toISO() ?? startsAt.toUTC().toISO()!,
    status,
    categoryLabel: detail?.category?.name ?? detail?.categoryName ?? listItem.categoryName ?? null,
    summary: resolveWebsiteEventSummary(detail),
    imageUrl: resolveWebsiteEventImage(detail),
    ctaUrl,
    ctaLabel: resolveWebsiteEventCtaLabel(detail, ctaUrl),
  } satisfies PublicWebsiteEvent;
}

/**
 * Narrow a management event list down to the entries worth fetching details for.
 *
 * Start time and status are both resolvable from the list item alone
 * (`parseManagementEventStart` falls back to `startDate`/`date`/`time` when no
 * detail is supplied), so the ordering and the "not long past" cut can be
 * applied before spending a network round trip per event. Exported for testing.
 */
export function selectWebsiteEventCandidates(
  list: ManagementEventListItem[],
  timezone: string,
  now: DateTime,
): ManagementEventListItem[] {
  const threshold = now.minus({ hours: WEBSITE_EVENT_GRACE_HOURS });
  const seen = new Set<string>();
  const dated: { item: ManagementEventListItem; startsAt: DateTime }[] = [];

  for (const item of list) {
    if (!item?.id || seen.has(item.id)) continue;
    if (!isVisibleManagementEventStatus(item.event_status)) continue;

    const startsAt = parseManagementEventStart(item, null, timezone);
    if (!startsAt?.isValid || startsAt < threshold) continue;

    seen.add(item.id);
    dated.push({ item, startsAt });
  }

  return dated
    .sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis())
    .slice(0, WEBSITE_EVENT_LIMIT + WEBSITE_EVENT_DETAIL_BUFFER)
    .map((entry) => entry.item);
}

/**
 * Cut a list of events, sorted by start, to the ones still worth showing at
 * `now`, capped at what the page renders. Applied when the list is shown, not
 * when it was fetched, so a remembered list can never show an event that has
 * since passed.
 */
function upcomingWebsiteEvents(
  events: PublicWebsiteEvent[],
  timezone: string,
  now: DateTime,
): PublicWebsiteEvent[] {
  const threshold = now.minus({ hours: WEBSITE_EVENT_GRACE_HOURS });
  return events
    .filter((event) => {
      const startsAt = DateTime.fromISO(event.startsAt).setZone(timezone);
      return startsAt.isValid && startsAt >= threshold;
    })
    .slice(0, WEBSITE_EVENT_LIMIT);
}

/**
 * Fetch a brand's upcoming events from the management app: every event the
 * page could show, sorted by start and not yet cut to the display limit.
 *
 * Resolves to [] when the brand's import is off or not set up, and to null when
 * the switch or the connection cannot be read, so the caller fails closed
 * without using an older list. Rejects when the management app's list call
 * fails or times out.
 */
async function fetchWebsiteEvents(
  accountId: string,
  timezone: string,
  websiteUrl: string | null,
): Promise<PublicWebsiteEvent[] | null> {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) return null;

  const now = DateTime.now().setZone(timezone);

  // The management-app import is a per-brand switch; fail closed if it is off
  // or the lookup fails.
  const { data: brand, error: brandError } = await supabase
    .from("accounts")
    .select("management_import_enabled")
    .eq("id", accountId)
    .maybeSingle<{ management_import_enabled: boolean | null }>();
  if (brandError) {
    if (!isSchemaMissingError(brandError)) {
      logger.warn("could not read the management import switch; showing no events", {
        accountId,
        error: brandError.message,
      });
    }
    return null;
  }
  if (brand?.management_import_enabled !== true) {
    return [];
  }

  const { data: connection, error } = await supabase
    .from("management_app_connections")
    .select("base_url, api_key, enabled")
    .eq("account_id", accountId)
    .maybeSingle<ManagementConnectionRow>();

  if (error) {
    if (!isSchemaMissingError(error)) {
      console.error("[link-in-bio] failed to load management connection", error);
    }
    return null;
  }

  const baseUrl = connection?.base_url?.trim();
  const apiKey = connection?.api_key?.trim();
  if (!connection?.enabled || !baseUrl || !apiKey) {
    return [];
  }

  const config: ManagementApiConfig = { baseUrl, apiKey, timeoutMs: WEBSITE_EVENTS_TIMEOUT_MS };
  const websiteBaseUrl = normaliseWebsiteBaseUrl(websiteUrl);

  const list = await listManagementEvents(config, {
    limit: WEBSITE_EVENT_LIMIT * 3,
    fromDate: now.toISODate() ?? undefined,
    status: MANAGEMENT_EVENT_STATUSES,
  });

  // Only the events that can actually be rendered get a detail round trip.
  // Previously this fetched details for every listed event and then discarded
  // most of them, which is where the bulk of the page latency came from.
  const candidates = selectWebsiteEventCandidates(list, timezone, now);

  const detailResults = await Promise.all(candidates.map(async (item) => {
    let detail: ManagementEventDetail | null = null;
    try {
      detail = await getManagementEventDetail(config, item.id, { fallbackSlug: item.slug ?? undefined });
    } catch (error) {
      console.error("[link-in-bio] failed to load management event detail", { eventId: item.id, error });
    }

    return shapePublicWebsiteEvent(item, detail, timezone, websiteBaseUrl);
  }));

  const deduped = new Map<string, PublicWebsiteEvent>();
  for (const event of detailResults) {
    if (event) deduped.set(event.id, event);
  }

  return Array.from(deduped.values())
    .sort((a, b) => DateTime.fromISO(a.startsAt).toMillis() - DateTime.fromISO(b.startsAt).toMillis());
}

interface RememberedWebsiteEvents {
  events: PublicWebsiteEvent[];
  fetchedAt: number;
}

/**
 * Each brand's last good list, and any fetch in flight. Module scope, so they
 * last as long as the server instance. The remembered list is reused for
 * WEBSITE_EVENTS_REUSE_MS and after that is only a fallback for when the
 * management app fails; a cold instance has none, and then shows no events.
 */
const rememberedWebsiteEvents = new Map<string, RememberedWebsiteEvents>();
const pendingWebsiteEvents = new Map<string, Promise<PublicWebsiteEvent[] | null>>();

/**
 * One fetch per brand at a time; a successful result becomes the remembered
 * list. A failure is logged here, once per fetch, rather than by each render
 * that shared it (the metadata and the page are two).
 */
function fetchWebsiteEventsOnce(
  accountId: string,
  timezone: string,
  websiteUrl: string | null,
): Promise<PublicWebsiteEvent[] | null> {
  const pending = pendingWebsiteEvents.get(accountId);
  if (pending) return pending;

  const request = fetchWebsiteEvents(accountId, timezone, websiteUrl)
    .then((events) => {
      if (events) {
        rememberedWebsiteEvents.set(accountId, { events, fetchedAt: Date.now() });
      }
      return events;
    })
    .catch((error: unknown) => {
      const fallback = rememberedWebsiteEvents.get(accountId);
      logger.warn(
        fallback
          ? "management events fetch failed; showing the last good list"
          : "management events fetch failed; showing no events",
        {
          accountId,
          error: error instanceof Error ? error.message : String(error),
          lastGoodAgeSeconds: fallback ? Math.round((Date.now() - fallback.fetchedAt) / 1000) : null,
        },
      );
      throw error;
    })
    .finally(() => {
      pendingWebsiteEvents.delete(accountId);
    });
  pendingWebsiteEvents.set(accountId, request);
  return request;
}

/**
 * The brand's "what's on" list for one render, fetched from the management app.
 *
 * A list fetched under WEBSITE_EVENTS_REUSE_MS ago is reused, and renders that
 * arrive together share one fetch. The last good list is shown only when the
 * fetch fails or times out, and whichever list is shown is cut against the
 * current time. Never rejects: on any failure the page renders without events
 * rather than failing. Exported for testing.
 */
export async function getPublicWebsiteEvents(
  accountId: string,
  timezone: string,
  websiteUrl: string | null,
): Promise<PublicWebsiteEvent[]> {
  try {
    const remembered = rememberedWebsiteEvents.get(accountId);
    if (remembered && Date.now() - remembered.fetchedAt < WEBSITE_EVENTS_REUSE_MS) {
      return upcomingWebsiteEvents(remembered.events, timezone, DateTime.now().setZone(timezone));
    }

    const events = await fetchWebsiteEventsOnce(accountId, timezone, websiteUrl);
    return events ? upcomingWebsiteEvents(events, timezone, DateTime.now().setZone(timezone)) : [];
  } catch {
    // Already logged by fetchWebsiteEventsOnce.
    const fallback = rememberedWebsiteEvents.get(accountId);
    return fallback ? upcomingWebsiteEvents(fallback.events, timezone, DateTime.now().setZone(timezone)) : [];
  }
}

/**
 * Optional per-phase timing collector. Passing one in is how the guarded
 * diagnostic route at /api/internal/link-in-bio-timing measures this function
 * without changing anything on the public render path: when it is omitted,
 * `track` just awaits the promise.
 */
export type PageDataTimings = Record<string, number>;

async function track<T>(
  timings: PageDataTimings | undefined,
  phase: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!timings) return work();
  const started = Date.now();
  try {
    return await work();
  } finally {
    timings[phase] = (timings[phase] ?? 0) + (Date.now() - started);
  }
}

/** Minimum a campaign needs before we know whether it can be displayed. */
export interface CampaignDisplayCandidate {
  id: string;
  campaignType: string;
  campaignMetadata: Record<string, unknown>;
  linkUrl: string;
  earliest: DateTime | null;
  latest: DateTime | null;
}

/**
 * Decide which campaigns can actually appear, from scheduling bounds alone.
 *
 * This exists so the page does not have to load every content item it has ever
 * published just to render the one or two campaigns that are currently live.
 * It applies exactly the same rules the card loop applies, so narrowing here
 * cannot show or hide anything the full pass would not have.
 */
export function selectDisplayableCampaignIds(
  candidates: CampaignDisplayCandidate[],
  now: DateTime,
): string[] {
  const ids: string[] = [];

  for (const candidate of candidates) {
    if (!candidate.linkUrl) continue;
    if (!candidate.earliest?.isValid || !candidate.latest?.isValid) continue;
    // Not started yet.
    if (now < candidate.earliest) continue;

    const displayWindow = resolveCampaignDisplayWindow(
      {
        id: candidate.id,
        name: "",
        linkUrl: candidate.linkUrl,
        campaignType: candidate.campaignType,
        campaignMetadata: candidate.campaignMetadata,
        earliest: candidate.earliest,
        latest: candidate.latest,
        entries: [],
      },
      now,
    );
    if (now > resolveCampaignActiveEnd(displayWindow.endsAt, candidate.latest)) continue;

    ids.push(candidate.id);
  }

  return ids;
}

export async function getPublicLinkInBioPageData(
  slug: string,
  timings?: PageDataTimings,
): Promise<PublicLinkInBioPageData | null> {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service credentials are not configured");
  }

  try {
    const { data: profileRow, error: profileError } = await track(timings, "profile", async () => supabase
      .from("link_in_bio_profiles")
      .select(
        "account_id, slug, display_name, bio, logo_url, hero_media_id, theme, phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url, website_url, template, font_family, is_published, created_at, updated_at",
      )
      .eq("slug", slug)
      .maybeSingle<LinkInBioProfileRow>());

    if (profileError) {
      if (isSchemaMissingError(profileError)) {
        return null;
      }
      throw profileError;
    }

    if (!profileRow) {
      return null;
    }

    const profile = shapeProfile(profileRow);
    const accountId = profile.accountId;

    const [
      { data: accountRow, error: accountError },
      { data: tileRows, error: tileError },
      { data: postingDefaultsRow, error: postingDefaultsError },
    ] = await track(timings, "account+tiles+defaults", () => Promise.all([
      supabase
        .from("accounts")
        .select("timezone")
        .eq("id", accountId)
        .maybeSingle<AccountRow>(),
      supabase
        .from("link_in_bio_tiles")
        .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, tile_type, embed_data, position, enabled, created_at, updated_at")
        .eq("account_id", accountId)
        .eq("enabled", true)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .returns<LinkInBioTileRow[]>(),
      supabase
        .from("posting_defaults")
        .select("banners_enabled, banner_position, banner_bg, banner_text_colour")
        .eq("account_id", accountId)
        .maybeSingle<PostingDefaultsRow>(),
    ]));

    if (accountError && !isSchemaMissingError(accountError)) {
      throw accountError;
    }

    if (tileError && !isSchemaMissingError(tileError)) {
      throw tileError;
    }

    if (postingDefaultsError && !isSchemaMissingError(postingDefaultsError)) {
      throw postingDefaultsError;
    }

    const accountBannerDefaults: AccountBannerDefaults | null = postingDefaultsRow
      ? {
          banners_enabled: postingDefaultsRow.banners_enabled,
          banner_position: postingDefaultsRow.banner_position,
          banner_bg: postingDefaultsRow.banner_bg,
          banner_text_colour: postingDefaultsRow.banner_text_colour,
        }
      : null;

    const timezone = accountRow?.timezone ?? DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(timezone);

    // Started now so the management app's round trips overlap the campaign
    // queries below. It never rejects, so nothing is left unhandled if one of
    // those queries throws first.
    const websiteEventsPromise = getPublicWebsiteEvents(accountId, timezone, profile.websiteUrl);

    // Loading every content item this account has ever published, with its
    // variants and campaign metadata, cost over a second and grew with history,
    // all to render the one or two campaigns that are live. Narrow first on
    // cheap columns, then fetch the full rows only for the campaigns that can
    // actually appear. The scheduling bounds come from the complete entry set,
    // so this decides exactly what the full pass would have decided.
    const { data: scheduleRows, error: scheduleError } = await track(timings, "campaigns-schedule", async () => supabase
      .from("content_items")
      .select("campaign_id, scheduled_for, campaigns!inner(account_id)")
      .eq("campaigns.account_id", accountId)
      .eq("placement", "feed")
      .in("platform", ["instagram", "facebook"])
      .in("status", ["scheduled", "publishing", "posted"])
      .returns<{ campaign_id: string | null; scheduled_for: string | null }[]>());

    if (scheduleError && !isSchemaMissingError(scheduleError)) {
      throw scheduleError;
    }

    const bounds = new Map<string, { earliest: DateTime; latest: DateTime }>();
    for (const row of scheduleRows ?? []) {
      if (!row.campaign_id || !row.scheduled_for) continue;
      const scheduled = DateTime.fromISO(row.scheduled_for).setZone(timezone);
      if (!scheduled.isValid) continue;
      const existing = bounds.get(row.campaign_id);
      if (!existing) {
        bounds.set(row.campaign_id, { earliest: scheduled, latest: scheduled });
        continue;
      }
      if (scheduled < existing.earliest) existing.earliest = scheduled;
      if (scheduled > existing.latest) existing.latest = scheduled;
    }

    const { data: campaignDefinitions, error: campaignDefinitionError } = await track(timings, "campaign-definitions", async () => supabase
      .from("campaigns")
      .select("id, name, campaign_type, link_in_bio_url, account_id, metadata")
      .eq("account_id", accountId)
      .in("id", Array.from(bounds.keys()))
      .returns<NonNullable<CampaignContentRow["campaigns"]>[]>());

    if (campaignDefinitionError && !isSchemaMissingError(campaignDefinitionError)) {
      throw campaignDefinitionError;
    }

    const displayableIds = selectDisplayableCampaignIds(
      (campaignDefinitions ?? []).map((definition) => ({
        id: definition.id,
        campaignType: definition.campaign_type,
        campaignMetadata: definition.metadata ?? {},
        linkUrl: resolveCampaignLinkUrl(definition),
        earliest: bounds.get(definition.id)?.earliest ?? null,
        latest: bounds.get(definition.id)?.latest ?? null,
      })),
      now,
    );

    const { data: campaignRows, error: campaignError } = displayableIds.length
      ? await track(timings, "campaigns-query", async () => supabase
          .from("content_items")
          .select(
            "id, campaign_id, scheduled_for, status, placement, prompt_context, platform, content_variants(media_ids, banner_enabled, banner_text_override, banner_position, banner_bg, banner_text_colour), campaigns!inner(id, name, campaign_type, link_in_bio_url, account_id, metadata)",
          )
          .in("campaign_id", displayableIds)
          .eq("placement", "feed")
          .in("platform", ["instagram", "facebook"])
          .in("status", ["scheduled", "publishing", "posted"])
          .order("scheduled_for", { ascending: true })
          .returns<CampaignContentRow[]>())
      : { data: [] as CampaignContentRow[], error: null };

    if (campaignError && !isSchemaMissingError(campaignError)) {
      throw campaignError;
    }

    const campaignContent = (campaignRows ?? []).filter((row) => row.campaign_id && row.scheduled_for && row.campaigns);

    const mediaAssetIds = new Set<string>();
    if (profile.heroMediaId) {
      mediaAssetIds.add(profile.heroMediaId);
    }
    for (const tile of tileRows ?? []) {
      if (tile.media_asset_id) {
        mediaAssetIds.add(tile.media_asset_id);
      }
    }

    const campaignMeta = new Map<string, CampaignAggregate>();

    const normaliseVariants = (
      variants: CampaignContentRow["content_variants"],
    ): CampaignVariantRow[] => {
      if (!variants) return [];
      return Array.isArray(variants) ? variants : [variants];
    };

    for (const row of campaignContent) {
      const scheduled = DateTime.fromISO(row.scheduled_for!).setZone(timezone);

      const aggregate = campaignMeta.get(row.campaigns!.id) ?? {
        id: row.campaigns!.id,
        name: row.campaigns!.name ?? "Untitled campaign",
        linkUrl: resolveCampaignLinkUrl(row.campaigns!),
        campaignType: row.campaigns!.campaign_type,
        campaignMetadata: row.campaigns!.metadata ?? {},
        earliest: null,
        latest: null,
        entries: [],
      } satisfies CampaignAggregate;

      if (!aggregate.earliest || scheduled < aggregate.earliest) {
        aggregate.earliest = scheduled;
      }
      if (!aggregate.latest || scheduled > aggregate.latest) {
        aggregate.latest = scheduled;
      }

      const variantRows = normaliseVariants(row.content_variants);
      const firstVariant = variantRows[0] ?? null;
      const mediaIds = variantRows
        .flatMap((variant) => variant.media_ids ?? [])
        .filter((value): value is string => Boolean(value));
      if (mediaIds.length) {
        mediaAssetIds.add(mediaIds[0]);
      }

      const promptContext = row.prompt_context ?? {};
      const slotLabel = typeof promptContext?.slot === "string" && promptContext.slot.length ? promptContext.slot : null;

      aggregate.entries.push({
        scheduled,
        slotLabel,
        mediaId: mediaIds[0] ?? null,
        platform: row.platform,
        promptContext: row.prompt_context,
        bannerOverrides: {
          banner_enabled: firstVariant?.banner_enabled ?? null,
          banner_text_override: firstVariant?.banner_text_override ?? null,
          banner_position: firstVariant?.banner_position ?? null,
          banner_bg: firstVariant?.banner_bg ?? null,
          banner_text_colour: firstVariant?.banner_text_colour ?? null,
        },
      });

      campaignMeta.set(row.campaigns!.id, aggregate);
    }

    const assetMaps = await track(timings, "media-assets+signing", () =>
      fetchMediaAssets(Array.from(mediaAssetIds)));

    const campaignCards: PublicCampaignCard[] = [];

    for (const aggregate of campaignMeta.values()) {
      if (!aggregate.entries.length) {
        continue;
      }

      if (!aggregate.linkUrl) {
        continue;
      }

      const sortedEntries = [...aggregate.entries].sort((a, b) => a.scheduled.toMillis() - b.scheduled.toMillis());
      const firstEntry = sortedEntries[0];
      const lastEntry = sortedEntries[sortedEntries.length - 1];
      if (!firstEntry || !lastEntry) {
        continue;
      }

      if (now < firstEntry.scheduled) {
        continue;
      }

      const displayWindow = resolveCampaignDisplayWindow(aggregate, now);
      const campaignEnd = resolveCampaignActiveEnd(displayWindow.endsAt, lastEntry.scheduled);
      if (now > campaignEnd) {
        continue;
      }

      const platformRank: Record<CampaignContentRow["platform"], number> = {
        instagram: 0,
        facebook: 1,
      };

      const liveEntries = sortedEntries
        .filter((entry) => entry.scheduled.toMillis() <= now.toMillis())
        .sort((a, b) => {
          const timeDiff = b.scheduled.toMillis() - a.scheduled.toMillis();
          if (timeDiff !== 0) return timeDiff;
          const rankDiff = (platformRank[a.platform] ?? 99) - (platformRank[b.platform] ?? 99);
          if (rankDiff !== 0) return rankDiff;
          return 0;
        });

      const selected = liveEntries[0]
        ?? firstEntry;

      const shapePreviews = selected.mediaId ? assetMaps.previewsByShape.get(selected.mediaId) ?? null : null;
      const preview = selected.mediaId ? shapePreviews?.square ?? assetMaps.previews.get(selected.mediaId) ?? null : null;
      const mediaType = selected.mediaId ? assetMaps.mediaTypes.get(selected.mediaId) ?? "image" : "image";

      const scheduledIso = selected.scheduled.toISO() ?? now.toISO()!;
      const endIso = campaignEnd.toISO() ?? scheduledIso;

      const card: PublicCampaignCard = {
        id: aggregate.id,
        campaignId: aggregate.id,
        name: aggregate.name,
        campaignType: aggregate.campaignType,
        scheduledFor: scheduledIso,
        endAt: endIso,
        linkUrl: aggregate.linkUrl,
        ctaLabel: resolveCampaignCtaLabel(aggregate.campaignType, aggregate.campaignMetadata, selected.promptContext),
        summary: resolveCampaignSummary(aggregate.campaignMetadata),
        displayStartsAt: toIsoOrNull(displayWindow.startsAt),
        displayEndsAt: toIsoOrNull(displayWindow.endsAt),
        slotLabel: selected.slotLabel,
        media: preview
          ? {
              url: preview.url,
              mediaType,
              shape: "square",
            }
          : null,
      };

      // Resolve the banner config from per-post overrides + account defaults,
      // then attach the proximity label if one is due. This mirrors the
      // publish-time render so the public surface stays in sync with what
      // gets posted. The override (textOverride) is independent of the
      // proximity label — when only an override is set, the banner still
      // renders (BannerOverlay falls back to textOverride when label is
      // null). So we expose bannerConfig whenever banners are enabled, and
      // expose bannerLabel only when a proximity label is due.
      if (accountBannerDefaults) {
        const resolvedConfig = bannerConfigResolver(accountBannerDefaults, selected.bannerOverrides);
        if (resolvedConfig.enabled) {
          const campaignTiming = extractCampaignTiming({
            campaign_type: aggregate.campaignType,
            metadata: aggregate.campaignMetadata,
          });
          const label = getProximityLabel({
            referenceAt: DateTime.now().setZone(timezone),
            campaignTiming,
          });
          const overrideTrim = resolvedConfig.textOverride?.trim();
          const hasOverride = Boolean(overrideTrim && overrideTrim.length > 0);
          if (hasOverride || label) {
            card.bannerConfig = resolvedConfig;
            // bannerLabel mirrors what BannerOverlay would render when no
            // override is in play; BannerOverlay itself prioritises
            // textOverride over label, so we only need to populate the
            // proximity label when there is one.
            card.bannerLabel = label;
          }
        }
      }

      campaignCards.push(card);
    }

    campaignCards.sort((a, b) => {
      const aDeadline = DateTime.fromISO(a.endAt);
      const bDeadline = DateTime.fromISO(b.endAt);
      if (aDeadline.toMillis() !== bDeadline.toMillis()) {
        return aDeadline.toMillis() - bDeadline.toMillis();
      }
      const aScheduled = DateTime.fromISO(a.scheduledFor);
      const bScheduled = DateTime.fromISO(b.scheduledFor);
      return bScheduled.toMillis() - aScheduled.toMillis();
    });

    const tiles: PublicLinkInBioTile[] = (tileRows ?? []).map((tile) => {
      const preview = tile.media_asset_id ? assetMaps.previews.get(tile.media_asset_id) ?? null : null;
      return {
        id: tile.id,
        title: tile.title,
        subtitle: tile.subtitle,
        ctaLabel: tile.cta_label,
        ctaUrl: tile.cta_url ?? "",
        tileType: (tile.tile_type ?? "link") as PublicLinkInBioTile["tileType"],
        embedData: tile.embed_data ?? null,
        media: preview,
      } satisfies PublicLinkInBioTile;
    });

    // The events fetch started before the campaign queries, so this phase is
    // only the wait left after them.
    const [logoMedia, websiteEvents] = await track(timings, "logo+website-events", () => Promise.all([
      resolveLogoMedia(supabase, profile.logoUrl),
      websiteEventsPromise,
    ]));
    const heroMedia = profile.heroMediaId ? assetMaps.previews.get(profile.heroMediaId) ?? null : null;

    return {
      profile,
      tiles,
      campaigns: campaignCards,
      websiteEvents,
      logoMedia,
      heroMedia,
    } satisfies PublicLinkInBioPageData;
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return null;
    }
    throw error;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveLogoMedia(
  supabase: ServiceSupabaseClient,
  logoUrl: string | null,
): Promise<{ url: string } | null> {
  const value = logoUrl?.trim();
  if (!value) return null;

  if (isHttpUrl(value)) {
    return { url: value };
  }

  const path = normaliseStoragePath(value);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, 600);

  if (error || !data?.signedUrl) {
    console.error("[link-in-bio] failed to sign logo media", error);
    return null;
  }

  return { url: data.signedUrl };
}

async function fetchMediaAssets(assetIds: string[]) {
  const supabase = tryCreateServiceSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service credentials are not configured");
  }

  if (!assetIds.length) {
    return {
      previews: new Map<string, PublicMediaPreview>(),
      previewsByShape: new Map<string, PublicMediaPreviewByShape>(),
      mediaTypes: new Map<string, "image" | "video">(),
    };
  }

  const { data: rows, error } = await supabase
    .from("media_assets")
    .select("id, media_type, storage_path, derived_variants")
    .in("id", assetIds)
    .returns<MediaAssetRow[]>();

  if (error) {
    throw error;
  }

  const previewCandidatesByAsset = new Map<string, PreviewCandidate[]>();
  const mediaTypes = new Map<string, "image" | "video">();
  const paths = new Set<string>();

  for (const row of rows ?? []) {
    mediaTypes.set(row.id, row.media_type === "video" ? "video" : "image");
    const candidates = resolvePreviewCandidates({
      storagePath: row.storage_path,
      derivedVariants: row.derived_variants ?? {},
    });
    const originalPath = normaliseStoragePath(row.storage_path);
    const prioritised = [
      ...candidates.filter((candidate) => candidate.path === originalPath),
      ...candidates.filter((candidate) => candidate.path !== originalPath),
    ];
    previewCandidatesByAsset.set(row.id, prioritised);
    for (const candidate of candidates) {
      paths.add(candidate.path);
    }
  }

  const previews = new Map<string, PublicMediaPreview>();
  const previewsByShape = new Map<string, PublicMediaPreviewByShape>();

  if (paths.size) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(Array.from(paths), 600);

    if (signedError) {
      throw signedError;
    }

    const urlByPath = new Map<string, string>();
    for (const entry of signed ?? []) {
      if (entry?.path && !entry.error && entry.signedUrl) {
        urlByPath.set(entry.path, entry.signedUrl);
      }
    }

    for (const [assetId, candidates] of previewCandidatesByAsset.entries()) {
      const shapeMap = previewsByShape.get(assetId) ?? {};
      for (const candidate of candidates) {
        if (shapeMap[candidate.shape]) continue;
        const signedUrl = urlByPath.get(candidate.path);
        if (!signedUrl) continue;
        shapeMap[candidate.shape] = { url: signedUrl, shape: candidate.shape };
      }
      previewsByShape.set(assetId, shapeMap);

      const selected = candidates.find((candidate) => urlByPath.has(candidate.path));
      if (!selected) continue;
      const signedUrl = urlByPath.get(selected.path);
      if (!signedUrl) continue;
      previews.set(assetId, { url: signedUrl, shape: selected.shape });
    }
  }

  return { previews, previewsByShape, mediaTypes };
}
