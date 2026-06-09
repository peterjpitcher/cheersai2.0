import { describe, expect, it } from 'vitest';

import {
  detectCreativeFatigue,
  FATIGUE_CTR_DROP_RATIO,
  FATIGUE_FREQUENCY_THRESHOLD,
  FATIGUE_MIN_IMPRESSIONS,
  FATIGUE_WINDOW_DAYS,
  type AdMetricsHistoryRow,
} from '@/lib/campaigns/creative-fatigue';

const AD_ID = 'ad-1';

/**
 * Build a contiguous run of daily rows ending on `endDate`, oldest first.
 * Each row gets the supplied per-row values so tests can shape the two windows.
 */
function buildHistory(
  rows: Array<Partial<Omit<AdMetricsHistoryRow, 'adId' | 'capturedOn'>>>,
  endDate = '2026-06-08',
): AdMetricsHistoryRow[] {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const total = rows.length;
  return rows.map((row, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - (total - 1 - index));
    return {
      adId: AD_ID,
      capturedOn: day.toISOString().slice(0, 10),
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? null,
      frequency: row.frequency ?? null,
      spend: row.spend ?? null,
    };
  });
}

/** 14 days where each window shares the same per-day shape. */
function twoWindows(
  prior: Partial<Omit<AdMetricsHistoryRow, 'adId' | 'capturedOn'>>,
  recent: Partial<Omit<AdMetricsHistoryRow, 'adId' | 'capturedOn'>>,
): AdMetricsHistoryRow[] {
  const priorDays = Array.from({ length: FATIGUE_WINDOW_DAYS }, () => prior);
  const recentDays = Array.from({ length: FATIGUE_WINDOW_DAYS }, () => recent);
  return buildHistory([...priorDays, ...recentDays]);
}

describe('detectCreativeFatigue', () => {
  it('flags fatigue when recent-window frequency reaches the threshold', () => {
    const history = twoWindows(
      { impressions: 1000, ctr: 2, frequency: 1.2 },
      { impressions: 1000, ctr: 2, frequency: FATIGUE_FREQUENCY_THRESHOLD },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/frequency/i);
  });

  it('flags fatigue when CTR drops by at least the week-over-week threshold', () => {
    const priorCtr = 4;
    const recentCtr = priorCtr * (1 - FATIGUE_CTR_DROP_RATIO); // exactly at the drop threshold

    const history = twoWindows(
      { impressions: 2000, ctr: priorCtr, frequency: 1.5 },
      { impressions: 2000, ctr: recentCtr, frequency: 1.5 },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(true);
    expect(result.reason).toMatch(/ctr|click-through/i);
  });

  it('does not flag a healthy ad with stable CTR and low frequency', () => {
    const history = twoWindows(
      { impressions: 2000, ctr: 3, frequency: 1.1 },
      { impressions: 2000, ctr: 3, frequency: 1.2 },
    );

    expect(detectCreativeFatigue(history).fatigued).toBe(false);
  });

  it('abstains on low-impression noise even when CTR collapses', () => {
    const belowFloorPerDay = Math.floor(FATIGUE_MIN_IMPRESSIONS / FATIGUE_WINDOW_DAYS) - 1;
    const history = twoWindows(
      { impressions: belowFloorPerDay, ctr: 5, frequency: 1.2 },
      { impressions: belowFloorPerDay, ctr: 0.5, frequency: 4 },
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('abstains when there is not enough history for two full windows', () => {
    // Only one window's worth of days — cannot compute week-over-week.
    const history = buildHistory(
      Array.from({ length: FATIGUE_WINDOW_DAYS }, () => ({
        impressions: 5000,
        ctr: 5,
        frequency: 4,
      })),
    );

    const result = detectCreativeFatigue(history);

    expect(result.fatigued).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('abstains on an empty history', () => {
    expect(detectCreativeFatigue([]).fatigued).toBe(false);
  });

  it('uses the most recent window regardless of input ordering', () => {
    const ordered = twoWindows(
      { impressions: 1500, ctr: 2, frequency: 1.0 },
      { impressions: 1500, ctr: 2, frequency: FATIGUE_FREQUENCY_THRESHOLD + 1 },
    );
    const shuffled = [...ordered].reverse();

    expect(detectCreativeFatigue(shuffled).fatigued).toBe(true);
  });
});
