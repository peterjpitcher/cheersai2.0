export type ManagementApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class ManagementApiError extends Error {
  code: ManagementApiErrorCode;
  status?: number;

  constructor(code: ManagementApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ManagementApiError";
    this.code = code;
    this.status = status;
  }
}

interface ManagementApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: unknown;
  message?: unknown;
}

export interface ManagementApiConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ManagementEventListItem {
  id: string;
  name?: string | null;
  slug?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  date?: string | null;
  time?: string | null;
  startDate?: string | null;
  event_status?: string | null;
  bookingUrl?: string | null;
  booking_url?: string | null;
}

export interface ManagementEventDetail {
  id: string;
  slug?: string | null;
  name?: string | null;
  date?: string | null;
  time?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  event_type?: string | null;
  doors_time?: string | null;
  doorTime?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  description?: string | null;
  brief?: string | null;
  highlights?: string[] | null;
  event_status?: string | null;
  bookingUrl?: string | null;
  booking_url?: string | null;
  facebookShortLink?: string | null;
  facebook_short_link?: string | null;
  linkInBioShortLink?: string | null;
  link_in_bio_short_link?: string | null;
  googleBusinessProfileShortLink?: string | null;
  google_business_profile_short_link?: string | null;
  metaAdsShortLink?: string | null;
  meta_ads_short_link?: string | null;
  metaAdsDestinationUrl?: string | null;
  meta_ads_destination_url?: string | null;
  ctaLinks?: ManagementEventCtaLinks | null;
  cta_links?: ManagementEventCtaLinks | null;
  booking_mode?: string | null;
  payment_mode?: string | null;
  price?: number | null;
  price_per_seat?: number | null;
  capacity?: number | null;
  seats_remaining?: number | null;
  remainingAttendeeCapacity?: number | null;
  maximumAttendeeCapacity?: number | null;
  is_free?: boolean | null;
  is_full?: boolean | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  category?: {
    name?: string | null;
    slug?: string | null;
  } | null;
  performer_name?: string | null;
  performer_type?: string | null;
  image?: string[] | null;
  heroImageUrl?: string | null;
  thumbnailImageUrl?: string | null;
  posterImageUrl?: string | null;
  imageUrl?: string | null;
}

export interface ManagementEventCtaLinks {
  facebook?: string | null;
  instagram?: string | null;
  google_business_profile?: string | null;
  gbp?: string | null;
  meta_ads?: string | null;
}

export interface ManagementBookingConversion {
  bookingId: string;
  bookingType: string;
  eventId: string;
  eventSlug?: string | null;
  occurredAt: string;
}

interface SpecialsOffer {
  availableAtOrFrom?: string | null;
  availableThrough?: string | null;
}

export interface ManagementMenuSpecialItem {
  id: string;
  name?: string | null;
  description?: string | null;
  section?: string | null;
  offers?: SpecialsOffer;
}

interface EventsResponseData {
  events?: unknown[];
}

interface SpecialsResponseData {
  specials?: unknown[];
}

export interface ManagementMetaAdsLinkInput {
  destinationUrl: string;
  campaignName: string;
  metadata?: Record<string, unknown>;
}

export interface ManagementMetaAdsLink {
  shortUrl: string;
  shortCode: string;
  destinationUrl: string;
  utmDestinationUrl: string;
  alreadyExists: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const CANONICAL_SHORT_LINK_BASE_URL = "https://l.the-anchor.pub";

export async function listManagementEvents(
  config: ManagementApiConfig,
  options?: { limit?: number; query?: string; fromDate?: string; toDate?: string; status?: string },
): Promise<ManagementEventListItem[]> {
  const limit = clampLimit(options?.limit ?? 100);
  const query = options?.query?.trim();
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(limit));
  if (query) {
    searchParams.set("search", query);
  }
  if (options?.fromDate) {
    searchParams.set("from_date", options.fromDate);
  }
  if (options?.toDate) {
    searchParams.set("to_date", options.toDate);
  }
  if (options?.status) {
    searchParams.set("status", options.status);
  }
  const data = await requestManagementData<EventsResponseData>(config, `/api/events?${searchParams.toString()}`);
  const events = Array.isArray(data.events) ? data.events : [];
  return events
    .map(shapeEventListItem)
    .filter((event): event is ManagementEventListItem => Boolean(event));
}

export async function getManagementEventDetail(
  config: ManagementApiConfig,
  eventId: string,
  options?: {
    fallbackSlug?: string;
  },
): Promise<ManagementEventDetail> {
  const trimmedId = eventId.trim();
  if (!trimmedId) {
    throw new ManagementApiError("INVALID_RESPONSE", "Event id is required.");
  }

  const fallbackSlug = options?.fallbackSlug?.trim();
  const tryFetchDetail = (lookupId: string) =>
    requestManagementData<unknown>(config, `/api/events/${encodeURIComponent(lookupId)}`);

  let detail: unknown;

  try {
    detail = await tryFetchDetail(trimmedId);
  } catch (error) {
    const canFallback =
      error instanceof ManagementApiError &&
      error.status === 404 &&
      Boolean(fallbackSlug) &&
      fallbackSlug !== trimmedId;

    if (!canFallback) {
      throw error;
    }

    detail = await tryFetchDetail(fallbackSlug as string);
  }

  if (!detail || typeof detail !== "object") {
    throw new ManagementApiError("INVALID_RESPONSE", "Event detail response was invalid.");
  }

  return shapeEventDetail(detail);
}

export async function listManagementMenuSpecials(
  config: ManagementApiConfig,
): Promise<ManagementMenuSpecialItem[]> {
  const data = await requestManagementData<SpecialsResponseData>(config, "/api/menu/specials");
  const specials = Array.isArray(data.specials) ? data.specials : [];
  return specials
    .map(shapeMenuSpecial)
    .filter((special): special is ManagementMenuSpecialItem => Boolean(special));
}

export async function createManagementMetaAdsLink(
  config: ManagementApiConfig,
  input: ManagementMetaAdsLinkInput,
): Promise<ManagementMetaAdsLink> {
  const data = await requestManagementData<unknown>(config, "/api/marketing/meta-ads-link", {
    method: "POST",
    body: input,
  });

  if (!data || typeof data !== "object") {
    throw new ManagementApiError("INVALID_RESPONSE", "Meta Ads short link response was invalid.");
  }

  return shapeMetaAdsLink(data);
}

export async function listManagementEventBookingConversions(
  config: ManagementApiConfig,
  options: { eventIds: string[]; since?: string },
): Promise<ManagementBookingConversion[]> {
  const eventIds = options.eventIds.map((eventId) => eventId.trim()).filter(Boolean);
  if (eventIds.length === 0) return [];

  const searchParams = new URLSearchParams();
  searchParams.set("event_ids", eventIds.join(","));
  if (options.since) searchParams.set("since", options.since);

  const data = await requestManagementData<{ conversions?: unknown[] }>(
    config,
    `/api/marketing/event-booking-conversions?${searchParams.toString()}`,
  );
  const conversions = Array.isArray(data.conversions) ? data.conversions : [];
  return conversions
    .map(shapeBookingConversion)
    .filter((conversion): conversion is ManagementBookingConversion => Boolean(conversion));
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.floor(value), 1), 100);
}

async function requestManagementData<T>(
  config: ManagementApiConfig,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
  },
): Promise<T> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new ManagementApiError("UNAUTHORIZED", "Management API key is missing.");
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const method = options?.method ?? "GET";
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: method === "POST" ? JSON.stringify(options?.body ?? {}) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const upstreamMessage = await readUpstreamErrorMessage(response);
      throw mapHttpError(response.status, upstreamMessage);
    }

    const payload = (await response.json()) as ManagementApiEnvelope<T>;
    if (!payload || typeof payload !== "object") {
      throw new ManagementApiError("INVALID_RESPONSE", "Management API response was invalid.");
    }

    if (payload.success === false) {
      const upstreamMessage = extractEnvelopeErrorMessage(payload);
      throw new ManagementApiError(
        "HTTP_ERROR",
        upstreamMessage
          ? `Management API reported an error: ${upstreamMessage}`
          : "Management API reported an error.",
        response.status,
      );
    }

    if (typeof payload.data === "undefined") {
      throw new ManagementApiError("INVALID_RESPONSE", "Management API payload missing data.");
    }

    return payload.data;
  } catch (error) {
    if (error instanceof ManagementApiError) {
      throw error;
    }

    const abortError =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

    if (abortError) {
      throw new ManagementApiError("NETWORK", "Management API request timed out.");
    }

    throw new ManagementApiError("NETWORK", "Management API request failed.");
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status: number, upstreamMessage?: string | null): ManagementApiError {
  const messageSuffix = upstreamMessage ? `: ${upstreamMessage}` : "";
  if (status === 401) {
    return new ManagementApiError(
      "UNAUTHORIZED",
      `Management API rejected the credentials (401)${messageSuffix}.`,
      status,
    );
  }

  if (status === 403) {
    return new ManagementApiError(
      "FORBIDDEN",
      `Management API key is missing required permissions (403)${messageSuffix}.`,
      status,
    );
  }

  if (status === 429) {
    return new ManagementApiError(
      "RATE_LIMITED",
      `Management API rate limit exceeded (429)${messageSuffix}.`,
      status,
    );
  }

  return new ManagementApiError(
    "HTTP_ERROR",
    `Management API request failed (${status})${messageSuffix}.`,
    status,
  );
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ManagementApiError("INVALID_RESPONSE", "Management base URL must include http(s) protocol.");
  }
  return trimmed;
}

function shapeEventListItem(value: unknown): ManagementEventListItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  const startDateTime = asOptionalString(row.startDate);
  const date = asOptionalString(row.date) ?? deriveDateFromStartDate(startDateTime);
  const time = normalizeTime(asOptionalString(row.time)) ?? deriveTimeFromStartDate(startDateTime);

  return {
    id,
    name: asOptionalString(row.name),
    slug: asOptionalString(row.slug),
    categoryName: readCategoryName(row),
    categorySlug: readCategorySlug(row),
    date,
    time,
    startDate: startDateTime,
    event_status: asOptionalString(row.event_status),
    bookingUrl: asOptionalString(row.bookingUrl),
    booking_url: asOptionalString(row.booking_url),
  } satisfies ManagementEventListItem;
}

function shapeEventDetail(value: unknown): ManagementEventDetail {
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) {
    throw new ManagementApiError("INVALID_RESPONSE", "Management event detail is missing id.");
  }

  return {
    id,
    slug: asOptionalString(row.slug),
    name: asOptionalString(row.name),
    date: asOptionalString(row.date),
    time: normalizeTime(asOptionalString(row.time)),
    startDate: asOptionalString(row.startDate),
    endDate: asOptionalString(row.endDate),
    event_type: asOptionalString(row.event_type),
    doors_time: asOptionalString(row.doors_time),
    doorTime: asOptionalString(row.doorTime),
    shortDescription: asOptionalString(row.shortDescription),
    longDescription: asOptionalString(row.longDescription),
    description: asOptionalString(row.description),
    brief: asOptionalString(row.brief),
    highlights: asOptionalStringArray(row.highlights),
    event_status: asOptionalString(row.event_status),
    bookingUrl: asOptionalString(row.bookingUrl),
    booking_url: asOptionalString(row.booking_url),
    facebookShortLink: canonicaliseShortLinkUrl(asOptionalString(row.facebookShortLink)),
    facebook_short_link: canonicaliseShortLinkUrl(asOptionalString(row.facebook_short_link)),
    linkInBioShortLink: canonicaliseShortLinkUrl(asOptionalString(row.linkInBioShortLink)),
    link_in_bio_short_link: canonicaliseShortLinkUrl(asOptionalString(row.link_in_bio_short_link)),
    googleBusinessProfileShortLink: canonicaliseShortLinkUrl(asOptionalString(row.googleBusinessProfileShortLink)),
    google_business_profile_short_link: canonicaliseShortLinkUrl(asOptionalString(row.google_business_profile_short_link)),
    metaAdsShortLink: canonicaliseShortLinkUrl(asOptionalString(row.metaAdsShortLink)),
    meta_ads_short_link: canonicaliseShortLinkUrl(asOptionalString(row.meta_ads_short_link)),
    metaAdsDestinationUrl: asOptionalString(row.metaAdsDestinationUrl),
    meta_ads_destination_url: asOptionalString(row.meta_ads_destination_url),
    ctaLinks: readCtaLinks(row.ctaLinks),
    cta_links: readCtaLinks(row.cta_links),
    booking_mode: asOptionalString(row.booking_mode),
    payment_mode: asOptionalString(row.payment_mode),
    price: asOptionalNumber(row.price),
    price_per_seat: asOptionalNumber(row.price_per_seat),
    capacity: asOptionalNumber(row.capacity),
    seats_remaining: asOptionalNumber(row.seats_remaining),
    remainingAttendeeCapacity: asOptionalNumber(row.remainingAttendeeCapacity),
    maximumAttendeeCapacity: asOptionalNumber(row.maximumAttendeeCapacity),
    is_free: typeof row.is_free === "boolean" ? row.is_free : null,
    is_full: typeof row.is_full === "boolean" ? row.is_full : null,
    categoryName: readCategoryName(row),
    categorySlug: readCategorySlug(row),
    category: readCategory(row),
    performer_name: asOptionalString(row.performer_name),
    performer_type: asOptionalString(row.performer_type),
    image: asOptionalStringArray(row.image),
    heroImageUrl: asOptionalString(row.heroImageUrl),
    thumbnailImageUrl: asOptionalString(row.thumbnailImageUrl),
    posterImageUrl: asOptionalString(row.posterImageUrl),
    imageUrl: asOptionalString(row.imageUrl),
  } satisfies ManagementEventDetail;
}

function readCtaLinks(value: unknown): ManagementEventCtaLinks | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const links: ManagementEventCtaLinks = {};

  const facebook = asOptionalString(row.facebook);
  const instagram = asOptionalString(row.instagram);
  const googleBusinessProfile =
    asOptionalString(row.google_business_profile) ?? asOptionalString(row.gbp);
  const metaAds = asOptionalString(row.meta_ads);

  if (facebook) links.facebook = canonicaliseShortLinkUrl(facebook);
  if (instagram) links.instagram = canonicaliseShortLinkUrl(instagram);
  if (googleBusinessProfile) {
    const canonical = canonicaliseShortLinkUrl(googleBusinessProfile);
    links.google_business_profile = canonical;
    links.gbp = canonical;
  }
  if (metaAds) links.meta_ads = canonicaliseShortLinkUrl(metaAds);

  return Object.keys(links).length ? links : null;
}

function shapeBookingConversion(value: unknown): ManagementBookingConversion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const bookingId = asOptionalString(row.booking_id) ?? asOptionalString(row.bookingId);
  const eventId = asOptionalString(row.event_id) ?? asOptionalString(row.eventId);
  const occurredAt = asOptionalString(row.occurred_at) ?? asOptionalString(row.occurredAt);
  if (!bookingId || !eventId || !occurredAt) return null;

  return {
    bookingId,
    bookingType: asOptionalString(row.booking_type) ?? asOptionalString(row.bookingType) ?? "event",
    eventId,
    eventSlug: asOptionalString(row.event_slug) ?? asOptionalString(row.eventSlug) ?? null,
    occurredAt,
  } satisfies ManagementBookingConversion;
}

function readCategory(row: Record<string, unknown>): ManagementEventDetail['category'] {
  if (row.category && typeof row.category === "object") {
    const category = row.category as Record<string, unknown>;
    const name = asOptionalString(category.name);
    const slug = asOptionalString(category.slug);
    if (name || slug) return { name, slug };
  }
  const name = readCategoryName(row);
  const slug = readCategorySlug(row);
  return name || slug ? { name, slug } : null;
}

function readCategoryName(row: Record<string, unknown>): string | null {
  if (row.category && typeof row.category === "object") {
    const category = row.category as Record<string, unknown>;
    const name = asOptionalString(category.name);
    if (name) return name;
  }

  return asOptionalString(row.categoryName)
    ?? asOptionalString(row.category_name)
    ?? asOptionalString(row.eventCategoryName)
    ?? asOptionalString(row.event_category_name)
    ?? null;
}

function readCategorySlug(row: Record<string, unknown>): string | null {
  if (row.category && typeof row.category === "object") {
    const category = row.category as Record<string, unknown>;
    const slug = asOptionalString(category.slug);
    if (slug) return slug;
  }

  return asOptionalString(row.categorySlug)
    ?? asOptionalString(row.category_slug)
    ?? asOptionalString(row.eventCategorySlug)
    ?? asOptionalString(row.event_category_slug)
    ?? null;
}

function shapeMetaAdsLink(value: unknown): ManagementMetaAdsLink {
  const row = value as Record<string, unknown>;
  const shortUrl = asOptionalString(row.shortUrl) ?? asOptionalString(row.short_url);
  const shortCode = asOptionalString(row.shortCode) ?? asOptionalString(row.short_code);
  const destinationUrl = asOptionalString(row.destinationUrl) ?? asOptionalString(row.destination_url);
  const utmDestinationUrl =
    asOptionalString(row.utmDestinationUrl) ?? asOptionalString(row.utm_destination_url);

  if (!shortUrl || !shortCode || !destinationUrl || !utmDestinationUrl) {
    throw new ManagementApiError("INVALID_RESPONSE", "Meta Ads short link response was missing required fields.");
  }

  return {
    shortUrl: canonicaliseShortLinkUrl(shortUrl) ?? shortUrl,
    shortCode,
    destinationUrl,
    utmDestinationUrl,
    alreadyExists: Boolean(row.alreadyExists ?? row.already_exists),
  } satisfies ManagementMetaAdsLink;
}

function canonicaliseShortLinkUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "vip-club.uk" || hostname === "www.vip-club.uk") {
      return `${CANONICAL_SHORT_LINK_BASE_URL}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return value;
  }

  return value;
}

function shapeMenuSpecial(value: unknown): ManagementMenuSpecialItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;

  const offersValue = row.offers;
  let offers: SpecialsOffer | undefined;
  if (offersValue && typeof offersValue === "object") {
    const offerRow = offersValue as Record<string, unknown>;
    offers = {
      availableAtOrFrom: asOptionalString(offerRow.availableAtOrFrom),
      availableThrough: asOptionalString(offerRow.availableThrough),
    } satisfies SpecialsOffer;
  }

  return {
    id,
    name: asOptionalString(row.name),
    description: asOptionalString(row.description),
    section: asOptionalString(row.section),
    offers,
  } satisfies ManagementMenuSpecialItem;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  const trimmed = asString(value);
  return trimmed.length ? trimmed : undefined;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((entry) => asString(entry))
    .filter(Boolean);
  return list.length ? list : undefined;
}

function normalizeTime(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return value;
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function deriveDateFromStartDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function deriveTimeFromStartDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/T(\d{2}:\d{2})(?::\d{2})?/);
  if (!match) return undefined;
  return normalizeTime(match[1]);
}

function extractEnvelopeErrorMessage(payload: ManagementApiEnvelope<unknown>): string | null {
  const errorValue = payload.error;
  if (typeof errorValue === "string") {
    const trimmed = errorValue.trim();
    if (trimmed) return trimmed;
  }

  if (errorValue && typeof errorValue === "object") {
    const errorRow = errorValue as Record<string, unknown>;
    const message = asString(errorRow.message);
    if (message) return message;
  }

  const payloadMessage = asString(payload.message);
  return payloadMessage || null;
}

async function readUpstreamErrorMessage(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as ManagementApiEnvelope<unknown>;
      return extractEnvelopeErrorMessage(payload);
    }
  } catch {
    return null;
  }

  try {
    const text = (await response.text()).trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}
