'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import type { GbpLocationMetrics } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// GBP location metrics line chart (ANLY-05)
// ---------------------------------------------------------------------------

interface GbpMetricsChartProps {
  data: GbpLocationMetrics[];
  loading?: boolean;
}

/** Metric line configuration */
const METRIC_LINES: Array<{
  dataKey: keyof GbpLocationMetrics;
  name: string;
  colour: string;
}> = [
  { dataKey: 'searchViews', name: 'Search Views', colour: '#1B4DB1' },
  { dataKey: 'mapViews', name: 'Map Views', colour: '#1C7C43' },
  { dataKey: 'websiteClicks', name: 'Website Clicks', colour: '#B72A6B' },
  { dataKey: 'directionRequests', name: 'Direction Requests', colour: '#D97706' },
  { dataKey: 'phoneCalls', name: 'Phone Calls', colour: '#7C3AED' },
];

interface ChartDataPoint {
  date: string;
  searchViews: number;
  mapViews: number;
  websiteClicks: number;
  directionRequests: number;
  phoneCalls: number;
}

function prepareData(data: GbpLocationMetrics[]): ChartDataPoint[] {
  return data.map((d) => ({
    date: formatDateLabel(d.metricDate),
    searchViews: d.searchViews ?? 0,
    mapViews: d.mapViews ?? 0,
    websiteClicks: d.websiteClicks ?? 0,
    directionRequests: d.directionRequests ?? 0,
    phoneCalls: d.phoneCalls ?? 0,
  }));
}

/** Format ISO date to "DD MMM" (e.g., "15 May") */
function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * Multi-line chart showing GBP location metrics over time.
 * Lines: searchViews, mapViews, websiteClicks, directionRequests, phoneCalls.
 */
export function GbpMetricsChart({ data, loading }: GbpMetricsChartProps) {
  if (loading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  const chartData = prepareData(data);

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid hsl(var(--border))',
            backgroundColor: 'hsl(var(--popover))',
          }}
        />
        <Legend />
        {METRIC_LINES.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.colour}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
