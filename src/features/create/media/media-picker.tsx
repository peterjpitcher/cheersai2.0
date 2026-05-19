'use client';

import { GripVertical, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useState } from 'react';

import { MediaUploadPanel } from '@/features/library/media-upload-panel';
import { updateMediaAsset } from '@/app/(app)/library/actions';
import type { MediaAssetSummary } from '@/lib/library/data';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MediaPickerProps {
  /** IDs of currently selected media */
  selectedMediaIds: string[];
  /** Callback when selection changes */
  onMediaChange: (ids: string[]) => void;
  /** Campaign name for auto-tagging uploads (D-13) */
  campaignName?: string;
  /** Current account ID for uploads */
  accountId: string;
  /** Full library items for browse/select */
  libraryItems?: MediaAssetSummary[];
}

// ---------------------------------------------------------------------------
// MediaPicker
// ---------------------------------------------------------------------------

/**
 * Inline media picker for the create wizard (D-12).
 * Wraps MediaUploadPanel with wizard-specific behaviour:
 * - Shows selected media as a reorderable thumbnail strip
 * - Auto-tags new uploads with campaignName if provided (D-13)
 * - Remove button on each selected thumbnail
 */
export function MediaPicker({
  selectedMediaIds,
  onMediaChange,
  campaignName,
  accountId,
  libraryItems = [],
}: MediaPickerProps): React.JSX.Element {
  const [allItems, setAllItems] = useState<MediaAssetSummary[]>(libraryItems);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Find selected items maintaining order
  const selectedItems = selectedMediaIds
    .map((id) => allItems.find((item) => item.id === id))
    .filter((item): item is MediaAssetSummary => item !== undefined);

  // Handle new upload completion -- auto-tag with campaign name
  const handleUploadComplete = useCallback(
    async (item: MediaAssetSummary) => {
      setAllItems((prev) => [item, ...prev]);
      onMediaChange([...selectedMediaIds, item.id]);

      // Auto-tag with campaign name (D-13)
      if (campaignName?.trim()) {
        try {
          await updateMediaAsset({
            assetId: item.id,
            tags: [...item.tags, campaignName.trim()],
          });
        } catch (err) {
          console.error('[media-picker] auto-tag failed', err);
        }
      }
    },
    [selectedMediaIds, onMediaChange, campaignName],
  );

  // Handle selecting from library tab
  const handleLibrarySelect = useCallback(
    (id: string) => {
      if (selectedMediaIds.includes(id)) {
        onMediaChange(selectedMediaIds.filter((mid) => mid !== id));
      } else {
        onMediaChange([...selectedMediaIds, id]);
      }
    },
    [selectedMediaIds, onMediaChange],
  );

  // Remove a selected item
  const handleRemove = useCallback(
    (id: string) => {
      onMediaChange(selectedMediaIds.filter((mid) => mid !== id));
    },
    [selectedMediaIds, onMediaChange],
  );

  // Basic drag reorder for carousel order
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...selectedMediaIds];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dragOverIndex, 0, moved);
      onMediaChange(reordered);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex, selectedMediaIds, onMediaChange]);

  return (
    <div className="space-y-4">
      {/* Selected media thumbnail strip */}
      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {selectedItems.length} selected -- drag to reorder
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedItems.map((item, index) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className={cn(
                  'group relative flex items-center gap-1 rounded-lg border border-border bg-card p-1 transition',
                  dragIndex === index && 'opacity-50',
                  dragOverIndex === index && dragIndex !== index && 'border-primary',
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
                <div className="relative h-14 w-14 overflow-hidden rounded bg-muted">
                  {item.previewUrl ? (
                    <Image
                      src={item.previewUrl}
                      alt={item.fileName}
                      fill
                      sizes="56px"
                      className="object-contain"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                      No preview
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 shadow transition group-hover:opacity-100"
                  aria-label={`Remove ${item.fileName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload panel */}
      <MediaUploadPanel
        accountId={accountId}
        onUploadComplete={handleUploadComplete}
        libraryItems={allItems}
        onLibrarySelect={handleLibrarySelect}
        selectedIds={selectedMediaIds}
      />
    </div>
  );
}
