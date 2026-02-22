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
  date?: string | null;
  time?: string | null;
  event_status?: string | null;
  bookingUrl?: string | null;
}

export interface ManagementEventDetail {
  id: string;
  name?: string | null;
  date?: string | null;
  time?: string | null;
  startDate?: string | null;
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
  performer_name?: string | null;
  performer_type?: string | null;
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

const DEFAULT_TIMEOUT_MS = 10_000;

export async function listManagementEvents(
  config: ManagementApiConfig,
  options?: { limit?: number; query?: string },
): Promise<ManagementEventListItem[]> {
  const limit = clampLimit(options?.limit ?? 100);
  const query = options?.query?.trim();
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(limit));
  if (query) {
    searchParams.set("search", query);
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

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.floor(value), 1), 100);
}

async function requestManagementData<T>(
  config: ManagementApiConfig,
  path: string,
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
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
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
    date,
    time,
    event_status: asOptionalString(row.event_status),
    bookingUrl: asOptionalString(row.bookingUrl),
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
    name: asOptionalString(row.name),
    date: asOptionalString(row.date),
    time: normalizeTime(asOptionalString(row.time)),
    startDate: asOptionalString(row.startDate),
    shortDescription: asOptionalString(row.shortDescription),
    longDescription: asOptionalString(row.longDescription),
    description: asOptionalString(row.description),
    brief: asOptionalString(row.brief),
    highlights: asOptionalStringArray(row.highlights),
    event_status: asOptionalString(row.event_status),
    bookingUrl: asOptionalString(row.bookingUrl),
    booking_url: asOptionalString(row.booking_url),
    facebookShortLink: asOptionalString(row.facebookShortLink),
    facebook_short_link: asOptionalString(row.facebook_short_link),
    linkInBioShortLink: asOptionalString(row.linkInBioShortLink),
    link_in_bio_short_link: asOptionalString(row.link_in_bio_short_link),
    performer_name: asOptionalString(row.performer_name),
    performer_type: asOptionalString(row.performer_type),
  } satisfies ManagementEventDetail;
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
