import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsDashboard } from '@/features/analytics/analytics-dashboard';

export const metadata: Metadata = {
  title: 'Analytics | CheersAI',
};

/** Force dynamic rendering -- analytics shows personalised data */
export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  return (
    <div className="flex h-full flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Track your content performance across all platforms."
      />

      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20 rounded-lg" />
        <Skeleton className="h-9 w-20 rounded-lg" />
        <Skeleton className="h-9 w-20 rounded-lg" />
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
