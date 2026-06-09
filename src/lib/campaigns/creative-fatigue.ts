/**
 * Creative-fatigue detection (Phase 3, 3d).
 *
 * Pure, deterministic week-over-week analysis of an ad's daily delivery history
 * (sourced from the `ad_metrics_history` table). It compares the most recent
 * window against the immediately preceding window and flags fatigue when the ad
 * is being shown too often (high frequency) or is losing relevance (CTR decline)
 * — but only once it has accumulated enough impressions to be meaningful.
 *
 * It never decides to pause anything: callers surface a warning only.
 */

/** One day of delivery metrics for a single ad. camelCase mirror of the DB row. */
export interface AdMetricsHistoryRow {
  adId: string;
  /** Europe/London calendar date, ISO `YYYY-MM-DD`. */
  capturedOn: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  frequency: number | null;
  spend: number | null;
}

export interface CreativeFatigueResult {
  fatigued: boolean;
  reason?: string;
}

export interface DetectCreativeFatigueOptions {
  /** Days per comparison window (recent vs prior). */
  windowDays?: number;
  /** Frequency at/above which an ad is considered over-served. */
  frequencyThreshold?: number;
  /** Fractional week-over-week CTR drop that signals decay (0.25 = 25%). */
  ctrDropRatio?: number;
  /** Minimum recent-window impressions before any verdict is trusted. */
  minImpressions?: number;
}

/** Days in each comparison window (the "week" in week-over-week). */
export const FATIGUE_WINDOW_DAYS = 7;
/** Average daily frequency at/above which delivery is treated as over-served. */
export const FATIGUE_FREQUENCY_THRESHOLD = 3;
/** Week-over-week CTR drop (as a fraction) that signals creative decay. */
export const FATIGUE_CTR_DROP_RATIO = 0.25;
/** Recent-window impressions required before a verdict is trusted. */
export const FATIGUE_MIN_IMPRESSIONS = 1000;

interface WindowAggregate {
  impressions: number;
  frequency: number | null;
  ctr: number | null;
}

/**
 * Decide whether an ad shows creative fatigue.
 *
 * Abstains (returns `{ fatigued: false }` with no reason) when there is not
 * enough history for two full windows, or when the recent window has too few
 * impressions to judge — preferring a false negative over a false positive
 * during cold start.
 */
export function detectCreativeFatigue(
  history: AdMetricsHistoryRow[],
  options: DetectCreativeFatigueOptions = {},
): CreativeFatigueResult {
  const windowDays = options.windowDays ?? FATIGUE_WINDOW_DAYS;
  const frequencyThreshold = options.frequencyThreshold ?? FATIGUE_FREQUENCY_THRESHOLD;
  const ctrDropRatio = options.ctrDropRatio ?? FATIGUE_CTR_DROP_RATIO;
  const minImpressions = options.minImpressions ?? FATIGUE_MIN_IMPRESSIONS;

  // Newest last, so the tail is the most recent window regardless of input order.
  const ordered = [...history].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  if (ordered.length < windowDays * 2) {
    return { fatigued: false };
  }

  const recentRows = ordered.slice(-windowDays);
  const priorRows = ordered.slice(-windowDays * 2, -windowDays);

  const recent = aggregateWindow(recentRows);
  const prior = aggregateWindow(priorRows);

  // Cold-start guard: too little delivery to trust any signal.
  if (recent.impressions < minImpressions) {
    return { fatigued: false };
  }

  if (recent.frequency !== null && recent.frequency >= frequencyThreshold) {
    return {
      fatigued: true,
      reason:
        `Creative fatigue: average frequency reached ${recent.frequency.toFixed(1)} ` +
        `(threshold ${frequencyThreshold}) over the last ${windowDays} days, so the same people are seeing this ad repeatedly.`,
    };
  }

  if (prior.ctr !== null && prior.ctr > 0 && recent.ctr !== null) {
    const drop = (prior.ctr - recent.ctr) / prior.ctr;
    if (drop >= ctrDropRatio) {
      return {
        fatigued: true,
        reason:
          `Creative fatigue: click-through rate fell ${(drop * 100).toFixed(0)}% week-over-week ` +
          `(from ${prior.ctr.toFixed(2)}% to ${recent.ctr.toFixed(2)}%), so the creative is losing relevance.`,
      };
    }
  }

  return { fatigued: false };
}

/**
 * Aggregate a window of daily rows. Frequency uses the peak day (a single
 * over-served day is enough to fatigue an audience); CTR is impression-weighted
 * across the window so heavier days dominate.
 */
function aggregateWindow(rows: AdMetricsHistoryRow[]): WindowAggregate {
  let impressions = 0;
  let weightedClicks = 0;
  let maxFrequency: number | null = null;

  for (const row of rows) {
    const rowImpressions = numeric(row.impressions);
    impressions += rowImpressions;

    const rowFrequency = nullableNumeric(row.frequency);
    if (rowFrequency !== null) {
      maxFrequency = maxFrequency === null ? rowFrequency : Math.max(maxFrequency, rowFrequency);
    }

    const rowCtr = nullableNumeric(row.ctr);
    if (rowCtr !== null) {
      // CTR is a percentage; recover the implied click count to weight by volume.
      weightedClicks += (rowCtr / 100) * rowImpressions;
    }
  }

  const ctr = impressions > 0 ? (weightedClicks / impressions) * 100 : null;
  return { impressions, frequency: maxFrequency, ctr };
}

function numeric(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumeric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
