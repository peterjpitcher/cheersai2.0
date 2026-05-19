'use client';

import { useState, useMemo } from 'react';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { describeEmptyReason } from '@/lib/analytics/aggregations';
import type { DateRange } from '@/lib/analytics/types';

import { useAnalyticsData, usePlatformComparison, useContentTypeComparison, useBestTimes } from './hooks/use-analytics-data';
import { useGbpMetrics } from './hooks/use-gbp-metrics';
import { EmptyAnalyticsState } from './cards/empty-analytics-state';
import { PostPerformanceCard } from './cards/post-performance-card';
import { EngagementChart } from './charts/engagement-chart';
import { PlatformComparisonChart } from './charts/platform-comparison';
import { BestTimeHeatmap } from './charts/best-time-heatmap';
import { GbpMetricsChart } from './charts/gbp-metrics-chart';

// ---------------------------------------------------------------------------
// Date range presets
// ---------------------------------------------------------------------------

type RangePreset = '7d' | '30d' | '90d';

function buildDateRange(preset: RangePreset): DateRange {
  const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  return {
    start: now.minus({ days }).toISODate()!,
    end: now.toISODate()!,
  };
}

const RANGE_OPTIONS: Array<{ label: string; value: RangePreset }> = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

// ---------------------------------------------------------------------------
// Dashboard component
// ---------------------------------------------------------------------------

/**
 * Analytics dashboard with 5 tabbed views:
 * 1. Overview - summary cards + engagement chart
 * 2. By Platform - platform comparison bar chart (ANLY-03)
 * 3. By Content Type - content type comparison (ANLY-03)
 * 4. Best Times - 7x24 heatmap (ANLY-04)
 * 5. GBP Metrics - location metrics line chart (ANLY-05)
 *
 * Empty states handled per ANLY-06.
 */
export function AnalyticsDashboard() {
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [activeTab, setActiveTab] = useState('overview');

  const dateRange = useMemo(() => buildDateRange(rangePreset), [rangePreset]);

  // Queries
  const postsQuery = useAnalyticsData(dateRange);
  const platformQuery = usePlatformComparison(dateRange);
  const contentTypeQuery = useContentTypeComparison(dateRange);
  const bestTimesQuery = useBestTimes();
  const gbpQuery = useGbpMetrics(dateRange);

  // Compute summary metrics from posts data
  const summary = useMemo(() => {
    const posts = postsQuery.data ?? [];
    const totalImpressions = posts.reduce((sum, p) => sum + (p.impressions ?? 0), 0);
    const totalEngagement = posts.reduce((sum, p) => sum + (p.engagementCount ?? 0), 0);
    const totalClicks = posts.reduce((sum, p) => sum + (p.clicks ?? 0), 0);
    const engagementRate = totalImpressions > 0 ? totalEngagement / totalImpressions : 0;
    return {
      impressions: totalImpressions,
      engagementRate,
      clicks: totalClicks,
      postCount: posts.length,
    };
  }, [postsQuery.data]);

  // Empty state reason for overview
  const overviewEmptyReason = describeEmptyReason({
    publishJobCount: postsQuery.data?.length ?? 0,
    snapshotCount: postsQuery.data?.filter((p) => p.engagementRate !== null).length ?? 0,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Date range selector */}
      <div className="flex items-center gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setRangePreset(opt.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              rangePreset === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Tabbed views */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="platform">By Platform</TabsTrigger>
          <TabsTrigger value="content-type">By Content Type</TabsTrigger>
          <TabsTrigger value="best-times">Best Times</TabsTrigger>
          <TabsTrigger value="gbp">GBP Metrics</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview">
          {overviewEmptyReason ? (
            <EmptyAnalyticsState reason={overviewEmptyReason} />
          ) : (
            <div className="flex flex-col gap-6">
              <PostPerformanceCard {...summary} />
              <Card>
                <CardHeader>
                  <CardTitle>Engagement Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <EngagementChart
                    data={postsQuery.data ?? []}
                    loading={postsQuery.isLoading}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* By Platform tab */}
        <TabsContent value="platform">
          {(platformQuery.data?.length ?? 0) === 0 && !platformQuery.isLoading ? (
            <EmptyAnalyticsState
              reason={describeEmptyReason({
                publishJobCount: postsQuery.data?.length ?? 0,
                snapshotCount: platformQuery.data?.length ?? 0,
              })}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Platform Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <PlatformComparisonChart
                  data={platformQuery.data ?? []}
                  loading={platformQuery.isLoading}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* By Content Type tab */}
        <TabsContent value="content-type">
          {(contentTypeQuery.data?.length ?? 0) === 0 && !contentTypeQuery.isLoading ? (
            <EmptyAnalyticsState
              reason={describeEmptyReason({
                publishJobCount: postsQuery.data?.length ?? 0,
                snapshotCount: contentTypeQuery.data?.length ?? 0,
              })}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Content Type Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <PlatformComparisonChart
                  data={contentTypeQuery.data?.map((d) => ({
                    platform: d.contentType as 'facebook',
                    totalImpressions: d.totalImpressions,
                    totalEngagement: d.totalEngagement,
                    weightedEngagementRate: d.weightedEngagementRate,
                    postCount: d.postCount,
                  })) ?? []}
                  loading={contentTypeQuery.isLoading}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Best Times tab */}
        <TabsContent value="best-times">
          {(bestTimesQuery.data?.length ?? 0) === 0 && !bestTimesQuery.isLoading ? (
            <EmptyAnalyticsState
              reason={describeEmptyReason({
                publishJobCount: postsQuery.data?.length ?? 0,
                snapshotCount: bestTimesQuery.data?.length ?? 0,
              })}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Best Posting Times</CardTitle>
              </CardHeader>
              <CardContent>
                <BestTimeHeatmap
                  data={bestTimesQuery.data ?? []}
                  loading={bestTimesQuery.isLoading}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* GBP Metrics tab */}
        <TabsContent value="gbp">
          <div className="flex flex-col gap-4">
            {(gbpQuery.data?.length ?? 0) === 0 && !gbpQuery.isLoading ? (
              <EmptyAnalyticsState
                reason={describeEmptyReason({
                  publishJobCount: postsQuery.data?.length ?? 0,
                  snapshotCount: gbpQuery.data?.length ?? 0,
                  isGbp: true,
                  daysFromNow: 1,
                })}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Google Business Profile Metrics</CardTitle>
                </CardHeader>
                <CardContent>
                  <GbpMetricsChart
                    data={gbpQuery.data ?? []}
                    loading={gbpQuery.isLoading}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
