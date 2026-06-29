/**
 * Tests for analytics aggregation pure functions.
 * Covers: aggregateByPlatform, aggregateByContentType, computeBestTimeSlots,
 *         computeEngagementRate, describeEmptyReason
 */

import { describe, it, expect } from 'vitest';

import {
  aggregateByPlatform,
  aggregateByContentType,
  computeBestTimeSlots,
  computeEngagementRate,
  describeEmptyReason,
} from './aggregations';
import type { PostAnalytics } from './types';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makePost(overrides: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    publishJobId: 'job-1',
    platform: 'facebook',
    impressions: 1000,
    reach: 800,
    engagementCount: 50,
    engagementRate: 0.05,
    clicks: 20,
    shares: 10,
    comments: 5,
    snapshotDate: '2026-05-01',
    contentItemId: 'ci-1',
    contentType: 'instant_post',
    scheduledFor: '2026-05-01T12:00:00+01:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeEngagementRate
// ---------------------------------------------------------------------------

describe('computeEngagementRate', () => {
  it('should return engagement_count / impressions as decimal', () => {
    expect(computeEngagementRate(50, 1000)).toBeCloseTo(0.05);
  });

  it('should return null when impressions is 0', () => {
    expect(computeEngagementRate(10, 0)).toBeNull();
  });

  it('should handle zero engagement count', () => {
    expect(computeEngagementRate(0, 500)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateByPlatform
// ---------------------------------------------------------------------------

describe('aggregateByPlatform', () => {
  it('should group rows by platform and compute weighted engagement rate', () => {
    const rows: PostAnalytics[] = [
      makePost({ platform: 'facebook', impressions: 1000, engagementCount: 50 }),
      makePost({ platform: 'facebook', impressions: 2000, engagementCount: 100, publishJobId: 'job-2' }),
      makePost({ platform: 'instagram', impressions: 500, engagementCount: 75, publishJobId: 'job-3' }),
    ];

    const result = aggregateByPlatform(rows);

    const fb = result.find(r => r.platform === 'facebook');
    expect(fb).toBeDefined();
    expect(fb!.totalImpressions).toBe(3000);
    expect(fb!.totalEngagement).toBe(150);
    expect(fb!.weightedEngagementRate).toBeCloseTo(150 / 3000);
    expect(fb!.postCount).toBe(2);

    const ig = result.find(r => r.platform === 'instagram');
    expect(ig).toBeDefined();
    expect(ig!.totalImpressions).toBe(500);
    expect(ig!.totalEngagement).toBe(75);
    expect(ig!.weightedEngagementRate).toBeCloseTo(75 / 500);
    expect(ig!.postCount).toBe(1);
  });

  it('should return empty array for empty input', () => {
    expect(aggregateByPlatform([])).toEqual([]);
  });

  it('should handle null impressions/engagement by treating as zero', () => {
    const rows: PostAnalytics[] = [
      makePost({ platform: 'instagram', impressions: null, engagementCount: null }),
    ];

    const result = aggregateByPlatform(rows);
    const ig = result.find(r => r.platform === 'instagram');
    expect(ig).toBeDefined();
    expect(ig!.totalImpressions).toBe(0);
    expect(ig!.totalEngagement).toBe(0);
    expect(ig!.weightedEngagementRate).toBe(0);
    expect(ig!.postCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// aggregateByContentType
// ---------------------------------------------------------------------------

describe('aggregateByContentType', () => {
  it('should group rows by content type and compute weighted engagement rate', () => {
    const rows: PostAnalytics[] = [
      makePost({ contentType: 'instant_post', impressions: 1000, engagementCount: 50 }),
      makePost({ contentType: 'instant_post', impressions: 500, engagementCount: 25, publishJobId: 'job-2' }),
      makePost({ contentType: 'event', impressions: 2000, engagementCount: 200, publishJobId: 'job-3' }),
    ];

    const result = aggregateByContentType(rows);

    const instant = result.find(r => r.contentType === 'instant_post');
    expect(instant).toBeDefined();
    expect(instant!.totalImpressions).toBe(1500);
    expect(instant!.totalEngagement).toBe(75);
    expect(instant!.weightedEngagementRate).toBeCloseTo(75 / 1500);
    expect(instant!.postCount).toBe(2);

    const event = result.find(r => r.contentType === 'event');
    expect(event).toBeDefined();
    expect(event!.totalImpressions).toBe(2000);
    expect(event!.totalEngagement).toBe(200);
    expect(event!.weightedEngagementRate).toBeCloseTo(200 / 2000);
    expect(event!.postCount).toBe(1);
  });

  it('should return empty array for empty input', () => {
    expect(aggregateByContentType([])).toEqual([]);
  });

  it('should handle rows with null contentType by grouping under "unknown"', () => {
    const rows: PostAnalytics[] = [
      makePost({ contentType: null, impressions: 100, engagementCount: 10 }),
    ];

    const result = aggregateByContentType(rows);
    expect(result).toHaveLength(1);
    expect(result[0].contentType).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// computeBestTimeSlots
// ---------------------------------------------------------------------------

describe('computeBestTimeSlots', () => {
  it('should identify top 5 time slots sorted by avg engagement rate desc', () => {
    // Create items across different days/hours in Europe/London
    const items = [
      // Monday 12:00 -- 2 posts, avg 0.08
      { scheduledFor: '2026-05-04T12:00:00+01:00', engagementRate: 0.06 },
      { scheduledFor: '2026-05-11T12:00:00+01:00', engagementRate: 0.10 },
      // Tuesday 14:00 -- 1 post, avg 0.12
      { scheduledFor: '2026-05-05T14:00:00+01:00', engagementRate: 0.12 },
      // Wednesday 09:00 -- 1 post, avg 0.04
      { scheduledFor: '2026-05-06T09:00:00+01:00', engagementRate: 0.04 },
      // Thursday 18:00 -- 1 post, avg 0.15
      { scheduledFor: '2026-05-07T18:00:00+01:00', engagementRate: 0.15 },
      // Friday 10:00 -- 1 post, avg 0.03
      { scheduledFor: '2026-05-08T10:00:00+01:00', engagementRate: 0.03 },
      // Saturday 20:00 -- 1 post, avg 0.20
      { scheduledFor: '2026-05-09T20:00:00+01:00', engagementRate: 0.20 },
    ];

    const result = computeBestTimeSlots(items);

    expect(result).toHaveLength(5);
    // Sorted desc by avgEngagementRate
    expect(result[0].avgEngagementRate).toBeCloseTo(0.20);
    expect(result[1].avgEngagementRate).toBeCloseTo(0.15);
    expect(result[2].avgEngagementRate).toBeCloseTo(0.12);
  });

  it('should return fewer than 5 if not enough slots', () => {
    const items = [
      { scheduledFor: '2026-05-04T12:00:00+01:00', engagementRate: 0.05 },
    ];

    const result = computeBestTimeSlots(items);
    expect(result).toHaveLength(1);
  });

  it('should return empty array for empty input', () => {
    expect(computeBestTimeSlots([])).toEqual([]);
  });

  it('should skip items with null engagement rate', () => {
    const items = [
      { scheduledFor: '2026-05-04T12:00:00+01:00', engagementRate: null },
      { scheduledFor: '2026-05-05T14:00:00+01:00', engagementRate: 0.10 },
    ];

    const result = computeBestTimeSlots(items);
    expect(result).toHaveLength(1);
    expect(result[0].avgEngagementRate).toBeCloseTo(0.10);
  });
});

// ---------------------------------------------------------------------------
// describeEmptyReason
// ---------------------------------------------------------------------------

describe('describeEmptyReason', () => {
  it('should return "no_published_content" when zero publish jobs exist', () => {
    expect(describeEmptyReason({ publishJobCount: 0, snapshotCount: 0 })).toBe('no_published_content');
  });

  it('should return "no_metrics_yet" when publish jobs exist but snapshots empty', () => {
    expect(describeEmptyReason({ publishJobCount: 5, snapshotCount: 0 })).toBe('no_metrics_yet');
  });

  it('should return "platform_not_connected" when not connected', () => {
    expect(
      describeEmptyReason({ publishJobCount: 0, snapshotCount: 0, isConnected: false }),
    ).toBe('platform_not_connected');
  });

  it('should return null when data is present', () => {
    expect(describeEmptyReason({ publishJobCount: 5, snapshotCount: 10 })).toBeNull();
  });
});
