import { Suspense } from 'react';

import { MediaAssetGrid } from '@/features/library/media-asset-grid';
import { Skeleton } from '@/components/ui/skeleton';

export default function LibraryPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10">
      <Suspense fallback={<LibraryPageSkeleton />}>
        <MediaAssetGrid />
      </Suspense>
    </div>
  );
}

function LibraryPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-12 rounded bg-[var(--c-paper-2)]" />
        <Skeleton className="h-7 w-32 rounded bg-[var(--c-paper-2)]" />
        <Skeleton className="h-4 w-64 rounded bg-[var(--c-paper-2)]" />
      </div>

      {/* Filter bar skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-[30px] w-48 rounded-md bg-[var(--c-paper-2)]" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {/* Upload tile skeleton */}
        <div
          className="flex min-h-[220px] items-center justify-center rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)]"
          style={{ background: 'transparent' }}
        >
          <Skeleton className="h-8 w-24 rounded bg-[var(--c-paper-2)]" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--c-line)] bg-[var(--c-card)]"
          >
            <Skeleton className="aspect-square w-full bg-[var(--c-paper-2)]" />
            <div className="space-y-1.5 p-2 pb-2.5">
              <Skeleton className="h-3.5 w-3/4 rounded bg-[var(--c-paper-2)]" />
              <Skeleton className="h-2.5 w-1/2 rounded bg-[var(--c-paper-2)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
