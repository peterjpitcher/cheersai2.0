import { describe, expect, it } from 'vitest';

import {
  detectCreativeFatigue,
  FATIGUE_CTR_DROP_RATIO,
  FATIGUE_FREQUENCY_THRESHOLD,
  FATIGUE_MIN_COVERAGE_DAYS,
  FATIGUE_MIN_IMPRESSIONS,
  FATIGUE_WINDOW_DAYS,
  type AdMetricsHistoryRow,
} from '@/lib/campaigns/creative-fatigue';

const AD_ID = 'ad-1';
const END_DATE = '2026-06-08';

interface CumulativeDay {
  /** Impressions ADDED on this day (the row stores the running lifetime total). */
  deltaImpressions: number;
  /** Clicks ADDED on this day (the row stores the running lifetime total). */
  deltaClicks: number;
  /** Lifetime frequency reported at this capture (impressions / reach). */
  frequency?: number | null;
  /** Skip this capture date entirely (simulates a missed nightly sync). */
  skip?: boolean;
}

/**
 * Build CUMULATIVE daily snapshots, mirroring what performance-sync writes:
 * each row holds the campaign-lifetime impressions/clicks/ctr at capture time,
 * one row per Europe/London day, oldest first, ending on `endDate`.
 *
 * `startImpressions`/`startClicks` seed the lifetime totals BEFORE day 0 so tests
 * can model an ad with a long, strong history (lifetime CTR smoothing).
 */
function cumulativeHistory(
  days: CumulativeDay[],
  options: { startImpressions?: number; startClicks?: number; endDate?: string } = {},
): AdMetricsHistoryRow[] {
  const endDate = options.endDate ?? END_DATE;
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const total = days.length;
  let impressions = options.startImpressions ?? 0;
  let clicks = options.startClicks ?? 0;
  const rows: AdMetricsHistoryRow[] = [];

  days.forEach((day, index) => {
    impressions += day.deltaImpressions;
    clicks += day.deltaClicks;
    if (day.skip) return;

    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (total - 1 - index));
    rows.push({
      adId: AD_ID,
      capturedOn: date.toISOString().slice(0, 10),
      impressions,
      clicks,
      // The stored ctr column is the LIFETIME ctr at capture time, exactly as Meta reports it.
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      frequency: day.frequency ?? null,
      spend: null,
    });
  });

  return rows;
}

/** 15 cumulative snapshots: prior-window boundary, 7 prior days, recent boundary at day 7, 7 recent days. */
function twoDeltaWeeks(
  prior: Omit<CumulativeDay, 'skip'>,
  recent: Omit<CumulativeDay, 'skip'>,
  options: { startImpressions?: number; startClicks?: number } = {},
): AdMetricsHistoryRow[] {
  return cumulativeHistory(
    [
      { deltaImpressions: 0, deltaClicks: 0 }, // day 0 anchors the prior-window boundary
      ...Array.from({ length: FATIGUE_WINDOW_DAYS }, () => prior),
      ...Array.from({ length: FATIGUE_WINDOW_DAYS }, () => recent),
    ],
    options,
  );
}

describe('detectCreativeFatigue (delta semantics over cumulative snapshots)', () => {
  it('WF-1: flags a weekly delta-CTR collapse that lifetime CTR smoothing would hide', () => {
    // A long strong history (50k impressions at 10% CTR) keeps the stored lifetime
    // ctr column high, but the most recent week's NEW delivery collapsed from
    // 4% to 1% — a 75% week-over-week drop in delta CTR.
    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 40, frequency: 1.4 }, // prior week: 4% delta CTR
      { deltaImpressions: 1000, deltaClicks: 10, frequency: 1.5 }, // recent week: 1% delta CTR
      { startImpressions: 50000, startClicks: 5000 },
    );

    // Sanity: lifetime CTR stays healthy in every snapshot, so averaging the stored
    // ctr column (the old behaviour) could never see this collapse.
    expect(history.every((row) => (row.ctr ?? 0) > 7)).toBe(true);

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/week-over-week/i);
  });

  it('flags fatigue exactly at the delta-CTR drop threshold', () => {
    const priorClicksPerDay = 40; // 4% delta CTR
    const recentClicksPerDay = Math.round(priorClicksPerDay * (1 - FATIGUE_CTR_DROP_RATIO)); // 3% = exactly -25%

    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: priorClicksPerDay, frequency: 1.4 },
      { deltaImpressions: 1000, deltaClicks: recentClicksPerDay, frequency: 1.5 },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/ctr|click-through/i);
  });

  it('WF-1: flags lifetime frequency at the threshold and names the lifetime semantics', () => {
    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 30, frequency: 2.4 },
      { deltaImpressions: 1000, deltaClicks: 30, frequency: FATIGUE_FREQUENCY_THRESHOLD },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/lifetime frequency/i);
  });

  it('does not flag a healthy ad with stable weekly deltas and low frequency', () => {
    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 30, frequency: 1.1 },
      { deltaImpressions: 1000, deltaClicks: 30, frequency: 1.2 },
    );

    expect(detectCreativeFatigue(history).fatigued).toBe(false);
  });

  it('WF-6: abstains when the recent WEEKLY impressions are below the floor despite big lifetime totals', () => {
    const weeklyBelowFloor = Math.floor((FATIGUE_MIN_IMPRESSIONS - 7) / FATIGUE_WINDOW_DAYS);
    // Lifetime impressions are huge (well past the floor); the recent week's NEW
    // impressions are tiny, so any CTR signal is noise and must be ignored.
    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 50, frequency: 1.2 },
      { deltaImpressions: weeklyBelowFloor, deltaClicks: 0, frequency: 1.3 }, // total CTR collapse
      { startImpressions: 80000, startClicks: 4000 },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('WF-6: abstains when a window is too gappy to trust (fewer than the minimum capture days)', () => {
    const days: CumulativeDay[] = [
      { deltaImpressions: 0, deltaClicks: 0 },
      ...Array.from({ length: FATIGUE_WINDOW_DAYS }, (): CumulativeDay => (
        { deltaImpressions: 1000, deltaClicks: 40, frequency: 1.4 }
      )),
      ...Array.from({ length: FATIGUE_WINDOW_DAYS }, (_, index): CumulativeDay => ({
        deltaImpressions: 1000,
        deltaClicks: 5, // real collapse, but…
        frequency: 1.5,
        // …only 3 of the 7 recent capture days exist (boundary day kept, 4 syncs missed).
        skip: index >= 1 && index <= FATIGUE_WINDOW_DAYS - 1 - FATIGUE_MIN_COVERAGE_DAYS + 3,
      })),
    ];
    const history = cumulativeHistory(days);
    const recentCaptureDays = history.filter((row) => row.capturedOn > '2026-06-01').length;
    expect(recentCaptureDays).toBeLessThan(FATIGUE_MIN_COVERAGE_DAYS);

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('abstains when there is no snapshot anywhere near the prior-window boundary', () => {
    // Only 8 days of history: the t−14d boundary has no meaningful snapshot, so the
    // prior week's delta cannot be computed.
    const history = cumulativeHistory(
      Array.from({ length: 8 }, (): CumulativeDay => (
        { deltaImpressions: 1500, deltaClicks: 15, frequency: 4 }
      )),
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('abstains on an empty history', () => {
    expect(detectCreativeFatigue([]).fatigued).toBe(false);
  });

  it('abstains when cumulative totals go backwards (Meta restated the data)', () => {
    const history = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 40, frequency: 1.4 },
      { deltaImpressions: 1000, deltaClicks: 10, frequency: 1.5 },
    );
    // Restatement: the latest snapshot reports fewer lifetime clicks than the boundary.
    const latest = history[history.length - 1]!;
    latest.clicks = 100;

    expect(detectCreativeFatigue(history).fatigued).toBe(false);
  });

  it('uses the most recent snapshots regardless of input ordering', () => {
    const ordered = twoDeltaWeeks(
      { deltaImpressions: 1000, deltaClicks: 30, frequency: 1.0 },
      { deltaImpressions: 1000, deltaClicks: 30, frequency: FATIGUE_FREQUENCY_THRESHOLD + 1 },
    );
    const shuffled = [...ordered].reverse();

    const result = detectCreativeFatigue(shuffled);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/lifetime frequency/i);
  });
});
