"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { z } from "zod";

import {
  createEventCampaign,
  createInstantPost,
  createPromotionCampaign,
  createStorySeries,
  createWeeklyCampaign,
} from "@/lib/create/service";
import {
  eventCampaignFormSchema,
  eventCampaignSchema,
  instantPostFormSchema,
  instantPostSchema,
  promotionCampaignFormSchema,
  promotionCampaignSchema,
  storySeriesFormSchema,
  storySeriesSchema,
  weeklyCampaignFormSchema,
  weeklyCampaignSchema,
} from "@/lib/create/schema";
import { DEFAULT_POST_TIME, DEFAULT_TIMEZONE } from "@/lib/constants";
import { getPlannerContentDetail } from "@/lib/planner/data";
import { buildEventScheduleOffsets } from "@/lib/create/event-cadence";
import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";
import {
  getManagementEventDetail,
  listManagementEvents,
  listManagementMenuSpecials,
  ManagementApiError,
  type ManagementMenuSpecialItem,
} from "@/lib/management-app/client";
import { getManagementConnectionConfig } from "@/lib/management-app/data";
import {
  mapManagementEventToEventCampaignPrefill,
  mapManagementSpecialToPromotionPrefill,
} from "@/lib/management-app/mappers";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export async function handleInstantPostSubmission(rawValues: unknown) {
  const formValues = instantPostFormSchema.parse(rawValues);
  const storyScheduledFor =
    formValues.placement === "story"
      ? resolveStoryScheduledFor(formValues.scheduledFor ?? new Date(), DEFAULT_TIMEZONE)
      : null;

  const parsed = instantPostSchema.parse({
    ...formValues,
    publishMode: storyScheduledFor ? "schedule" : formValues.publishMode,
    scheduledFor:
      storyScheduledFor ??
      (formValues.publishMode === "schedule" && formValues.scheduledFor
        ? DateTime.fromISO(formValues.scheduledFor, { zone: DEFAULT_TIMEZONE }).toJSDate()
        : undefined),
  });

  const result = await createInstantPost(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleStorySeriesSubmission(rawValues: unknown) {
  const formValues = storySeriesFormSchema.parse(rawValues);

  const trimmedNotes = formValues.notes?.trim();
  const slotPayload = formValues.slots.map((slot, index) => {
    const scheduledFor = resolveStoryScheduledFor(slot.date, DEFAULT_TIMEZONE);
    if (!scheduledFor) {
      throw new Error(`Invalid schedule slot at position ${index + 1}`);
    }
    return {
      scheduledFor,
      media: slot.media,
    };
  });

  const parsed = storySeriesSchema.parse({
    title: formValues.title,
    eventDate: DateTime.fromISO(formValues.eventDate, { zone: DEFAULT_TIMEZONE }).toJSDate(),
    eventTime: formValues.eventTime,
    notes: trimmedNotes ? trimmedNotes : undefined,
    platforms: formValues.platforms,
    slots: slotPayload,
    bannerDefaults: formValues.bannerDefaults,
  });

  const result = await createStorySeries(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleEventCampaignSubmission(rawValues: unknown) {
  const formValues = eventCampaignFormSchema.parse(rawValues);
  const timezone = formValues.timezone && formValues.timezone.length ? formValues.timezone : DEFAULT_TIMEZONE;
  const defaultOffsets = buildEventScheduleOffsets({
    startDate: formValues.startDate,
    startTime: formValues.startTime,
    timezone,
  });

  const { useManualSchedule, manualSlots, timezone: _ignoredTimezone, bannerDefaults, ...rest } = formValues;
  void _ignoredTimezone;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, slot.time))
    .filter((slot): slot is Date => Boolean(slot));

  const parsed = eventCampaignSchema.parse({
    ...rest,
    startDate: DateTime.fromISO(formValues.startDate, { zone: timezone }).toJSDate(),
    scheduleOffsets: defaultOffsets,
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
    bannerDefaults,
  });

  const result = await createEventCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handlePromotionCampaignSubmission(rawValues: unknown) {
  const formValues = promotionCampaignFormSchema.parse(rawValues);

  const { useManualSchedule, manualSlots, bannerDefaults: promoBannerDefaults, ...rest } = formValues;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, DEFAULT_POST_TIME))
    .filter((slot): slot is Date => Boolean(slot));
  const campaignStart = DateTime.now().setZone(DEFAULT_TIMEZONE).startOf("day").toJSDate();

  const parsed = promotionCampaignSchema.parse({
    ...rest,
    startDate: campaignStart,
    endDate: DateTime.fromISO(formValues.endDate, { zone: DEFAULT_TIMEZONE }).toJSDate(),
    dateMode: "ends_on",
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
    bannerDefaults: promoBannerDefaults,
  });

  const result = await createPromotionCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleWeeklyCampaignSubmission(rawValues: unknown) {
  const formValues = weeklyCampaignFormSchema.parse(rawValues);

  const { useManualSchedule, manualSlots, bannerDefaults: weeklyBannerDefaults, ...rest } = formValues;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, slot.time))
    .filter((slot): slot is Date => Boolean(slot));

  const parsed = weeklyCampaignSchema.parse({
    ...rest,
    dayOfWeek: Number(formValues.dayOfWeek),
    startDate: DateTime.fromISO(formValues.startDate, { zone: DEFAULT_TIMEZONE }).toJSDate(),
    weeksAhead:
      useManualSchedule ? undefined : formValues.weeksAhead ? Number(formValues.weeksAhead) : undefined,
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
    bannerDefaults: weeklyBannerDefaults,
  });

  const result = await createWeeklyCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

const previewSchema = z.object({
  contentIds: z.array(z.string().uuid()).min(1),
});

export async function fetchGeneratedContentDetails(payload: unknown) {
  const { contentIds } = previewSchema.parse(payload);

  const details = await Promise.all(
    contentIds.map(async (contentId) => {
      const detail = await getPlannerContentDetail(contentId);
      return detail;
    }),
  );

  return details.filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
}

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

  try {
    const config = await getManagementConnectionConfig();
    const events = await listManagementEvents(config, {
      limit: parsed.limit ?? 50,
      query: parsed.query,
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
    const config = await getManagementConnectionConfig();
    let detail: Awaited<ReturnType<typeof getManagementEventDetail>>;
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

    const mapped = mapManagementEventToEventCampaignPrefill(detail);
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

function parseManualSlot(date: string, time: string) {
  if (!date) return null;
  const sanitizedTime = time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_POST_TIME;
  const candidate = DateTime.fromISO(`${date}T${sanitizedTime}`, { zone: DEFAULT_TIMEZONE }).startOf("minute");
  if (!candidate.isValid) {
    return null;
  }
  return candidate.toJSDate();
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
