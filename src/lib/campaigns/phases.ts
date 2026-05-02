export interface CampaignPhase {
  phaseType: 'run-up' | 'day-before' | 'day-of' | 'evergreen';
  phaseLabel: string;
  phaseStart: string;   // ISO date YYYY-MM-DD
  phaseEnd: string | null; // ISO date or null (single-day phases have no end)
  adsStopTime: string | null; // HH:MM — only set on day-of
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MAX_EVERGREEN_DAYS = 30;

/**
 * Calculate campaign phases from start date, event date, and stop time.
 *
 * Phase structure:
 * - Run-up: startDate → eventDate − 2 days (only if gap ≥ 3 days)
 * - Day Before: eventDate − 1 day (always, unless same-day campaign)
 * - Day Of: eventDate (always)
 *
 * Degenerate cases (gap < 3 days) produce fewer phases.
 */
export function calculatePhases(
  startDate: string,
  eventDate: string,
  adsStopTime: string,
): CampaignPhase[] {
  const start = new Date(startDate);
  const event = new Date(eventDate);
  const daysBetween = Math.round(
    (event.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysBetween < 0) {
    throw new Error(
      `startDate (${startDate}) must not be after eventDate (${eventDate})`,
    );
  }

  const addDays = (isoDate: string, n: number): string => {
    const d = new Date(isoDate);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const dayOf: CampaignPhase = {
    phaseType: 'day-of',
    phaseLabel: 'Day Of',
    phaseStart: eventDate,
    phaseEnd: null,
    adsStopTime,
  };

  if (daysBetween === 0) {
    return [dayOf];
  }

  const dayBefore: CampaignPhase = {
    phaseType: 'day-before',
    phaseLabel: 'Day Before',
    phaseStart: addDays(eventDate, -1),
    phaseEnd: null,
    adsStopTime: null,
  };

  if (daysBetween <= 2) {
    return [dayBefore, dayOf];
  }

  // 3+ days: full run-up
  const runUp: CampaignPhase = {
    phaseType: 'run-up',
    phaseLabel: 'Run-up',
    phaseStart: startDate,
    phaseEnd: addDays(eventDate, -2),
    adsStopTime: null,
  };

  return [runUp, dayBefore, dayOf];
}

export function calculateEvergreenPhases(
  startDate: string,
  endDate: string,
): CampaignPhase[] {
  const durationDays = calculateInclusiveDurationDays(startDate, endDate);

  if (durationDays > MAX_EVERGREEN_DAYS) {
    throw new Error('Evergreen campaigns can run for a maximum of 30 days.');
  }

  return [
    {
      phaseType: 'evergreen',
      phaseLabel: 'Evergreen Test',
      phaseStart: startDate,
      phaseEnd: endDate,
      adsStopTime: null,
    },
  ];
}

export function calculateInclusiveDurationDays(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  const durationDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;

  if (durationDays < 1) {
    throw new Error(`startDate (${startDate}) must not be after endDate (${endDate})`);
  }

  return durationDays;
}

function parseDateOnly(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date in YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} is not a valid date.`);
  }

  return parsed;
}
