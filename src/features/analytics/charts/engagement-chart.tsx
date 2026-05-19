'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import type { PostAnalytics } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// Engagement over time bar chart
// ---------------------------------------------------------------------------

/** Platform colour mapping -- matches globals.css design tokens */
const PLATFORM_COLOURS: Record<string, string> = {
  facebook: '#1B4DB1',
  instagram: '#B72A6B',
  gbp: '#1C7C43',
};

interface EngagementChartProps {
  data: PostAnalytics[];
  loading?: boolean;
}

interface ChartDataPoint {
  date: string;
  engagementRate: number;
  impressions: number;
  engagement: number;
  platform: string;
}

function prepareData(posts: PostAnalytics[]): ChartDataPoint[] {
  return posts
    .filter((p) => p.snapshotDate && p.engagementRate !== null)
    .map((p) => ({
      date: p.snapshotDate.slice(0, 10),
      engagementRate: Math.round((p.engagementRate ?? 0) * 10000) / 100,
      impressions: p.impressions ?? 0,
      engagement: p.engagementCount ?? 0,
      platform: p.platform,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bar chart showing engagement rate per post over time.
 * Tooltip shows impressions and engagement count.
 */
export function EngagementChart({ data, loading }: EngagementChartProps) {
  if (loading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  const chartData = prepareData(data);

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload as ChartDataPoint | undefined;
            if (!d) return null;
            return (
              <div className="rounded-lg border border-border bg-popover p-3 shadow-md">
                <p className="text-xs font-medium text-foreground">{d.date}</p>
                <p className="text-xs text-muted-foreground">
                  Platform: {d.platform}
                </p>
                <p className="text-xs text-muted-foreground">
                  Impressions: {d.impressions.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Engagement: {d.engagement.toLocaleString()}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  Rate: {d.engagementRate}%
                </p>
              </div>
            );
          }}
        />
        <Bar
          dataKey="engagementRate"
          radius={[4, 4, 0, 0]}
          fill="#1B4DB1"
          name="Engagement Rate"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
