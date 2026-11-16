/**
 * Google's local posts API, v4 (tasks/SPEC-gbp-posting-reintroduction.md,
 * sections 7 and 8). Server only.
 *
 * Shapes taken from Google's reference pages, read on 16 November 2026:
 * - accounts.locations.localPosts (LocalPost: languageCode, summary,
 *   callToAction {actionType, url}, event {title, schedule}, media[], topicType,
 *   and the output-only name, createTime, updateTime, state, searchUrl)
 * - localPosts.create: POST https://mybusiness.googleapis.com/v4/{parent=accounts/x/locations/y}/localPosts,
 *   body and answer a LocalPost
 * - localPosts.get: GET .../v4/{name}; localPosts.list: GET .../localPosts with
 *   pageSize (at most 100) and pageToken, answering {localPosts, nextPageToken}
 * - TimeInterval {startDate, startTime, endDate, endTime} ("must contain all
 *   fields"), Date {year, month, day}, TimeOfDay {hours, minutes, seconds, nanos}
 * - MediaItem: "sourceUrl is the only supported data field for a LocalPost
 *   MediaItem", with mediaFormat PHOTO
 * - LocalPostState: PROCESSING, LIVE, REJECTED (and LOCAL_POST_STATE_UNSPECIFIED)
 *
 * Event times: Google takes a wall-clock date and time with no zone, so the
 * stored instants are turned into Europe/London wall time with Luxon. That is
 * correct across both clock changes: 25 October 2026 (BST to GMT) and
 * 28 March 2027 (GMT to BST); an overnight event simply ends on the next date.
 *
 * Nothing here logs. Google's error text can echo the signed image URL, so it
 * is only ever kept after sanitiseGoogleMessage(), never logged.
 */

import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { GoogleCtaType, GoogleTopicType } from "@/lib/google-posts/model";

export const GOOGLE_POSTS_API_BASE = "https://mybusiness.googleapis.com/v4";
export const GOOGLE_POST_LANGUAGE = "en-GB";

/** How long a create may take before the answer is treated as lost. */
export const GOOGLE_CREATE_TIMEOUT_MS = 15_000;
/** How long a read (get or list) may take. */
export const GOOGLE_READ_TIMEOUT_MS = 10_000;

export interface GoogleDate {
  year: number;
  month: number;
  day: number;
}

export interface GoogleTimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
  nanos: number;
}

export interface GoogleLocalPostBody {
  languageCode: string;
  summary: string;
  topicType: GoogleTopicType;
  callToAction?: { actionType: GoogleCtaType; url: string };
  event?: {
    title: string;
    schedule: { startDate: GoogleDate; startTime: GoogleTimeOfDay; endDate: GoogleDate; endTime: GoogleTimeOfDay };
  };
  media?: Array<{ mediaFormat: "PHOTO"; sourceUrl: string }>;
}

/** The fields of a stored version the request is built from. */
export interface GoogleVersionForRequest {
  topic_type: GoogleTopicType;
  summary: string;
  cta_type: GoogleCtaType | null;
  cta_url: string | null;
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
}

/** London wall-clock parts of a stored instant. */
export function londonParts(instant: string): { date: GoogleDate; time: GoogleTimeOfDay } {
  const local = DateTime.fromISO(instant, { setZone: false }).setZone(DEFAULT_TIMEZONE);
  if (!local.isValid) throw new Error("event time is not a valid instant");
  return {
    date: { year: local.year, month: local.month, day: local.day },
    time: { hours: local.hour, minutes: local.minute, seconds: 0, nanos: 0 },
  };
}

/**
 * The create request body. The button goes only with an https link; the event
 * block only for an EVENT; the photo only when one could be signed.
 */
export function buildLocalPostBody(version: GoogleVersionForRequest, imageUrl: string | null): GoogleLocalPostBody {
  const body: GoogleLocalPostBody = {
    languageCode: GOOGLE_POST_LANGUAGE,
    summary: version.summary,
    topicType: version.topic_type,
  };

  if (version.cta_type && version.cta_url && /^https:\/\//i.test(version.cta_url)) {
    body.callToAction = { actionType: version.cta_type, url: version.cta_url };
  }

  if (version.topic_type === "EVENT") {
    if (!version.event_title || !version.event_start || !version.event_end) {
      throw new Error("an EVENT version needs a title, a start and an end");
    }
    const start = londonParts(version.event_start);
    const end = londonParts(version.event_end);
    body.event = {
      title: version.event_title,
      schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time },
    };
  }

  if (imageUrl) {
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
  }

  return body;
}

/** A LocalPost as Google returns it (only the fields read here). */
export interface GoogleLocalPost {
  name?: string;
  summary?: string;
  topicType?: string;
  state?: string;
  searchUrl?: string;
  createTime?: string;
  event?: {
    title?: string;
    schedule?: { startDate?: Partial<GoogleDate>; startTime?: Partial<GoogleTimeOfDay> };
  };
}

export type GoogleCallResult<T> =
  | { ok: true; status: number; data: T }
  /** Google answered with an error status. `message` is already sanitised. */
  | { ok: false; kind: "http"; status: number; googleStatus: string | null; message: string | null }
  /** No answer: a timeout, or the connection dropped after the request was sent. */
  | { ok: false; kind: "no_answer" }
  /** The request never left (the name did not resolve or the connection was refused). */
  | { ok: false; kind: "not_sent" };

const NOT_SENT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ERR_INVALID_URL"]);

/** Google's own error text made safe to store: no links (the signed image URL), no runs of space, 300 characters at most. */
export function sanitiseGoogleMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).length > 300 ? `${Array.from(cleaned).slice(0, 299).join("")}…` : cleaned;
}

async function readGoogleError(response: Response): Promise<{ googleStatus: string | null; message: string | null }> {
  try {
    const payload = (await response.json()) as { error?: { status?: unknown; message?: unknown } };
    return {
      googleStatus: typeof payload?.error?.status === "string" ? payload.error.status : null,
      message: sanitiseGoogleMessage(payload?.error?.message),
    };
  } catch {
    return { googleStatus: null, message: null };
  }
}

function errorCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (cause && typeof cause.code === "string") return cause.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export async function callGoogle<T>(
  fetchImpl: typeof fetch,
  {
    method,
    url,
    accessToken,
    body,
    timeoutMs,
  }: { method: "GET" | "POST"; url: string; accessToken: string; body?: unknown; timeoutMs: number },
): Promise<GoogleCallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const { googleStatus, message } = await readGoogleError(response);
      return { ok: false, kind: "http", status: response.status, googleStatus, message };
    }
    let data: T;
    try {
      data = (await response.json()) as T;
    } catch {
      // Google answered 2xx with something unreadable: the post may exist.
      return { ok: false, kind: "no_answer" };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    const code = errorCode(error);
    if (code && NOT_SENT_CODES.has(code)) return { ok: false, kind: "not_sent" };
    return { ok: false, kind: "no_answer" };
  } finally {
    clearTimeout(timer);
  }
}

export function createLocalPost(
  fetchImpl: typeof fetch,
  accessToken: string,
  localPostParent: string,
  body: GoogleLocalPostBody,
): Promise<GoogleCallResult<GoogleLocalPost>> {
  return callGoogle<GoogleLocalPost>(fetchImpl, {
    method: "POST",
    url: `${GOOGLE_POSTS_API_BASE}/${localPostParent}/localPosts`,
    accessToken,
    body,
    timeoutMs: GOOGLE_CREATE_TIMEOUT_MS,
  });
}

export function getLocalPost(
  fetchImpl: typeof fetch,
  accessToken: string,
  name: string,
): Promise<GoogleCallResult<GoogleLocalPost>> {
  return callGoogle<GoogleLocalPost>(fetchImpl, {
    method: "GET",
    url: `${GOOGLE_POSTS_API_BASE}/${name}`,
    accessToken,
    timeoutMs: GOOGLE_READ_TIMEOUT_MS,
  });
}

export function listLocalPosts(
  fetchImpl: typeof fetch,
  accessToken: string,
  localPostParent: string,
  pageToken?: string,
): Promise<GoogleCallResult<{ localPosts?: GoogleLocalPost[]; nextPageToken?: string }>> {
  const params = new URLSearchParams({ pageSize: "100" });
  if (pageToken) params.set("pageToken", pageToken);
  return callGoogle(fetchImpl, {
    method: "GET",
    url: `${GOOGLE_POSTS_API_BASE}/${localPostParent}/localPosts?${params.toString()}`,
    accessToken,
    timeoutMs: GOOGLE_READ_TIMEOUT_MS,
  });
}
