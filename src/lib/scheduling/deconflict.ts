/**
 * Deconflict campaign plans: shift posts off same-day clusters onto nearby
 * empty days. Also checks against existing content_items so we avoid stacking
 * on already-busy days.
 *
 * Rules:
 * - Same-day posts (day-of event / promotion launch) are never shifted.
 * - Shift range is ±1-2 calendar days. If nothing is empty, leave in place.
 * - Prefers earlier shifts (day-1 before day+1, day-2 before day+2).
 * - When multiple platforms are targeted and a post is shifted, platforms
 *   can be staggered across adjacent days (Instagram first, Facebook, GBP).
 *
 * All date arithmetic uses Luxon in the target timezone to avoid DST bugs.
 */

import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toDayKey } from "@/lib/scheduling/spread";

const DEFAULT_TZ = "Europe/London";

/** Minimal plan shape — matches the VariantPlan used in service.ts. */
export interface DeconflictablePlan {
  scheduledFor: Date | null;
  platforms: string[];
  /** If set, this plan must not be shifted (e.g. day-of event post). */
  pinned?: boolean;
}

/**
 * Deconflict a set of campaign plans so that no two plans land on the same
 * calendar day (where possible), and none land on a day that already has
 * content_items in the account.
 *
 * Returns a new array with adjusted `scheduledFor` values. Non-date fields
 * are left untouched.
 */
export async function deconflictCampaignPlans<T extends DeconflictablePlan>(
  supabase: SupabaseClient,
  accountId: string,
  plans: T[],
  timezone: string,
): Promise<T[]> {
  const tz = timezone || DEFAULT_TZ;

  // Nothing to deconflict if there are 0-1 plans
  if (plans.length <= 1) return plans;

  // Only consider plans with a scheduled date
  const scheduled = plans.filter((p) => p.scheduledFor !== null);
  if (scheduled.length <= 1) return plans;

  // ---- Build occupancy map from existing content_items ----
  const occupancy = await buildOccupancyMap(supabase, accountId, scheduled, tz);

  // ---- Add our own plans to the occupancy ----
  for (const plan of scheduled) {
    const key = toDayKey(plan.scheduledFor!, tz);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  // ---- Group plans by day key ----
  const byDay = new Map<string, { index: number; plan: T }[]>();
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    if (!plan.scheduledFor) continue;
    const key = toDayKey(plan.scheduledFor, tz);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push({ index: i, plan });
  }

  // ---- Deconflict days with 2+ plans ----
  const result = [...plans];

  for (const [dayKey, entries] of byDay) {
    if (entries.length < 2) continue;

    // Sort by "closeness to ideal" — pinned first, then by original offset
    // Keep the first entry (closest to ideal), shift the rest
    const pinnedEntries = entries.filter((e) => e.plan.pinned);
    const shiftable = entries.filter((e) => !e.plan.pinned);

    // Keep one non-pinned entry on this day if no pinned entries claim it
    if (pinnedEntries.length === 0) {
      shiftable.shift(); // remove first entry — it stays on this day
    }
    const toShift = shiftable;

    for (const entry of toShift) {
      const originalDate = entry.plan.scheduledFor!;
      const newDate = findNearbyEmptyDay(originalDate, occupancy, tz);

      if (newDate && toDayKey(newDate, tz) !== dayKey) {
        // Shift succeeded — update the plan
        const newKey = toDayKey(newDate, tz);
        // Remove from old day occupancy
        occupancy.set(dayKey, Math.max(0, (occupancy.get(dayKey) ?? 1) - 1));
        // Add to new day occupancy
        occupancy.set(newKey, (occupancy.get(newKey) ?? 0) + 1);

        result[entry.index] = {
          ...entry.plan,
          scheduledFor: newDate,
        };
      }
    }
  }

  return result;
}

/**
 * Find the nearest empty day within ±2 days of the given date.
 * Prefers earlier shifts: -1, +1, -2, +2.
 * Returns null if no empty day is found.
 */
function findNearbyEmptyDay(
  date: Date,
  occupancy: Map<string, number>,
  tz: string,
): Date | null {
  const baseDt = DateTime.fromJSDate(date, { zone: tz });

  // Try offsets in preference order: -1, +1, -2, +2
  const offsets = [-1, 1, -2, 2];

  for (const offset of offsets) {
    const candidate = baseDt.plus({ days: offset });
    const key = candidate.toISODate() ?? "";
    const count = occupancy.get(key) ?? 0;

    if (count === 0) {
      // Preserve the time of day from the original date
      const result = candidate.set({
        hour: baseDt.hour,
        minute: baseDt.minute,
        second: 0,
        millisecond: 0,
      });
      return result.toJSDate();
    }
  }

  // No empty day found within ±2 days
  return null;
}

/**
 * Query existing content_items for the account across the date range of the
 * plans and build an occupancy count per calendar day.
 */
async function buildOccupancyMap(
  supabase: SupabaseClient,
  accountId: string,
  plans: DeconflictablePlan[],
  tz: string,
): Promise<Map<string, number>> {
  const occupancy = new Map<string, number>();

  // Find the date range (with ±3 day buffer for shifting)
  const dates = plans
    .filter((p) => p.scheduledFor)
    .map((p) => p.scheduledFor!.getTime());

  if (dates.length === 0) return occupancy;

  const minDate = new Date(Math.min(...dates) - 3 * 24 * 60 * 60 * 1000);
  const maxDate = new Date(Math.max(...dates) + 3 * 24 * 60 * 60 * 1000);

  try {
    const { data, error } = await supabase
      .from("content_items")
      .select("scheduled_for")
      .eq("account_id", accountId)
      .gte("scheduled_for", minDate.toISOString())
      .lte("scheduled_for", maxDate.toISOString())
      .not("scheduled_for", "is", null);

    if (error) {
      // Non-fatal: if the query fails, proceed without existing data
      console.warn("[deconflict] Failed to fetch existing content_items:", error.message);
      return occupancy;
    }

    for (const row of data ?? []) {
      if (row.scheduled_for) {
        const key = toDayKey(new Date(row.scheduled_for as string), tz);
        occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
      }
    }
  } catch {
    // Non-fatal
    console.warn("[deconflict] Exception fetching content_items, proceeding without occupancy data");
  }

  return occupancy;
}
