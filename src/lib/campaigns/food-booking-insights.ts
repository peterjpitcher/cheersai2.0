import { DateTime } from 'luxon';

import { normaliseUtmContentKey } from '@/lib/campaigns/ad-attribution';
import {
  buildCutoffRecommendations,
  type CutoffRecommendation,
  type FoodCutoffStageBookings,
} from '@/lib/campaigns/food-cutoff-tuning';
import { DECISION_STAGE_TEMPLATES } from '@/lib/campaigns/food-schedule';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type {
  Campaign,
  FoodDecisionStage,
  FoodServiceKey,
} from '@/types/campaigns';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export interface FoodBookingConversionEventRow {
  booking_id: string;
  booking_type: string;
  food_intent: string | null;
  utm_content: string | null;
  value: number | string | null;
  currency: string | null;
  occurred_at: string;
}

export interface FoodBookingInsightItem {
  key: string;
  name: string;
  bookings: number;
  value: number;
  costPerBooking: number | null;
}

export interface FoodBookingInsights {
  totalBookings30d: number;
  totalBookings90d: number;
  totalValue90d: number;
  costPerTableBooking: number | null;
  sundayRoastBookings90d: number;
  sundayRoastValue90d: number;
  topServices90d: FoodBookingInsightItem[];
  topDecisionStages90d: FoodBookingInsightItem[];
  topWindows90d: FoodBookingInsightItem[];
  cutoffRecommendations: CutoffRecommendation[];
}

interface FoodAdAttribution {
  serviceKey: FoodServiceKey;
  decisionStage: FoodDecisionStage | null;
  windowKey: string;
}

interface ResolvedFoodBooking {
  row: FoodBookingConversionEventRow;
  serviceKey: FoodServiceKey | 'unattributed';
  decisionStage: FoodDecisionStage | 'unattributed';
  windowKey: string;
}

const UNATTRIBUTED_KEY = 'unattributed';

const FOOD_SERVICE_LABELS: Record<FoodServiceKey | typeof UNATTRIBUTED_KEY, string> = {
  weekday_dinner: 'Weekday dinner',
  saturday_food: 'Saturday food',
  sunday_roast: 'Sunday roast',
  unattributed: 'Unattributed',
};

const FOOD_DECISION_STAGE_LABELS: Record<FoodDecisionStage | typeof UNATTRIBUTED_KEY, string> = {
  planning: 'Planning',
  lunch_decision: 'Lunch decision',
  afternoon_commit: 'Afternoon commit',
  tomorrow: 'Tomorrow',
  morning_commit: 'Morning commit',
  last_tables: 'Last tables',
  last_minute: 'Last minute',
  unattributed: 'Unattributed',
};

const KNOWN_WINDOW_KEYS = Object.values(DECISION_STAGE_TEMPLATES)
  .flat()
  .map((template) => template.windowKey)
  .sort((left, right) => right.length - left.length);

export const EMPTY_FOOD_BOOKING_INSIGHTS: FoodBookingInsights = {
  totalBookings30d: 0,
  totalBookings90d: 0,
  totalValue90d: 0,
  costPerTableBooking: null,
  sundayRoastBookings90d: 0,
  sundayRoastValue90d: 0,
  topServices90d: [],
  topDecisionStages90d: [],
  topWindows90d: [],
  cutoffRecommendations: [],
};

export async function fetchFoodBookingInsights(
  accountId: string,
  campaigns: Campaign[],
  options?: {
    supabase?: SupabaseClientLike;
    now?: Date;
  },
): Promise<FoodBookingInsights> {
  const supabase = options?.supabase ?? createServiceSupabaseClient();
  const since = DateTime.fromJSDate(options?.now ?? new Date())
    .minus({ days: 90 })
    .toISO() ?? new Date(0).toISOString();

  const { data, error } = await supabase
    .from('booking_conversion_events')
    .select('booking_id, booking_type, food_intent, utm_content, value, currency, occurred_at')
    .eq('account_id', accountId)
    .eq('booking_type', 'table')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return buildFoodBookingInsights(
    (data ?? []) as FoodBookingConversionEventRow[],
    campaigns,
    options?.now,
  );
}

export function buildFoodBookingInsights(
  rows: FoodBookingConversionEventRow[],
  campaigns: Campaign[],
  now: Date = new Date(),
): FoodBookingInsights {
  const windowEnd = DateTime.fromJSDate(now);
  const windowStart = windowEnd.minus({ days: 90 });
  const rows90 = rows.filter((row) => (
    row.booking_type === 'table'
    && isWithinWindow(row.occurred_at, windowStart, windowEnd)
  ));
  const rows30 = rows90.filter((row) => (
    isWithinWindow(row.occurred_at, windowEnd.minus({ days: 30 }), windowEnd)
  ));
  const attributionByUtm = buildFoodAdAttributionMap(campaigns);
  const serviceSpend = buildServiceSpendMap(campaigns, windowStart.toISODate() ?? '');
  const totalFoodSpend = Array.from(serviceSpend.values()).reduce((sum, spend) => sum + spend, 0);
  const resolvedRows = rows90.map((row) => resolveFoodBooking(row, attributionByUtm));
  const sundayRows = resolvedRows.filter((item) => item.serviceKey === 'sunday_roast');

  return {
    totalBookings30d: rows30.length,
    totalBookings90d: rows90.length,
    totalValue90d: rows90.reduce((sum, row) => sum + toNumber(row.value), 0),
    costPerTableBooking: totalFoodSpend > 0 && rows90.length > 0
      ? totalFoodSpend / rows90.length
      : null,
    sundayRoastBookings90d: sundayRows.length,
    sundayRoastValue90d: sundayRows.reduce((sum, item) => sum + toNumber(item.row.value), 0),
    topServices90d: aggregateRows(
      resolvedRows,
      (item) => ({
        key: item.serviceKey,
        name: FOOD_SERVICE_LABELS[item.serviceKey],
      }),
      (key, bookings) => {
        const spend = serviceSpend.get(key as FoodServiceKey) ?? 0;
        return spend > 0 && bookings > 0 ? spend / bookings : null;
      },
    ),
    topDecisionStages90d: aggregateRows(resolvedRows, (item) => ({
      key: item.decisionStage,
      name: FOOD_DECISION_STAGE_LABELS[item.decisionStage],
    })),
    topWindows90d: aggregateRows(resolvedRows, (item) => ({
      key: item.windowKey,
      name: formatWindowKey(item.windowKey),
    })),
    cutoffRecommendations: buildCutoffRecommendations(
      buildCutoffTuningInput(resolvedRows),
    ),
  };
}

/**
 * Reshape already-resolved bookings into the per-stage aggregation the advisory
 * cutoff-tuning module expects. Only fully attributed rows (real service + decision
 * stage) feed the analysis; unattributed bookings carry no window to advise on.
 */
function buildCutoffTuningInput(resolvedRows: ResolvedFoodBooking[]) {
  const byStage = new Map<string, FoodCutoffStageBookings>();
  const totalsByService: Partial<Record<FoodServiceKey, number>> = {};

  for (const item of resolvedRows) {
    if (item.serviceKey === UNATTRIBUTED_KEY) continue;
    if (item.decisionStage === UNATTRIBUTED_KEY) continue;

    const serviceKey = item.serviceKey;
    const decisionStage = item.decisionStage;
    totalsByService[serviceKey] = (totalsByService[serviceKey] ?? 0) + 1;

    const stageKey = `${serviceKey}::${decisionStage}::${item.windowKey}`;
    const existing = byStage.get(stageKey);
    if (existing) {
      existing.bookings += 1;
    } else {
      byStage.set(stageKey, {
        serviceKey,
        decisionStage,
        windowKey: item.windowKey,
        bookings: 1,
      });
    }
  }

  return { byStage: Array.from(byStage.values()), totalsByService };
}

function buildFoodAdAttributionMap(campaigns: Campaign[]) {
  const map = new Map<string, FoodAdAttribution>();

  for (const campaign of campaigns) {
    if (campaign.campaignKind !== 'food_booking') continue;

    for (const adSet of campaign.adSets ?? []) {
      if (!adSet.serviceKey) continue;

      for (const ad of adSet.ads ?? []) {
        const utmContentKey = normaliseUtmContentKey(ad.utmContentKey);
        if (!utmContentKey) continue;

        map.set(utmContentKey, {
          serviceKey: adSet.serviceKey,
          decisionStage: adSet.decisionStage ?? null,
          windowKey: inferWindowKey(ad.utmContentKey) ?? `${adSet.serviceKey}_${adSet.decisionStage ?? 'unknown'}`,
        });
      }
    }
  }

  return map;
}

/**
 * WF-5: ad-set spend is a LIFETIME total, while bookings are counted over the last
 * 90 days. Restrict spend to campaigns whose run window overlaps that 90-day window
 * (null end date = still running) so a food campaign that finished months ago cannot
 * inflate cost-per-booking. This approximates true 90-day spend until daily spend
 * history accrues in ad_metrics_history.
 */
function buildServiceSpendMap(campaigns: Campaign[], windowStartDate: string) {
  const map = new Map<FoodServiceKey, number>();

  for (const campaign of campaigns) {
    if (campaign.campaignKind !== 'food_booking') continue;
    if (campaign.endDate !== null && campaign.endDate < windowStartDate) continue;

    for (const adSet of campaign.adSets ?? []) {
      if (!adSet.serviceKey) continue;
      map.set(
        adSet.serviceKey,
        (map.get(adSet.serviceKey) ?? 0) + adSet.performance.spend,
      );
    }
  }

  return map;
}

function resolveFoodBooking(
  row: FoodBookingConversionEventRow,
  attributionByUtm: Map<string, FoodAdAttribution>,
): ResolvedFoodBooking {
  const attribution = attributionByUtm.get(normaliseUtmContentKey(row.utm_content));
  if (attribution) {
    return {
      row,
      serviceKey: attribution.serviceKey,
      decisionStage: attribution.decisionStage ?? UNATTRIBUTED_KEY,
      windowKey: attribution.windowKey,
    };
  }

  const serviceKey = serviceKeyFromFoodIntent(row.food_intent);

  return {
    row,
    serviceKey: serviceKey ?? UNATTRIBUTED_KEY,
    decisionStage: UNATTRIBUTED_KEY,
    windowKey: UNATTRIBUTED_KEY,
  };
}

function serviceKeyFromFoodIntent(value: string | null | undefined): FoodServiceKey | null {
  const normalised = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
  if (normalised === 'weekday_dinner') return 'weekday_dinner';
  if (normalised === 'saturday_food') return 'saturday_food';
  if (normalised === 'sunday_roast') return 'sunday_roast';
  if (normalised.includes('sunday') || normalised.includes('roast')) return 'sunday_roast';
  if (normalised.includes('saturday')) return 'saturday_food';
  // A bare "dinner" with no day marker is NOT assumed to be weekday — guessing here
  // silently distorts weekday reporting; unattributed is visible and honest instead.
  if (normalised.includes('weekday')) return 'weekday_dinner';
  return null;
}

function inferWindowKey(value: string | null | undefined): string | null {
  const key = normaliseUtmContentKey(value);
  if (!key) return null;
  return KNOWN_WINDOW_KEYS.find((windowKey) => key === windowKey || key.startsWith(`${windowKey}-`)) ?? null;
}

function aggregateRows(
  rows: ResolvedFoodBooking[],
  getKey: (row: ResolvedFoodBooking) => { key: string; name: string },
  getCostPerBooking?: (key: string, bookings: number) => number | null,
): FoodBookingInsightItem[] {
  const map = new Map<string, FoodBookingInsightItem>();

  for (const item of rows) {
    const { key, name } = getKey(item);
    const existing = map.get(key) ?? {
      key,
      name,
      bookings: 0,
      value: 0,
      costPerBooking: null,
    };
    existing.bookings += 1;
    existing.value += toNumber(item.row.value);
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      costPerBooking: getCostPerBooking?.(item.key, item.bookings) ?? null,
    }))
    .sort((left, right) => {
      const bookings = right.bookings - left.bookings;
      if (bookings !== 0) return bookings;
      const value = right.value - left.value;
      if (value !== 0) return value;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 5);
}

function formatWindowKey(value: string): string {
  if (value === UNATTRIBUTED_KEY) return 'Unattributed';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isWithinWindow(value: string, start: DateTime, end: DateTime): boolean {
  const parsed = DateTime.fromISO(value);
  return parsed.isValid && parsed >= start && parsed <= end;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
