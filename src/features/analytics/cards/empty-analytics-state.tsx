'use client';

import { BarChart3, Clock, Globe, Unplug } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { AnalyticsEmptyReason } from '@/lib/analytics/types';

// ---------------------------------------------------------------------------
// Empty state component per ANLY-06
// ---------------------------------------------------------------------------

interface EmptyAnalyticsStateProps {
  reason: AnalyticsEmptyReason;
  platform?: string;
}

const EMPTY_STATE_CONFIG: Record<
  Exclude<AnalyticsEmptyReason, null>,
  { icon: typeof BarChart3; title: string; description: string }
> = {
  no_published_content: {
    icon: BarChart3,
    title: 'No content published yet',
    description:
      'Create and publish your first post to start tracking performance.',
  },
  no_metrics_yet: {
    icon: Clock,
    title: 'Metrics on the way',
    description:
      'Your content is published but metrics have not been collected yet. Check back in 24-48 hours.',
  },
  gbp_data_delayed: {
    icon: Globe,
    title: 'GBP data is delayed',
    description:
      'Google Business Profile metrics are typically 2-3 days behind. Recent data will appear soon.',
  },
  platform_not_connected: {
    icon: Unplug,
    title: 'Platform not connected',
    description: 'Connect your {platform} account in Settings to see metrics.',
  },
};

/**
 * Renders an explanatory empty state when analytics data is unavailable.
 * Returns null when reason is null (data is present).
 */
export function EmptyAnalyticsState({ reason, platform }: EmptyAnalyticsStateProps) {
  if (reason === null) return null;

  const config = EMPTY_STATE_CONFIG[reason];
  const Icon = config.icon;
  const description = platform
    ? config.description.replace('{platform}', platform)
    : config.description;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 rounded-full bg-muted p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{config.title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
