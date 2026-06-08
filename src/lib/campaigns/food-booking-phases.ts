import { DateTime } from 'luxon';
import type { FoodAdWindow, FoodBookingBrief, FoodServiceHours, RunDay } from '@/types/campaigns';
import {
  DECISION_STAGE_TEMPLATES,
  hardStopFor,
  lastOrdersOrDefault,
} from '@/lib/campaigns/food-schedule';

const ZONE = 'Europe/London';
const WEEKDAY_INDEX: Record<RunDay, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};
const INDEX_WEEKDAY: Record<number, RunDay> = Object.fromEntries(
  Object.entries(WEEKDAY_INDEX).map(([k, v]) => [v, k as RunDay]),
) as Record<number, RunDay>;

function minOfHHMM(a: string, b: string): string {
  return a <= b ? a : b;
}

// A "cutoff-bounded" window is one whose template end sits exactly on the service's
// standard (non-Friday) hard stop — i.e. it is meant to run right up to the day's
// last-tables cutoff. Such a window tracks that day's hard stop, so on Friday it
// extends to the later weekday-dinner cutoff. Windows that deliberately end earlier
// than the cutoff (e.g. a lunch decision window, or Sunday last_tables ending before
// last orders) are only ever clamped down, never extended. We derive the standard
// stop from `hardStopFor` on a non-Friday day so there is a single source of truth.
//
// CR-3: when the venue shortens its hours, a DAY-OF window (the ad runs on the actual
// service day) must not run past the brief's last orders, so we additionally clamp it to
// `lastOrdersOrDefault(service)`. Day-before/planning windows (offset > 0) run on an
// earlier date, so the service's last-orders time does not apply to them.
function resolveWindowEnd(
  service: FoodServiceHours,
  runDay: RunDay,
  templateEnd: string,
  isDayOf: boolean,
): string {
  const serviceKey = service.serviceKey;
  const standardStop = hardStopFor(serviceKey, 'tuesday');
  const dayStop = hardStopFor(serviceKey, runDay);
  const hardStopBounded = templateEnd === standardStop ? dayStop : minOfHHMM(templateEnd, dayStop);
  if (!isDayOf) return hardStopBounded;
  return minOfHHMM(hardStopBounded, lastOrdersOrDefault(service));
}

/**
 * Derive short, London-local ad windows from a food brief. Pure and deterministic.
 * @param brief enabled services + scheduling preferences
 * @param campaignStartDate 'YYYY-MM-DD' London-local; windows before this are dropped
 */
export function calculateFoodBookingPhases(
  brief: FoodBookingBrief,
  campaignStartDate: string,
): FoodAdWindow[] {
  const start = DateTime.fromISO(campaignStartDate, { zone: ZONE }).startOf('day');
  const windows: FoodAdWindow[] = [];

  for (const service of brief.services) {
    if (!service.enabled) continue;
    const templates = DECISION_STAGE_TEMPLATES[service.serviceKey];

    for (let week = 0; week < brief.weeks; week++) {
      for (const dayName of service.days) {
        // The service date for this service-day in this week.
        const serviceDate = nthWeekdayOnOrAfter(start, WEEKDAY_INDEX[dayName]).plus({ weeks: week });

        for (const t of templates) {
          const runDate = serviceDate.minus({ days: t.serviceDateOffsetDays });
          if (runDate < start) continue;
          const runDay = INDEX_WEEKDAY[runDate.weekday];
          const isDayOf = t.serviceDateOffsetDays === 0;
          const endsAtLocal = resolveWindowEnd(service, runDay, t.endLocal, isDayOf);
          // Skip degenerate windows where the cutoff is at/before the start.
          if (endsAtLocal <= t.startLocal) continue;

          windows.push({
            serviceKey: service.serviceKey,
            decisionStage: t.decisionStage,
            runDay,
            runDate: runDate.toISODate()!,
            startsAtLocal: t.startLocal,
            endsAtLocal,
            serviceDate: serviceDate.toISODate()!,
            serviceDateOffsetDays: t.serviceDateOffsetDays,
            budgetWeight: t.weight,
            copyIntent: t.copyIntent,
            windowKey: t.windowKey,
            enabled: service.enabled && t.defaultEnabled,
          });
        }
      }
    }
  }

  windows.sort((a, b) => (a.runDate + a.startsAtLocal).localeCompare(b.runDate + b.startsAtLocal));
  return windows;
}

function nthWeekdayOnOrAfter(from: DateTime, weekdayIndex: number): DateTime {
  const delta = (weekdayIndex - from.weekday + 7) % 7;
  return from.plus({ days: delta });
}
