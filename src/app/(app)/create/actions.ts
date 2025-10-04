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

  const parsed = eventCampaignSchema.parse({
    ...formValues,
    startDate: new Date(formValues.startDate),
    scheduleOffsets: defaultOffsets,
  });

  const result = await createEventCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handlePromotionCampaignSubmission(rawValues: unknown) {
  const formValues = promotionCampaignFormSchema.parse(rawValues);

  const parsed = promotionCampaignSchema.parse({
    ...formValues,
    startDate: new Date(formValues.startDate),
    endDate: new Date(formValues.endDate),
  });

  const result = await createPromotionCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}

export async function handleWeeklyCampaignSubmission(rawValues: unknown) {
  const formValues = weeklyCampaignFormSchema.parse(rawValues);

  const parsed = weeklyCampaignSchema.parse({
    ...formValues,
    dayOfWeek: Number(formValues.dayOfWeek),
    startDate: new Date(formValues.startDate),
    weeksAhead: formValues.weeksAhead ? Number(formValues.weeksAhead) : undefined,
  });

  const result = await createWeeklyCampaign(parsed);

  revalidatePath("/planner");
  revalidatePath("/library");

  return result;
}
