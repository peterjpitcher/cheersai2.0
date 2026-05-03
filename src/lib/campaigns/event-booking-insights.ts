import { DateTime } from 'luxon';

import { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export interface BookingConversionEventRow {
  booking_id: string;
  booking_type: string;
  event_id: string | null;
  event_slug: string | null;
  event_name: string | null;
  event_category_name: string | null;
  event_category_slug: string | null;
  event_date: string | null;
  tickets: number | string | null;
  value: number | string | null;
  currency: string | null;
  food_intent: string | null;
  utm_campaign: string | null;
  occurred_at: string;
}

export interface EventBookingInsightItem {
  key: string;
  name: string;
  bookings: number;
  tickets: number;
  value: number;
}

export interface EventBookingInsights {
  totalBookings30d: number;
  totalBookings90d: number;
  totalTickets90d: number;
  totalValue90d: number;
  topCategories90d: EventBookingInsightItem[];
  topEvents90d: EventBookingInsightItem[];
  topCampaigns90d: EventBookingInsightItem[];
}

export const EMPTY_EVENT_BOOKING_INSIGHTS: EventBookingInsights = {
  totalBookings30d: 0,
  totalBookings90d: 0,
  totalTickets90d: 0,
  totalValue90d: 0,
  topCategories90d: [],
  topEvents90d: [],
  topCampaigns90d: [],
};

export async function fetchEventBookingInsights(
  accountId: string,
  options?: {
    supabase?: SupabaseClientLike;
    now?: Date;
  },
): Promise<EventBookingInsights> {
  const supabase = options?.supabase ?? createServiceSupabaseClient();
  const since = DateTime.fromJSDate(options?.now ?? new Date())
    .minus({ days: 90 })
    .toISO() ?? new Date(0).toISOString();

  const { data, error } = await supabase
    .from('booking_conversion_events')
    .select('booking_id, booking_type, event_id, event_slug, event_name, event_category_name, event_category_slug, event_date, tickets, value, currency, food_intent, utm_campaign, occurred_at')
    .eq('account_id', accountId)
    .eq('booking_type', 'event')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return buildEventBookingInsights((data ?? []) as BookingConversionEventRow[], options?.now);
}

export function buildEventBookingInsights(
  rows: BookingConversionEventRow[],
  now: Date = new Date(),
): EventBookingInsights {
  const windowEnd = DateTime.fromJSDate(now);
  const window30 = windowEnd.minus({ days: 30 });
  const rows90 = rows.filter((row) => isWithinWindow(row.occurred_at, windowEnd.minus({ days: 90 }), windowEnd));
  const rows30 = rows90.filter((row) => isWithinWindow(row.occurred_at, window30, windowEnd));

  return {
    totalBookings30d: rows30.length,
    totalBookings90d: rows90.length,
    totalTickets90d: rows90.reduce((sum, row) => sum + toNumber(row.tickets), 0),
    totalValue90d: rows90.reduce((sum, row) => sum + toNumber(row.value), 0),
    topCategories90d: aggregateRows(rows90, (row) => ({
      key: row.event_category_slug || row.event_category_name || 'uncategorised',
      name: row.event_category_name || row.event_category_slug || 'Uncategorised',
    })),
    topEvents90d: aggregateRows(rows90, (row) => ({
      key: row.event_id || row.event_slug || row.event_name || 'unknown_event',
      name: row.event_name || row.event_slug || row.event_id || 'Unknown event',
    })),
    topCampaigns90d: aggregateRows(rows90, (row) => ({
      key: row.utm_campaign || 'unknown_campaign',
      name: row.utm_campaign || 'Unknown campaign',
    })),
  };
}

export function formatEventBookingInsightsForCampaignPrompt(insights: EventBookingInsights): string | null {
  if (insights.totalBookings90d === 0) return null;

  const categories = insights.topCategories90d
    .slice(0, 3)
    .map((item) => `${item.name} (${item.bookings} bookings)`)
    .join(', ');
  const events = insights.topEvents90d
    .slice(0, 3)
    .map((item) => `${item.name} (${item.bookings} bookings)`)
    .join(', ');

  return [
    `Last 90 days: ${insights.totalBookings90d} tracked event bookings and ${insights.totalTickets90d} seats.`,
    categories ? `Top event categories: ${categories}.` : '',
    events ? `Top booked events: ${events}.` : '',
    'Use these aggregate patterns to strengthen copy angles and audience language. Do not mention this data directly in ad copy.',
  ].filter(Boolean).join('\n');
}

function aggregateRows(
  rows: BookingConversionEventRow[],
  getKey: (row: BookingConversionEventRow) => { key: string; name: string },
): EventBookingInsightItem[] {
  const map = new Map<string, EventBookingInsightItem>();

  for (const row of rows) {
    const { key, name } = getKey(row);
    const existing = map.get(key) ?? {
      key,
      name,
      bookings: 0,
      tickets: 0,
      value: 0,
    };
    existing.bookings += 1;
    existing.tickets += toNumber(row.tickets);
    existing.value += toNumber(row.value);
    map.set(key, existing);
  }

  return Array.from(map.values())
    .sort((left, right) => {
      const bookings = right.bookings - left.bookings;
      if (bookings !== 0) return bookings;
      const value = right.value - left.value;
      if (value !== 0) return value;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 5);
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
