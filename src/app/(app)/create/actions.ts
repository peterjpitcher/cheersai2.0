"use server";

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
import { isSchemaMissingError } from "@/lib/supabase/errors";


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
      const isMissingDetail = error instanceof ManagementApiError && error.status === 404;
      if (isMissingDetail) {
        return {
          ok: false,
          error: {
            code: "FAILED",
            message:
              "Detailed event import data is unavailable (management API returned 404 for this event). Deploy the latest management API updates, then reload events and try again.",
          },
        };
      }

      const isServerDetailFailure =
        error instanceof ManagementApiError && typeof error.status === "number" && error.status >= 500;
      if (isServerDetailFailure) {
        return {
          ok: false,
          error: {
            code: "FAILED",
            message:
              "Detailed event import data is unavailable because the management API failed. Deploy the latest management API updates, then reload events and try again.",
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
    return {
      ok: false,
      error: mapManagementActionError(error),
    };
  }
}

function findSpecialById(items: ManagementMenuSpecialItem[], specialId: string) {
  return items.find((item) => item.id === specialId) ?? null;
}

function mapManagementActionError(error: unknown): ManagementActionError {
  if (isSchemaMissingError(error)) {
    return {
      code: "NOT_CONFIGURED",
      message: "Management connection schema is missing. Run the latest Supabase migrations, then configure it in Settings.",
    };
  }

  if (error instanceof ManagementApiError) {
    if (error.status === 404) {
      return {
        code: "FAILED",
        message: "Selected event was not found in the management app. Reload events and try again.",
      };
    }

    if (error.code === "UNAUTHORIZED") {
      return {
        code: "UNAUTHORIZED",
        message: "Management API rejected the credentials. Check the stored API key.",
      };
    }

    if (error.code === "FORBIDDEN") {
      return {
        code: "FORBIDDEN",
        message: "Management API key is missing read:events/read:menu permissions.",
      };
    }

    if (error.code === "RATE_LIMITED") {
      return {
        code: "RATE_LIMITED",
        message: "Management API rate limit exceeded. Try again in a moment.",
      };
    }

    if (error.code === "NETWORK") {
      return {
        code: "NETWORK",
        message: "Management API is unreachable. Verify base URL and network access.",
      };
    }

    if (error.code === "INVALID_RESPONSE") {
      return {
        code: "INVALID_RESPONSE",
        message: "Management API returned an unexpected response format.",
      };
    }

    return {
      code: "FAILED",
      message: error.message,
    };
  }

  if (error instanceof Error) {
    if (/schema is missing|latest supabase migrations|database schema is missing/i.test(error.message)) {
      return {
        code: "NOT_CONFIGURED",
        message: "Management connection schema is missing. Run the latest Supabase migrations, then configure it in Settings.",
      };
    }

    if (/not configured/i.test(error.message)) {
      return {
        code: "NOT_CONFIGURED",
        message: "Management connection is not configured. Add credentials in Settings.",
      };
    }

    if (/disabled/i.test(error.message)) {
      return {
        code: "DISABLED",
        message: "Management connection is disabled. Enable it in Settings.",
      };
    }

    return {
      code: "FAILED",
      message: error.message,
    };
  }

  return {
    code: "FAILED",
    message: "Management import failed.",
  };
}
