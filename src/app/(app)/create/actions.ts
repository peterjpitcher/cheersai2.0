"use server";

import { revalidatePath } from "next/cache";

import {
  createEventCampaign,
  createInstantPost,
  createPromotionCampaign,
  createWeeklyCampaign,
} from "@/lib/create/service";
import {
  eventCampaignFormSchema,
  eventCampaignSchema,
  instantPostFormSchema,
  instantPostSchema,
  promotionCampaignFormSchema,
  promotionCampaignSchema,
  weeklyCampaignFormSchema,
  weeklyCampaignSchema,
} from "@/lib/create/schema";

export async function handleInstantPostSubmission(rawValues: unknown) {
  const formValues = instantPostFormSchema.parse(rawValues);

  const parsed = instantPostSchema.parse({
    ...formValues,
    scheduledFor:
      formValues.publishMode === "schedule" && formValues.scheduledFor
        ? new Date(formValues.scheduledFor)
        : undefined,
  });

  const result = await createInstantPost(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleEventCampaignSubmission(rawValues: unknown) {
  const formValues = eventCampaignFormSchema.parse(rawValues);

  const defaultOffsets = [
    { label: "Save the date", offsetHours: -168 },
    { label: "Reminder", offsetHours: -72 },
    { label: "Day-of hype", offsetHours: 0 },
  ];

  const { useManualSchedule, manualSlots, ...rest } = formValues;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, slot.time))
    .filter((slot): slot is Date => Boolean(slot));

  const parsed = eventCampaignSchema.parse({
    ...rest,
    startDate: new Date(formValues.startDate),
    scheduleOffsets: defaultOffsets,
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
  });

  const result = await createEventCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handlePromotionCampaignSubmission(rawValues: unknown) {
  const formValues = promotionCampaignFormSchema.parse(rawValues);

  const { useManualSchedule, manualSlots, ...rest } = formValues;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, slot.time))
    .filter((slot): slot is Date => Boolean(slot));

  const parsed = promotionCampaignSchema.parse({
    ...rest,
    startDate: new Date(formValues.startDate),
    endDate: new Date(formValues.endDate),
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
  });

  const result = await createPromotionCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleWeeklyCampaignSubmission(rawValues: unknown) {
  const formValues = weeklyCampaignFormSchema.parse(rawValues);

  const { useManualSchedule, manualSlots, ...rest } = formValues;
  const manualScheduleDates = (manualSlots ?? [])
    .map((slot) => parseManualSlot(slot.date, slot.time))
    .filter((slot): slot is Date => Boolean(slot));

  const parsed = weeklyCampaignSchema.parse({
    ...rest,
    dayOfWeek: Number(formValues.dayOfWeek),
    startDate: new Date(formValues.startDate),
    weeksAhead:
      useManualSchedule ? undefined : formValues.weeksAhead ? Number(formValues.weeksAhead) : undefined,
    customSchedule: useManualSchedule ? manualScheduleDates : undefined,
  });

  const result = await createWeeklyCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

function parseManualSlot(date: string, time: string) {
  if (!date) return null;
  const base = new Date(date);
  if (Number.isNaN(base.getTime())) {
    return null;
  }

  const [hourStr = "00", minuteStr = "00"] = time?.split(":") ?? [];
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  base.setHours(Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0, 0);
  return base;
}
