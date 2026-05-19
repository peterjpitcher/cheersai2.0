'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformEngagement } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// Platform comparison grouped bar chart (ANLY-03)
// ---------------------------------------------------------------------------

interface PlatformComparisonChartProps {
  data: PlatformEngagement[];
  loading?: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business',
};

interface ChartDataPoint {
  platform: string;
  impressions: number;
  engagement: number;
  rate: string;
}

function prepareData(data: PlatformEngagement[]): ChartDataPoint[] {
  return data.map((d) => ({
    platform: PLATFORM_LABELS[d.platform] ?? d.platform,
    impressions: d.totalImpressions,
    engagement: d.totalEngagement,
    rate: `${(d.weightedEngagementRate * 100).toFixed(1)}%`,
  }));
}

/**
 * Grouped bar chart comparing impressions and engagement across platforms.
 * Shows weighted engagement rate as a label.
 */
export function PlatformComparisonChart({ data, loading }: PlatformComparisonChartProps) {
  if (loading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  const chartData = prepareData(data);

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="platform"
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload as ChartDataPoint | undefined;
            if (!d) return null;
            return (
              <div className="rounded-lg border border-border bg-popover p-3 shadow-md">
                <p className="text-sm font-medium text-foreground">{d.platform}</p>
                <p className="text-xs text-muted-foreground">
                  Impressions: {d.impressions.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Engagement: {d.engagement.toLocaleString()}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  Rate: {d.rate}
                </p>
              </div>
            );
          }}
        />
        <Legend />
        <Bar
          dataKey="impressions"
          fill="#1B4DB1"
          radius={[4, 4, 0, 0]}
          name="Impressions"
        />
        <Bar
          dataKey="engagement"
          fill="#1C7C43"
          radius={[4, 4, 0, 0]}
          name="Engagement"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
