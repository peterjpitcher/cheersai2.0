'use client';

import { motion } from 'framer-motion';
import { Check, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MediaAssetSummary } from '@/lib/library/data';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MediaGridProps {
  items: MediaAssetSummary[];
  selectable?: boolean;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// MediaGrid
// ---------------------------------------------------------------------------

/**
 * Responsive grid of media items with selectable mode,
 * hover effects (Framer Motion), and next/image throughout (CONT-08).
 */
export function MediaGrid({
  items,
  selectable = false,
  selectedIds = [],
  onSelect,
  onDelete,
  isLoading = false,
}: MediaGridProps): React.JSX.Element {
  const selectedSet = new Set(selectedIds);

  if (isLoading) {
    return <MediaGridSkeleton />;
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No media uploaded yet. Upload your first image to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => (
        <MediaGridItem
          key={item.id}
          item={item}
          selectable={selectable}
          selected={selectedSet.has(item.id)}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MediaGridItem
// ---------------------------------------------------------------------------

interface MediaGridItemProps {
  item: MediaAssetSummary;
  selectable: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
}

function MediaGridItem({
  item,
  selectable,
  selected,
  onSelect,
  onDelete,
}: MediaGridItemProps): React.JSX.Element {
  const [isHovered, setIsHovered] = useState(false);

  const handleDelete = (): void => {
    if (!onDelete) return;
    const confirmed = window.confirm(`Delete "${item.fileName}"?`);
    if (confirmed) {
      onDelete(item.id);
    }
  };

  return (
    <motion.article
      className={cn(
        'group relative space-y-2 rounded-xl border bg-card p-2 text-xs transition-colors',
        selected
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:border-border/80',
      )}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
    >
      {/* Image container */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
        {item.previewUrl ? (
          <Image
            src={item.previewUrl}
            alt={item.fileName}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1280px) 25vw, 20vw"
            className="object-contain"
            loading="lazy"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            No preview
          </div>
        )}

        {/* Selection checkbox overlay */}
        {selectable && (
          <button
            type="button"
            onClick={() => onSelect?.(item.id)}
            className={cn(
              'absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border transition',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card/80 text-transparent hover:border-primary/60',
            )}
            aria-label={selected ? `Deselect ${item.fileName}` : `Select ${item.fileName}`}
          >
            {selected && <Check className="h-3 w-3" />}
          </button>
        )}

        {/* Delete button on hover */}
        {onDelete && isHovered && (
          <button
            type="button"
            onClick={handleDelete}
            className="absolute right-1.5 top-1.5 z-10 rounded-full bg-destructive/90 p-1 text-destructive-foreground shadow transition hover:bg-destructive"
            aria-label={`Delete ${item.fileName}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* File name */}
      <p className="truncate font-medium text-foreground">{item.fileName}</p>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="muted" className="px-1.5 py-0 text-[10px]">
              #{tag}
            </Badge>
          ))}
          {item.tags.length > 3 && (
            <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
              +{item.tags.length - 3}
            </Badge>
          )}
        </div>
      )}
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MediaGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border bg-card p-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
          <div className="flex gap-1">
            <Skeleton className="h-3 w-10 rounded-full" />
            <Skeleton className="h-3 w-8 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
