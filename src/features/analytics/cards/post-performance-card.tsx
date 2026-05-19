'use client';

import { Eye, MousePointerClick, Percent, FileText } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

// ---------------------------------------------------------------------------
// Summary metric cards for analytics overview
// ---------------------------------------------------------------------------

interface PostPerformanceCardProps {
  impressions: number;
  engagementRate: number;
  clicks: number;
  postCount: number;
}

interface MetricCardData {
  label: string;
  value: string;
  icon: typeof Eye;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Renders 4 summary metric cards in a responsive 2x2 / 4x1 grid.
 */
export function PostPerformanceCard({
  impressions,
  engagementRate,
  clicks,
  postCount,
}: PostPerformanceCardProps) {
  const metrics: MetricCardData[] = [
    {
      label: 'Total Impressions',
      value: formatNumber(impressions),
      icon: Eye,
    },
    {
      label: 'Engagement Rate',
      value: `${(engagementRate * 100).toFixed(1)}%`,
      icon: Percent,
    },
    {
      label: 'Total Clicks',
      value: formatNumber(clicks),
      icon: MousePointerClick,
    },
    {
      label: 'Posts Published',
      value: formatNumber(postCount),
      icon: FileText,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-muted p-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{metric.value}</p>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
