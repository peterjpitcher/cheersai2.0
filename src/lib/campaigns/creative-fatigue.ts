/**
 * Creative-fatigue detection (Phase 3, 3d).
 *
 * Pure, deterministic analysis of an ad's snapshot history from the
 * `ad_metrics_history` table. Each row is a CUMULATIVE campaign-lifetime
 * snapshot (performance-sync upserts the lifetime impressions/clicks/ctr/
 * frequency once per Europe/London day), NOT a daily figure — so windows are
 * compared via DELTAS between boundary snapshots (WF-1):
 *
 * - CTR arm (weekly deltas): recent window = latest snapshot minus the snapshot
 *   nearest the t−7d boundary; prior window = that boundary minus the snapshot
 *   nearest t−14d. Fatigue = recent delta-CTR dropping ≥ `ctrDropRatio` vs the
 *   prior delta-CTR, guarded by the RECENT WEEK's delta impressions reaching
 *   `minImpressions` (WF-6: the guard counts weekly, not lifetime, volume).
 * - Frequency arm (lifetime): Meta's frequency metric is itself cumulative
 *   (lifetime impressions / lifetime reach), so the latest snapshot's LIFETIME
 *   frequency reaching `frequencyThreshold` is used as-is — Meta's own
 *   cumulative-frequency heuristic — guarded by lifetime impressions reaching
 *   `minImpressions`.
 *
 * Abstains (no verdict) when boundary snapshots are missing, either window has
 * fewer than `minCoverageDays` distinct capture dates, or cumulative totals go
 * backwards (restated data) — preferring a false negative over a false positive.
 *
 * It never decides to pause anything: callers surface a warning only.
 */

/** One daily snapshot of CUMULATIVE lifetime metrics for a single ad. camelCase mirror of the DB row. */
export interface AdMetricsHistoryRow {
  adId: string;
  /** Europe/London calendar date, ISO `YYYY-MM-DD`. */
  capturedOn: string;
  /** Lifetime impressions at capture time. */
  impressions: number | null;
  /** Lifetime clicks at capture time. */
  clicks: number | null;
  /** Lifetime CTR (%) at capture time. */
  ctr: number | null;
  /** Lifetime frequency (impressions / reach) at capture time. */
  frequency: number | null;
  /** Lifetime spend at capture time. */
  spend: number | null;
}

export interface CreativeFatigueResult {
  fatigued: boolean;
  reason?: string;
}

export interface DetectCreativeFatigueOptions {
  /** Days per comparison window (recent vs prior). */
  windowDays?: number;
  /** Lifetime frequency at/above which an ad is considered over-served. */
  frequencyThreshold?: number;
  /** Fractional week-over-week delta-CTR drop that signals decay (0.25 = 25%). */
  ctrDropRatio?: number;
  /** Minimum impressions (weekly delta for the CTR arm, lifetime for the frequency arm). */
  minImpressions?: number;
  /** Minimum distinct capture dates required inside each window. */
  minCoverageDays?: number;
}

/** Days in each comparison window (the "week" in week-over-week). */
export const FATIGUE_WINDOW_DAYS = 7;
/** Lifetime frequency at/above which delivery is treated as over-served. */
export const FATIGUE_FREQUENCY_THRESHOLD = 3;
/** Week-over-week delta-CTR drop (as a fraction) that signals creative decay. */
export const FATIGUE_CTR_DROP_RATIO = 0.25;
/** Impressions required before a verdict is trusted (weekly delta for CTR, lifetime for frequency). */
export const FATIGUE_MIN_IMPRESSIONS = 1000;
/** Distinct capture dates required per window before deltas are trusted. */
export const FATIGUE_MIN_COVERAGE_DAYS = 5;

/**
 * Decide whether an ad shows creative fatigue from its cumulative snapshot history.
 * See the module docblock for the delta/lifetime semantics of each arm.
 */
export function detectCreativeFatigue(
  history: AdMetricsHistoryRow[],
  options: DetectCreativeFatigueOptions = {},
): CreativeFatigueResult {
  const windowDays = options.windowDays ?? FATIGUE_WINDOW_DAYS;
  const frequencyThreshold = options.frequencyThreshold ?? FATIGUE_FREQUENCY_THRESHOLD;
  const ctrDropRatio = options.ctrDropRatio ?? FATIGUE_CTR_DROP_RATIO;
  const minImpressions = options.minImpressions ?? FATIGUE_MIN_IMPRESSIONS;
  const minCoverageDays = options.minCoverageDays ?? FATIGUE_MIN_COVERAGE_DAYS;

  // One snapshot per capture date (last write wins), oldest first.
  const byDate = new Map<string, AdMetricsHistoryRow>();
  for (const row of [...history].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn))) {
    byDate.set(row.capturedOn, row);
  }
  const snapshots = Array.from(byDate.values());
  if (snapshots.length === 0) return { fatigued: false };

  const latest = snapshots[snapshots.length - 1]!;
  const recentBoundary = nearestSnapshot(snapshots, addDays(latest.capturedOn, -windowDays));
  const priorBoundary = nearestSnapshot(snapshots, addDays(latest.capturedOn, -windowDays * 2));

  // Boundary snapshots must exist and be strictly ordered, else the windows collapse.
  if (!recentBoundary || !priorBoundary) return { fatigued: false };
  if (!(priorBoundary.capturedOn < recentBoundary.capturedOn && recentBoundary.capturedOn < latest.capturedOn)) {
    return { fatigued: false };
  }

  // Coverage gate: too many missed nightly syncs make either window untrustworthy.
  const recentCoverage = countCaptureDates(snapshots, recentBoundary.capturedOn, latest.capturedOn);
  const priorCoverage = countCaptureDates(snapshots, priorBoundary.capturedOn, recentBoundary.capturedOn);
  if (recentCoverage < minCoverageDays || priorCoverage < minCoverageDays) {
    return { fatigued: false };
  }

  // Frequency arm: Meta's frequency is already cumulative, so the latest LIFETIME value is used directly.
  const lifetimeFrequency = nullableNumeric(latest.frequency);
  const lifetimeImpressions = numeric(latest.impressions);
  if (lifetimeFrequency !== null && lifetimeFrequency >= frequencyThreshold && lifetimeImpressions >= minImpressions) {
    return {
      fatigued: true,
      reason:
        `Creative fatigue: lifetime frequency reached ${lifetimeFrequency.toFixed(1)} ` +
        `(threshold ${frequencyThreshold}), so the same people are seeing this ad repeatedly.`,
    };
  }

  // CTR arm: week-over-week comparison of DELTA delivery between boundary snapshots.
  const recentImpressions = delta(latest.impressions, recentBoundary.impressions);
  const recentClicks = delta(latest.clicks, recentBoundary.clicks);
  const priorImpressions = delta(recentBoundary.impressions, priorBoundary.impressions);
  const priorClicks = delta(recentBoundary.clicks, priorBoundary.clicks);
  if (recentImpressions === null || recentClicks === null || priorImpressions === null || priorClicks === null) {
    return { fatigued: false };
  }
  // Negative deltas mean Meta restated lifetime totals; nothing here can be trusted.
  if (recentImpressions < 0 || recentClicks < 0 || priorImpressions < 0 || priorClicks < 0) {
    return { fatigued: false };
  }
  // WF-6: the cold-start guard counts the recent week's NEW impressions, not lifetime totals.
  if (recentImpressions < minImpressions || priorImpressions <= 0) {
    return { fatigued: false };
  }

  const priorCtr = (priorClicks / priorImpressions) * 100;
  const recentCtr = (recentClicks / recentImpressions) * 100;
  if (priorCtr > 0) {
    const drop = (priorCtr - recentCtr) / priorCtr;
    if (drop >= ctrDropRatio) {
      return {
        fatigued: true,
        reason:
          `Creative fatigue: click-through rate fell ${(drop * 100).toFixed(0)}% week-over-week ` +
          `(from ${priorCtr.toFixed(2)}% to ${recentCtr.toFixed(2)}%), so the creative is losing relevance.`,
      };
    }
  }

  return { fatigued: false };
}

/** Snapshot whose capture date is nearest the target date; ties prefer the earlier snapshot. */
function nearestSnapshot(snapshots: AdMetricsHistoryRow[], targetDate: string): AdMetricsHistoryRow | null {
  let best: AdMetricsHistoryRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const snapshot of snapshots) {
    const distance = Math.abs(dayNumber(snapshot.capturedOn) - dayNumber(targetDate));
    if (distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }

  return best;
}

/** Distinct capture dates in (startExclusive, endInclusive]. */
function countCaptureDates(snapshots: AdMetricsHistoryRow[], startExclusive: string, endInclusive: string): number {
  return snapshots.filter((row) => row.capturedOn > startExclusive && row.capturedOn <= endInclusive).length;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayNumber(isoDate: string): number {
  return Math.round(new Date(`${isoDate}T00:00:00.000Z`).getTime() / 86_400_000);
}

/** Difference between two cumulative values; null when either side is missing. */
function delta(later: number | null | undefined, earlier: number | null | undefined): number | null {
  const a = nullableNumeric(later);
  const b = nullableNumeric(earlier);
  if (a === null || b === null) return null;
  return a - b;
}

function numeric(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumeric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
