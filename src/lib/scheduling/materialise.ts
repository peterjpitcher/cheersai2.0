import { DateTime, type WeekdayNumbers } from "luxon";
import { z } from "zod";

import { OWNER_ACCOUNT_ID } from "@/lib/constants";
import { resolveConflicts, type ScheduledSlot } from "@/lib/scheduling/conflicts";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";
import type { ContentItem } from "@/types/content";

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
    const metadata = campaign.metadata as Record<string, unknown> | null;

    // Skip spread_evenly campaigns — their slots are pre-computed at creation
    // time by buildSpreadEvenlySlots() in service.ts. Unlike fixed_days campaigns
    // which need weekly materialisation of cadence-based slots, spread_evenly
    // campaigns distribute all posts upfront across the emptiest days in the
    // full scheduling window. Re-materialising them here would create duplicates.
    const scheduleMeta = parseWeeklyCampaignMetadata(metadata);
    if (scheduleMeta.scheduleMode === "spread_evenly") continue;

    const cadence = parseCadence(metadata);
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

/**
 * Zod schema for weekly campaign scheduling metadata.
 * Validates scheduleMode, postsPerWeek, and staggerPlatforms.
 */
const weeklyCampaignMetadataSchema = z.object({
  scheduleMode: z.enum(["fixed_days", "spread_evenly"]).default("fixed_days"),
  postsPerWeek: z.number().int().min(1).max(7).optional(),
  staggerPlatforms: z.boolean().default(true),
});

type WeeklyCampaignMetadata = z.infer<typeof weeklyCampaignMetadataSchema>;

/**
 * Parse schedule metadata from a weekly campaign's metadata JSONB column.
 * Returns validated fields with defaults applied.
 */
export function parseWeeklyCampaignMetadata(
  metadata: Record<string, unknown> | null,
): WeeklyCampaignMetadata {
  const result = weeklyCampaignMetadataSchema.safeParse(metadata ?? {});
  if (result.success) {
    return result.data;
  }
  // If validation fails, return safe defaults (fixed_days mode)
  return { scheduleMode: "fixed_days", staggerPlatforms: true };
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

  // Query ALL content_items for this account in the window to detect
  // cross-campaign conflicts (not just same-campaign duplicates).
  const { data: allAccountItems } = await supabase
    .from("content_items")
    .select("id, scheduled_for, platform")
    .eq("account_id", OWNER_ACCOUNT_ID)
    .gte("scheduled_for", windowStart.toISO())
    .lte("scheduled_for", windowEnd.toISO());

  const occupiedSlots: ScheduledSlot[] = (allAccountItems ?? [])
    .filter((row): row is { id: string; scheduled_for: string; platform: "facebook" | "instagram" | "gbp" } =>
      !!row.scheduled_for && !!row.platform)
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      scheduledFor: new Date(row.scheduled_for),
    }));

  const resolved = resolveConflicts([
    // Include existing account items so new slots are checked against them
    ...occupiedSlots,
    ...newSlots.map((slot, index) => ({
      id: `${campaignId}-${index}`,
      platform: slot.platform,
      scheduledFor: slot.scheduledFor,
    })),
  ]);

  // Only insert rows for this campaign's new slots (not pre-existing account items)
  const campaignPrefix = `${campaignId}-`;
  const rowsToInsert = resolved
    .filter((result) => result.slot.id.startsWith(campaignPrefix))
    .map((result) => ({
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

// ---------------------------------------------------------------------------
// V2: Pure materialiseRecurring function (SCHED-03)
// ---------------------------------------------------------------------------

/**
 * A materialised calendar slot generated from a recurring content item.
 * Used by the planner calendar to display recurring campaigns as individual entries.
 */
export interface MaterialisedSlot {
  sourceId: string;
  scheduledAt: Date;
  contentType: 'weekly_recurring';
  title: string | null;
  status: ContentItem['status'];
  thumbnailUrl: string | null;
  placement: 'feed';
  platform?: ContentItem['platform'];
}

/**
 * Expand recurring content items into individual calendar slots within a date range.
 *
 * For each recurring item with a valid recurringDayOfWeek, generates one slot per week
 * at the configured time in Europe/London timezone. Respects weeksAhead from bodyDraft.
 *
 * @param recurring - Content items with contentType 'weekly_recurring'
 * @param rangeStart - Start of the calendar range (Luxon DateTime)
 * @param rangeEnd - End of the calendar range (Luxon DateTime)
 */
export function materialiseRecurring(
  recurring: ContentItem[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  thumbnails?: Map<string, string>,
): MaterialisedSlot[] {
  const slots: MaterialisedSlot[] = [];

  for (const item of recurring) {
    // Skip items without a valid recurring day
    if (item.recurringDayOfWeek == null) continue;

    const draft = item.bodyDraft as Record<string, unknown> | null;
    const recurringTime = (draft?.recurringTime as string) ?? '12:00';
    const weeksAhead = typeof draft?.weeksAhead === 'number' ? draft.weeksAhead : 4;

    const [hourStr, minuteStr] = recurringTime.split(':');
    const hour = parseInt(hourStr, 10) || 12;
    const minute = parseInt(minuteStr, 10) || 0;

    // Convert JS dayOfWeek (0=Sunday) to Luxon weekday (1=Monday, 7=Sunday)
    const luxonWeekday = item.recurringDayOfWeek === 0
      ? 7
      : item.recurringDayOfWeek;

    let slotsGenerated = 0;
    let pointer = rangeStart.startOf('week'); // Monday in Luxon

    while (pointer <= rangeEnd && slotsGenerated < weeksAhead) {
      const target = pointer
        .set({ weekday: luxonWeekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 })
        .set({ hour, minute, second: 0, millisecond: 0 });

      // Ensure target is within the requested range
      if (target >= rangeStart && target <= rangeEnd) {
        slots.push({
          sourceId: item.id,
          scheduledAt: target.toJSDate(),
          contentType: 'weekly_recurring',
          title: item.title,
          status: item.status,
          thumbnailUrl: thumbnails?.get(item.id) ?? item.thumbnailUrl ?? null,
          placement: 'feed',
          platform: item.platform ?? null,
        });
        slotsGenerated++;
      }

      pointer = pointer.plus({ weeks: 1 });
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// V1: buildSlots helper (used by materialiseRecurringCampaigns)
// ---------------------------------------------------------------------------

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
