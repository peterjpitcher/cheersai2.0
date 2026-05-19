import { Suspense } from 'react';

import { MediaAssetGrid } from '@/features/library/media-asset-grid';
import { ReprocessButton } from '@/features/library/reprocess-button';
import { UploadPanel } from '@/features/library/upload-panel';
import { PageHeader } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6 h-full">
      <PageHeader
        title="Media Library"
        description="Upload media assets, manage drafts, and prep prompt presets to reuse across campaigns."
      />

      <div className="rounded-xl border border-border bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.07),0_1px_2px_-1px_rgb(0_0_0/0.05)] p-4 md:p-6 space-y-8">
        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Upload media</h3>
            <p className="text-sm text-muted-foreground">
              Keep your brand assets together so posts and campaigns can reuse them quickly.
            </p>
          </div>
          <UploadPanel />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">Recent uploads</h3>
              <p className="text-sm text-muted-foreground">Preview what&apos;s available before you attach it to a campaign.</p>
            </div>
            <ReprocessButton />
          </div>
          <Suspense fallback={<LibraryGridSkeleton />}>
            <MediaAssetGrid />
          </Suspense>
        </section>
      </div>
    </div>
  );
}

function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border bg-card p-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
