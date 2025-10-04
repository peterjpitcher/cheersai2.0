import { DateTime, type WeekdayNumbers } from "luxon";

import { OWNER_ACCOUNT_ID } from "@/lib/constants";
import { resolveConflicts } from "@/lib/scheduling/conflicts";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

interface CadenceEntry {
  platform: "facebook" | "instagram" | "gbp";
  weekday: number;
  hour: number;
  minute: number;
}

const MATERIALISE_WINDOW_DAYS = 7;

export async function materialiseRecurringCampaigns(reference: Date = new Date()) {
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return;
  }

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, metadata")
    .eq("account_id", OWNER_ACCOUNT_ID)
    .eq("campaign_type", "weekly")
    .eq("status", "scheduled");

  if (error) {
    if (isSchemaMissingError(error)) return;
    throw error;
  }

  for (const campaign of campaigns ?? []) {
    const cadence = parseCadence(campaign.metadata as Record<string, unknown> | null);
    if (!cadence.length) continue;
    await materialiseCampaign(campaign.id, cadence, reference);
  }
}

function parseCadence(metadata: Record<string, unknown> | null): CadenceEntry[] {
  const entries = (metadata?.cadence as CadenceEntry[] | undefined) ?? [];
  return entries.filter(
    (entry) =>
      typeof entry.weekday === "number" &&
      typeof entry.hour === "number" &&
      typeof entry.minute === "number" &&
      ["facebook", "instagram", "gbp"].includes(entry.platform),
  );
}

async function materialiseCampaign(
  campaignId: string,
  cadence: CadenceEntry[],
  reference: Date,
) {
  const supabase = tryCreateServiceSupabaseClient();

  if (!supabase) {
    return;
  }

  const windowStart = DateTime.fromJSDate(reference).startOf("day");
  const windowEnd = windowStart.plus({ days: MATERIALISE_WINDOW_DAYS });

  const slots = cadence.flatMap((entry) => buildSlots(entry, windowStart, windowEnd));

  if (!slots.length) return;

  const { data: existing } = await supabase
    .from("content_items")
    .select("scheduled_for")
    .eq("campaign_id", campaignId)
    .gte("scheduled_for", windowStart.toISO())
    .lte("scheduled_for", windowEnd.toISO());

  const existingTimes = new Set((existing ?? []).map((row) => row.scheduled_for));
  const newSlots = slots.filter((slot) => !existingTimes.has(slot.scheduledFor.toISOString()));
  if (!newSlots.length) return;

  const resolved = resolveConflicts(
    newSlots.map((slot, index) => ({
      id: `${campaignId}-${index}`,
      platform: slot.platform,
      scheduledFor: slot.scheduledFor,
    })),
  );

  const rowsToInsert = resolved.map((result) => ({
    campaign_id: campaignId,
    account_id: OWNER_ACCOUNT_ID,
    platform: result.slot.platform,
    scheduled_for: result.slot.scheduledFor.toISOString(),
    status: "scheduled",
    prompt_context: {
      source: "recurring",
      resolution: result.resolution ? result.resolution.toISOString() : undefined,
    },
    auto_generated: true,
  }));

  if (!rowsToInsert.length) return;

  await supabase
    .from("content_items")
    .insert(rowsToInsert)
    .throwOnError();
}

function buildSlots(
  cadence: CadenceEntry,
  windowStart: DateTime,
  windowEnd: DateTime,
) {
  const slots: Array<{ scheduledFor: Date; platform: CadenceEntry["platform"] }> = [];

  let pointer = windowStart.startOf("week");
  while (pointer <= windowEnd) {
    const targetWeekday = (((cadence.weekday ?? 1) - 1 + 7) % 7 + 1) as WeekdayNumbers;
    const target = pointer
      .set({ weekday: targetWeekday })
      .set({ hour: cadence.hour, minute: cadence.minute, second: 0, millisecond: 0 });

    if (target < windowStart) {
      pointer = pointer.plus({ weeks: 1 });
      continue;
    }

    if (target > windowEnd) break;

    slots.push({ scheduledFor: target.toJSDate(), platform: cadence.platform });
    pointer = pointer.plus({ weeks: 1 });
  }

  return slots;
}
