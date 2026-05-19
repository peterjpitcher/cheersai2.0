/**
 * Analytics domain types shared across queries and UI.
 * Used by aggregation helpers, query functions, and the analytics dashboard.
 */

/** ISO date range filter for analytics queries */
export interface DateRange {
  start: string;
  end: string;
}

/** Per-post analytics snapshot with joined content metadata */
export interface PostAnalytics {
  publishJobId: string;
  platform: 'facebook' | 'instagram' | 'gbp';
  impressions: number | null;
  reach: number | null;
  engagementCount: number | null;
  engagementRate: number | null;
  clicks: number | null;
  shares: number | null;
  comments: number | null;
  snapshotDate: string;
  contentItemId: string | null;
  contentType: string | null;
  scheduledFor: string | null;
}

/** Aggregated engagement metrics per platform */
export interface PlatformEngagement {
  platform: 'facebook' | 'instagram' | 'gbp';
  totalImpressions: number;
  totalEngagement: number;
  weightedEngagementRate: number;
  postCount: number;
}

/** Aggregated engagement metrics per content type */
export interface ContentTypePerformance {
  contentType: string;
  totalImpressions: number;
  totalEngagement: number;
  weightedEngagementRate: number;
  postCount: number;
}

/** Best-performing day-of-week + hour slot */
export interface BestTimeSlot {
  dayOfWeek: number;
  hour: number;
  avgEngagementRate: number;
  postCount: number;
}

/** GBP location-level daily metrics */
export interface GbpLocationMetrics {
  metricDate: string;
  searchViews: number | null;
  mapViews: number | null;
  websiteClicks: number | null;
  directionRequests: number | null;
  phoneCalls: number | null;
}

/** Descriptive reason when analytics data is empty or unavailable */
export type AnalyticsEmptyReason =
  | 'no_published_content'
  | 'no_metrics_yet'
  | 'gbp_data_delayed'
  | 'platform_not_connected'
  | null;
