'use client';

import { motion } from 'framer-motion';
import { Check, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import clsx from 'clsx';
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
      <div className="rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)] p-8 text-center">
        <p className="text-[13px] text-[var(--c-ink-3)]">
          No media uploaded yet. Upload your first image to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
      className={clsx(
        'group relative overflow-hidden rounded-[var(--r-lg)] border bg-[var(--c-card)] text-[12px] transition-colors',
        selected
          ? 'border-[var(--c-orange)] ring-2 ring-[var(--c-orange)]/30'
          : 'border-[var(--c-line)]',
      )}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
    >
      {/* Image container */}
      <div className="relative aspect-square w-full overflow-hidden bg-[var(--c-paper-2)]">
        {item.previewUrl ? (
          <Image
            src={item.previewUrl}
            alt={item.fileName}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 25vw"
            className="object-contain"
            loading="lazy"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--c-ink-4)]">
            No preview
          </div>
        )}

        {/* Selection checkbox overlay */}
        {selectable && (
          <button
            type="button"
            onClick={() => onSelect?.(item.id)}
            className={clsx(
              'absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border transition',
              selected
                ? 'border-[var(--c-orange)] bg-[var(--c-orange)] text-white'
                : 'border-[var(--c-line-2)] bg-[var(--c-card)]/80 text-transparent hover:border-[var(--c-orange)]/60',
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
            className="absolute right-1.5 top-1.5 z-10 rounded-full bg-rose-600/90 p-1 text-white shadow transition hover:bg-rose-600"
            aria-label={`Delete ${item.fileName}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Card footer */}
      <div className="px-2.5 py-2">
        {/* File name */}
        <p className="truncate text-[13px] font-medium text-[var(--c-ink)]">{item.fileName}</p>

        {/* Tags */}
        {item.tags.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-[var(--c-ink-3)]">
            {item.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}
            {item.tags.length > 3 && ` +${item.tags.length - 3}`}
          </p>
        )}
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MediaGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--c-line)] bg-[var(--c-card)]">
          <Skeleton className="aspect-square w-full bg-[var(--c-paper-2)]" />
          <div className="space-y-1.5 p-2 pb-2.5">
            <Skeleton className="h-3.5 w-3/4 rounded bg-[var(--c-paper-2)]" />
            <Skeleton className="h-2.5 w-1/2 rounded bg-[var(--c-paper-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
