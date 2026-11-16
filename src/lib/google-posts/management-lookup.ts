/**
 * Looking an event up in the management app when its campaign does not hold
 * what Google needs (an end time, the Google link, whether it takes bookings).
 * Server only. Used when a Google version is CREATED, never when it is sent.
 *
 * Older event campaigns hold only eventStart, startDate, startTime and
 * brief.eventName, with no eventEnd, sourceEventKey or googleCtaUrl, so for
 * those the event is found in the management app: by id when the campaign
 * knows it, otherwise by an EXACT match of name (trimmed, case-insensitive),
 * date and start time among the listed events. No match, or more than one, is
 * "not matched"; so is any management failure (logged), which never stops the
 * Google version: it falls back to a STANDARD post.
 *
 * The management API allows 60 calls a minute and this runs from a cron that
 * fires every minute, so each lookup object has a hard cap on calls, spaces
 * them out, and caches results for the run. Once the cap is reached a lookup
 * answers "deferred" and the caller leaves that post for the next run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createLogger } from "@/lib/logging";
import type {
  ManagementApiConfig,
  ManagementEventDetail,
  ManagementEventListItem,
} from "@/lib/management-app/client";
import { mapManagementEventToEventCampaignPrefill } from "@/lib/management-app/mappers";
import { resolveEventEnd } from "@/lib/scheduling/event-end";

const logger = createLogger("google-posts");

/** Management calls one lookup object may make: well under the 60 a minute the API allows. */
export const MANAGEMENT_CALLS_PER_RUN = 10;
/** The gap between two management calls. */
export const MANAGEMENT_CALL_GAP_MS = 1_000;

export interface ManagementEventClient {
  list: (config: ManagementApiConfig, options: { query: string; fromDate: string; toDate: string; limit: number }) => Promise<ManagementEventListItem[]>;
  detail: (config: ManagementApiConfig, eventId: string) => Promise<ManagementEventDetail>;
}

export interface EventQuery {
  managementEventId: string | null;
  name: string | null;
  /** YYYY-MM-DD, London. */
  date: string | null;
  /** HH:MM, London. */
  time: string | null;
}

export interface MatchedEvent {
  managementEventId: string;
  /** ISO instants, or null when the management app holds no end time or duration. */
  start: string | null;
  end: string | null;
  googleCtaUrl: string | null;
  takesBookings: boolean;
}

export type EventLookupResult =
  | { status: "matched"; event: MatchedEvent }
  | { status: "not_matched"; reason: string }
  | { status: "deferred" };

export interface EventLookup {
  find: (query: EventQuery) => Promise<EventLookupResult>;
  /** Calls made so far, for the run summary. */
  calls: () => number;
}

/** A lookup that never calls anything: the brand has no management import, or no connection. */
export function noManagementLookup(reason: string): EventLookup {
  return { find: async () => ({ status: "not_matched", reason }), calls: () => 0 };
}

/** The brand's management connection, read with the service client, or null when it has none. */
export async function loadManagementConfig(db: SupabaseClient, accountId: string): Promise<ManagementApiConfig | null> {
  const { data: account, error: accountError } = await db
    .from("accounts")
    .select("id, management_import_enabled")
    .eq("id", accountId)
    .maybeSingle<{ id: string; management_import_enabled: boolean | null }>();
  if (accountError || !account || account.management_import_enabled !== true) return null;

  const { data: connection, error } = await db
    .from("management_app_connections")
    .select("base_url, api_key, enabled")
    .eq("account_id", accountId)
    .maybeSingle<{ base_url: string; api_key: string | null; enabled: boolean }>();
  if (error || !connection?.enabled || !connection.api_key?.trim()) return null;
  return { baseUrl: connection.base_url, apiKey: connection.api_key.trim() };
}

const normaliseName = (value: string | null | undefined): string => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function createEventLookup({
  config,
  client,
  sleep,
  maxCalls = MANAGEMENT_CALLS_PER_RUN,
  gapMs = MANAGEMENT_CALL_GAP_MS,
  accountId,
  canCall = () => true,
}: {
  config: ManagementApiConfig;
  client: ManagementEventClient;
  sleep: (ms: number) => Promise<void>;
  maxCalls?: number;
  gapMs?: number;
  accountId: string;
  /** False once the run has no time left for another call: the lookup is then deferred. */
  canCall?: () => boolean;
}): EventLookup {
  let made = 0;
  const cache = new Map<string, Promise<EventLookupResult>>();

  async function paced<T>(call: () => Promise<T>): Promise<T | "deferred"> {
    if (made >= maxCalls || !canCall()) return "deferred";
    if (made > 0 && gapMs > 0) await sleep(gapMs);
    made += 1;
    return call();
  }

  function fromDetail(detail: ManagementEventDetail): MatchedEvent {
    const prefill = mapManagementEventToEventCampaignPrefill(detail).fields;
    // The mapper sets an end only when the event has a real start, so an end means both are facts.
    const resolved = prefill.endTime
      ? resolveEventEnd({ startDate: prefill.startDate, startTime: prefill.startTime, endDate: prefill.endDate, endTime: prefill.endTime })
      : null;
    return {
      managementEventId: detail.id,
      start: resolved?.ok ? resolved.start : null,
      end: resolved?.ok ? resolved.end : null,
      googleCtaUrl: prefill.googleCtaUrl ?? null,
      takesBookings: prefill.takesBookings === true,
    };
  }

  async function run(query: EventQuery): Promise<EventLookupResult> {
    try {
      let eventId = query.managementEventId;
      if (!eventId) {
        if (!query.name || !query.date || !query.time) return { status: "not_matched", reason: "no name, date and time to match on" };
        const listed = await paced(() =>
          client.list(config, { query: query.name as string, fromDate: query.date as string, toDate: query.date as string, limit: 50 }),
        );
        if (listed === "deferred") return { status: "deferred" };
        const wanted = normaliseName(query.name);
        const matches = listed.filter(
          (event) => normaliseName(event.name) === wanted && event.date === query.date && (event.time ?? "").slice(0, 5) === query.time,
        );
        if (matches.length !== 1) {
          return { status: "not_matched", reason: matches.length ? "more than one event matched" : "no event matched" };
        }
        eventId = matches[0].id;
      }
      const detail = await paced(() => client.detail(config, eventId as string));
      if (detail === "deferred") return { status: "deferred" };
      return { status: "matched", event: fromDetail(detail) };
    } catch (error) {
      // Any management failure is "not matched": the version falls back to STANDARD.
      logger.warn("management event lookup failed; the Google version falls back to a standard post", {
        accountId,
        code: (error as { code?: unknown })?.code ?? null,
        status: (error as { status?: unknown })?.status ?? null,
      });
      return { status: "not_matched", reason: "the management app could not be read" };
    }
  }

  return {
    find: (query) => {
      const key = JSON.stringify(query);
      const cached = cache.get(key);
      if (cached) return cached;
      const pending = run(query).then((result) => {
        // A deferred lookup is tried again next run, not remembered.
        if (result.status === "deferred") cache.delete(key);
        return result;
      });
      cache.set(key, pending);
      return pending;
    },
    calls: () => made,
  };
}
