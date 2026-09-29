"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  getManagementEventDetail,
  listManagementEvents,
  listManagementMenuSpecials,
  ManagementApiError,
  type ManagementMenuSpecialItem,
} from "@/lib/management-app/client";
import { getManagementConnectionConfig } from "@/lib/management-app/data";
import {
  buildEventListCacheKey,
  getCachedEventList,
} from "@/lib/management-app/event-list-cache";
import { requireAuthContext } from "@/lib/auth/server";
import {
  mapManagementEventToEventCampaignPrefill,
  mapManagementSpecialToPromotionPrefill,
} from "@/lib/management-app/mappers";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { isSchemaMissingError } from "@/lib/supabase/errors";

const logger = createLogger("management-import");

export interface ManagementActionError {
  code:
    | "NOT_CONFIGURED"
    | "DISABLED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "NETWORK"
    | "INVALID_RESPONSE"
    | "FAILED";
  message: string;
}

interface ManagementActionSuccess<T> {
  ok: true;
  data: T;
}

interface ManagementActionFailure {
  ok: false;
  error: ManagementActionError;
}

type ManagementActionResult<T> = ManagementActionSuccess<T> | ManagementActionFailure;

interface ManagementEventOption {
  id: string;
  name: string;
  slug?: string;
  date?: string;
  time?: string;
  status?: string;
  bookingUrl?: string;
}

interface ManagementPromotionOption {
  id: string;
  name: string;
  section?: string;
  startsOn?: string;
  endsOn?: string;
}

const eventPrefillSchema = z.object({
  eventId: z.string().min(1, "Event id required"),
  eventSlug: z
    .union([z.string().trim(), z.literal("")])
    .transform((value) => (value ? value : undefined))
    .optional(),
});

const listManagementEventOptionsSchema = z
  .object({
    query: z
      .union([z.string().trim(), z.literal("")])
      .transform((value) => (value ? value : undefined))
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .default({});

const promotionPrefillSchema = z.object({
  specialId: z.string().min(1, "Special id required"),
});

export async function listManagementEventOptions(payload?: unknown): Promise<ManagementActionResult<ManagementEventOption[]>> {
  const parsed = listManagementEventOptionsSchema.parse(payload ?? {});
  const limit = parsed.limit ?? 50;

  try {
    const t0 = performance.now();
    const config = await getManagementConnectionConfig();
    const configMs = performance.now() - t0;

    const { accountId } = await requireAuthContext();
    const cacheKey = buildEventListCacheKey({
      accountId,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      limit,
      query: parsed.query,
    });

    const t1 = performance.now();
    const events = await getCachedEventList(cacheKey, () =>
      listManagementEvents(config, { limit, query: parsed.query }),
    );
    const listMs = performance.now() - t1;

    console.info("[management-import] list-events", {
      configMs: Math.round(configMs),
      listMs: Math.round(listMs),
      elapsedMs: Math.round(performance.now() - t0),
      queryPresent: Boolean(parsed.query),
      limit,
    });

    const options = events.map((event) => ({
      id: event.id,
      name: event.name?.trim() || "Untitled event",
      slug: event.slug ?? undefined,
      date: event.date ?? undefined,
      time: event.time ?? undefined,
      status: event.event_status ?? undefined,
      bookingUrl: event.bookingUrl ?? undefined,
    }));

    options.sort((left, right) => {
      const leftKey = `${left.date ?? ""} ${left.time ?? ""}`.trim();
      const rightKey = `${right.date ?? ""} ${right.time ?? ""}`.trim();
      return leftKey.localeCompare(rightKey);
    });

    return {
      ok: true,
      data: options,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.warn("[management-import] list-events failed", {
      errorType: error instanceof Error ? error.constructor.name : "unknown",
    });
    return {
      ok: false,
      error: mapManagementActionError(error),
    };
  }
}

export async function getManagementEventPrefill(
  payload: unknown,
): Promise<ManagementActionResult<ReturnType<typeof mapManagementEventToEventCampaignPrefill>>> {
  const { eventId, eventSlug } = eventPrefillSchema.parse(payload);

  try {
    const t0 = performance.now();
    const config = await getManagementConnectionConfig();
    const configMs = performance.now() - t0;

    let detail: Awaited<ReturnType<typeof getManagementEventDetail>>;
    const t1 = performance.now();
    try {
      detail = await getManagementEventDetail(config, eventId, {
        fallbackSlug: eventSlug,
      });
    } catch (error) {
      // The management API's own text (and the operator's fix: deploy its
      // latest updates) goes to the log; the owner gets plain words.
      const isMissingDetail = error instanceof ManagementApiError && error.status === 404;
      if (isMissingDetail) {
        logger.warn("event detail returned 404: the management API may need its latest updates deployed", {
          eventIdPresent: Boolean(eventId),
          detail: error.message,
        });
        return {
          ok: false,
          error: {
            code: "FAILED",
            message: "We could not load this event's details from your management app. Reload the events and try again.",
          },
        };
      }

      const isServerDetailFailure =
        error instanceof ManagementApiError && typeof error.status === "number" && error.status >= 500;
      if (isServerDetailFailure) {
        logger.error("event detail failed on the management API", error, { status: error.status });
        return {
          ok: false,
          error: {
            code: "FAILED",
            message: "Your management app could not send this event's details. Please try again in a few minutes.",
          },
        };
      }

      throw error;
    }
    const detailMs = performance.now() - t1;

    console.info("[management-import] get-event-detail", {
      configMs: Math.round(configMs),
      detailMs: Math.round(detailMs),
      elapsedMs: Math.round(performance.now() - t0),
      eventIdPresent: Boolean(eventId),
    });

    const mapped = mapManagementEventToEventCampaignPrefill(detail);
    return {
      ok: true,
      data: mapped,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.warn("[management-import] get-event-detail failed", {
      errorType: error instanceof Error ? error.constructor.name : "unknown",
      eventIdPresent: Boolean(eventId),
    });
    return {
      ok: false,
      error: mapManagementActionError(error),
    };
  }
}

export async function listManagementPromotionOptions(): Promise<
  ManagementActionResult<ManagementPromotionOption[]>
> {
  try {
    const config = await getManagementConnectionConfig();
    const specials = await listManagementMenuSpecials(config);

    const options = specials.map((special) => ({
      id: special.id,
      name: special.name?.trim() || "Untitled special",
      section: special.section ?? undefined,
      startsOn: special.offers?.availableAtOrFrom ?? undefined,
      endsOn: special.offers?.availableThrough ?? undefined,
    }));

    options.sort((left, right) => left.name.localeCompare(right.name));

    return {
      ok: true,
      data: options,
    };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      error: mapManagementActionError(error),
    };
  }
}

export async function getManagementPromotionPrefill(
  payload: unknown,
): Promise<ManagementActionResult<ReturnType<typeof mapManagementSpecialToPromotionPrefill>>> {
  const { specialId } = promotionPrefillSchema.parse(payload);

  try {
    const config = await getManagementConnectionConfig();
    const specials = await listManagementMenuSpecials(config);
    const selected = findSpecialById(specials, specialId);
    if (!selected) {
      return {
        ok: false,
        error: {
          code: "FAILED",
          message: "Selected management special could not be found.",
        },
      };
    }

    const mapped = mapManagementSpecialToPromotionPrefill(selected);
    return {
      ok: true,
      data: mapped,
    };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      error: mapManagementActionError(error),
    };
  }
}

function findSpecialById(items: ManagementMenuSpecialItem[], specialId: string) {
  return items.find((item) => item.id === specialId) ?? null;
}

/**
 * Plain words for a failed import (tasks/SPEC-plain-error-messages.md). The
 * codes are unchanged; the management API's or the database's own text goes
 * to the log, never to the page.
 */
const IMPORT_MESSAGES = {
  notSetUp: "Event import is not set up for this brand yet. Please contact Cheers support.",
  notConfigured: "Event import is not set up yet. Add your management app details in Settings.",
  disabled: "Event import is switched off. Turn it on under Management app connection in Settings.",
  notFound: "We could not find that event in your management app. Reload the events and try again.",
  unauthorised: "Your management app did not accept the saved API key. Check it under Management app connection in Settings.",
  forbidden: "The saved API key is not allowed to read events or menus. Update its permissions in your management app, then try again.",
  rateLimited: "Your management app is busy. Please try again in a minute.",
  unreachable: "We could not reach your management app. Check the Base URL under Management app connection in Settings, then try again.",
  unreadable: "Your management app sent something we could not read. Please try again, and contact Cheers support if it keeps happening.",
  failed: "We could not import from your management app. Please try again.",
} as const;

function mapManagementActionError(error: unknown): ManagementActionError {
  const result = describeManagementActionError(error);
  logger.warn("import failed", {
    code: result.code,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    detail: error instanceof Error ? error.message : toLoggableError(error).message,
  });
  return result;
}

function describeManagementActionError(error: unknown): ManagementActionError {
  if (isSchemaMissingError(error)) {
    return { code: "NOT_CONFIGURED", message: IMPORT_MESSAGES.notSetUp };
  }

  if (error instanceof ManagementApiError) {
    if (error.status === 404) {
      return { code: "FAILED", message: IMPORT_MESSAGES.notFound };
    }

    if (error.code === "UNAUTHORIZED") {
      return { code: "UNAUTHORIZED", message: IMPORT_MESSAGES.unauthorised };
    }

    if (error.code === "FORBIDDEN") {
      return { code: "FORBIDDEN", message: IMPORT_MESSAGES.forbidden };
    }

    if (error.code === "RATE_LIMITED") {
      return { code: "RATE_LIMITED", message: IMPORT_MESSAGES.rateLimited };
    }

    if (error.code === "NETWORK") {
      return { code: "NETWORK", message: IMPORT_MESSAGES.unreachable };
    }

    if (error.code === "INVALID_RESPONSE") {
      return { code: "INVALID_RESPONSE", message: IMPORT_MESSAGES.unreadable };
    }

    return { code: "FAILED", message: IMPORT_MESSAGES.failed };
  }

  if (error instanceof Error) {
    if (/schema is missing|latest supabase migrations|database schema is missing/i.test(error.message)) {
      return { code: "NOT_CONFIGURED", message: IMPORT_MESSAGES.notSetUp };
    }

    if (/not configured/i.test(error.message)) {
      return { code: "NOT_CONFIGURED", message: IMPORT_MESSAGES.notConfigured };
    }

    if (/disabled/i.test(error.message)) {
      return { code: "DISABLED", message: IMPORT_MESSAGES.disabled };
    }
  }

  return { code: "FAILED", message: IMPORT_MESSAGES.failed };
}
