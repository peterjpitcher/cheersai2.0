'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ImagePlus } from 'lucide-react';

import { MediaPicker } from '@/features/create/media/media-picker';
import { CarouselUploader, type CarouselImage } from '@/features/create/carousel-uploader';
import { attachMediaToContent } from '@/app/actions/media';
import type { MediaAssetSummary } from '@/lib/library/data';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MediaStepProps {
  contentId: string | null;
  selectedMediaIds: string[];
  onMediaChange: (ids: string[]) => void;
  accountId: string;
  campaignName?: string;
  libraryItems?: MediaAssetSummary[];
  platforms?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 3: Media attachment.
 *
 * Wraps the MediaPicker component for the create wizard. Persists media
 * attachments via attachMediaToContent when the step is left (unmount).
 */
export function MediaStep({
  contentId,
  selectedMediaIds,
  onMediaChange,
  accountId,
  campaignName,
  libraryItems = [],
  platforms = [],
}: MediaStepProps): React.JSX.Element {
  // Track latest selection for cleanup on unmount
  const selectionRef = useRef(selectedMediaIds);
  const contentIdRef = useRef(contentId);

  useEffect(() => {
    selectionRef.current = selectedMediaIds;
  }, [selectedMediaIds]);

  useEffect(() => {
    contentIdRef.current = contentId;
  }, [contentId]);

  // Persist media attachments when step is left (unmount)
  useEffect(() => {
    return () => {
      const ids = selectionRef.current;
      const cid = contentIdRef.current;
      if (cid && ids.length > 0) {
        void attachMediaToContent(cid, ids).then((result) => {
          if (result.error) {
            console.error('[media-step] attach failed:', result.error);
          }
        });
      }
    };
  }, []);

  const handleMediaChange = useCallback(
    (ids: string[]) => {
      onMediaChange(ids);
    },
    [onMediaChange],
  );

  // Show helpful empty state if no account ID
  if (!accountId) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full bg-muted p-4">
          <ImagePlus className="size-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Media Library</h3>
          <p className="text-sm text-muted-foreground">
            Unable to load media library. Please try refreshing the page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Attach Media</h3>
        <p className="text-sm text-muted-foreground">
          Add images or graphics to your content. Upload new files or select from your media library.
        </p>
      </div>

      <MediaPicker
        selectedMediaIds={selectedMediaIds}
        onMediaChange={handleMediaChange}
        campaignName={campaignName}
        accountId={accountId}
        libraryItems={libraryItems}
      />

      {platforms.includes('instagram') && selectedMediaIds.length >= 2 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Instagram Carousel Order</h4>
          <p className="text-xs text-muted-foreground">
            Drag to reorder images for your Instagram carousel post.
          </p>
          <CarouselUploader
            images={selectedMediaIds.map((id) => ({ id, url: '' }))}
            onChange={(imgs: CarouselImage[]) => onMediaChange(imgs.map((img) => img.id))}
            maxImages={10}
          />
        </div>
      )}

      {selectedMediaIds.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {selectedMediaIds.length} item{selectedMediaIds.length === 1 ? '' : 's'} selected.
          Media will be saved when you proceed to the next step.
        </p>
      )}
    </div>
  );
}
