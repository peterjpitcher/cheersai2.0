'use client';

import { Eye, MousePointerClick, Percent, FileText, Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

// ---------------------------------------------------------------------------
// Summary metric cards for analytics overview
// ---------------------------------------------------------------------------

interface PostPerformanceCardProps {
  impressions: number;
  /** People reached; null until Meta has returned reach for at least one post. */
  reach: number | null;
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
  return n.toLocaleString("en-GB");
}

/**
 * Renders the summary metric cards in a responsive grid.
 */
export function PostPerformanceCard({
  impressions,
  reach,
  engagementRate,
  clicks,
  postCount,
}: PostPerformanceCardProps) {
  const metrics: MetricCardData[] = [
    {
      label: 'Views',
      value: formatNumber(impressions),
      icon: Eye,
    },
    {
      label: 'People reached',
      value: reach === null ? 'Not yet' : formatNumber(reach),
      icon: Users,
    },
    {
      label: 'Engagement rate',
      value: `${(engagementRate * 100).toFixed(1)}%`,
      icon: Percent,
    },
    {
      label: 'Link clicks',
      value: formatNumber(clicks),
      icon: MousePointerClick,
    },
    {
      label: 'Posts published',
      value: formatNumber(postCount),
      icon: FileText,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
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
