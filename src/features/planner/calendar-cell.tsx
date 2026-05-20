'use client';

import Image from 'next/image';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { AlertTriangle, Plus } from 'lucide-react';
import { PlatformDot } from '@/components/ui/platform-dot';
import { Status, type DesignStatus } from '@/components/ui/status';
import type { ContentItem, Platform } from '@/types/content';
import type { MaterialisedSlot } from '@/lib/scheduling/materialise';
import type { Conflict } from '@/lib/scheduling/conflicts';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

/** Unified display item that can be either a ContentItem or a MaterialisedSlot */
export type CalendarDisplayItem = ContentItem | MaterialisedSlot;

function isMaterialised(item: CalendarDisplayItem): item is MaterialisedSlot {
  return 'sourceId' in item && item.contentType === 'weekly_recurring';
}

function getItemId(item: CalendarDisplayItem): string {
  return isMaterialised(item) ? item.sourceId : item.id;
}

function getItemTitle(item: CalendarDisplayItem): string {
  return item.title ?? 'Untitled';
}

function getItemTime(item: CalendarDisplayItem): DateTime | null {
  if (isMaterialised(item)) {
    return DateTime.fromJSDate(item.scheduledAt, { zone: DEFAULT_TIMEZONE });
  }
  if (item.scheduledAt) {
    return DateTime.fromJSDate(item.scheduledAt, { zone: DEFAULT_TIMEZONE });
  }
  return null;
}

function getItemThumbnail(item: CalendarDisplayItem): string | null {
  if (isMaterialised(item)) return null;
  return item.thumbnailUrl ?? null;
}

function getItemPlatforms(item: CalendarDisplayItem): Platform[] {
  if (isMaterialised(item)) return [];
  const draft = item.bodyDraft as Record<string, unknown> | null;
  const platforms = draft?.platforms;
  if (!Array.isArray(platforms)) return [];
  return platforms.filter(
    (p): p is Platform => p === 'facebook' || p === 'instagram' || p === 'gbp',
  );
}

/** Map ContentStatus to DesignStatus for the Status chip */
function toDesignStatus(status: string): DesignStatus {
  switch (status) {
    case 'published':
      return 'posted';
    case 'publishing':
    case 'queued':
      return 'publishing';
    case 'scheduled':
    case 'approved':
    case 'review':
      return 'scheduled';
    case 'draft':
      return 'draft';
    case 'failed':
      return 'failed';
    default:
      return 'draft';
  }
}

/** Map full platform name to PlatformDot key */
function toPlatformKey(p: Platform): 'fb' | 'ig' | 'gbp' {
  if (p === 'facebook') return 'fb';
  if (p === 'instagram') return 'ig';
  return 'gbp';
}

const MAX_VISIBLE_ITEMS = 3;

interface CalendarCellProps {
  date: DateTime;
  items: CalendarDisplayItem[];
  conflicts: Conflict[];
  isToday: boolean;
  isMuted: boolean;
  showImages: boolean;
  onItemClick: (id: string) => void;
}

/**
 * A single day cell in the planner calendar grid.
 * Supports two tile views: media-on (showImages=true) and media-off (compact rows).
 * Uses PlatformDot and Status chips from the redesign design system.
 */
export function CalendarCell({
  date,
  items,
  conflicts,
  isToday,
  isMuted,
  showImages,
  onItemClick,
}: CalendarCellProps): React.JSX.Element {
  const hasConflicts = conflicts.length > 0;
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const overflowCount = items.length - MAX_VISIBLE_ITEMS;

  const minHeight = showImages ? 220 : 132;

  return (
    <div
      style={{
        backgroundColor: 'var(--c-card)',
        border: '1px solid var(--c-line)',
        borderRadius: 10,
        padding: 12,
        minHeight,
        opacity: isMuted ? 0.4 : 1,
        ...(isToday ? { boxShadow: 'inset 0 0 0 2px var(--c-orange)' } : {}),
      }}
      className="flex flex-col gap-1.5 text-xs transition"
    >
      {/* Cell header: weekday + date number + add button + conflict indicator */}
      <div className="flex items-start justify-between">
        <div>
          <span
            className="eyebrow block"
            style={{ fontSize: 9 }}
          >
            {date.toFormat('ccc')}
          </span>
          <span
            className="text-[14px] font-semibold"
            style={{ color: isToday ? 'var(--c-orange)' : 'var(--c-ink)' }}
          >
            {date.day}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {hasConflicts && (
            <span title={`${conflicts.length} conflict(s)`} style={{ color: 'var(--c-orange)' }}>
              <AlertTriangle className="size-3.5" aria-label="Scheduling conflict" />
            </span>
          )}
          {/* Dashed add button — only on non-muted cells */}
          {!isMuted && (
            <Link
              href="/create"
              className="flex items-center justify-center rounded-full transition hover:opacity-70"
              style={{
                width: 22,
                height: 22,
                border: '1.5px dashed var(--c-line-2)',
              }}
              aria-label={`Create post for ${date.toFormat('d LLLL')}`}
            >
              <Plus
                className="size-3"
                style={{ color: 'var(--c-ink-3)' }}
              />
            </Link>
          )}
        </div>
      </div>

      {/* Content items */}
      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        {visibleItems.map((item) => {
          const id = getItemId(item);
          const title = getItemTitle(item);
          const time = getItemTime(item);
          const platforms = getItemPlatforms(item);
          const thumbnailUrl = getItemThumbnail(item);
          const isFailed = item.status === 'failed';

          if (showImages) {
            return (
              <MediaOnTile
                key={`${id}-${time?.toMillis() ?? 0}`}
                id={id}
                title={title}
                time={time}
                platforms={platforms}
                thumbnailUrl={thumbnailUrl}
                isFailed={isFailed}
                onItemClick={onItemClick}
              />
            );
          }

          return (
            <MediaOffTile
              key={`${id}-${time?.toMillis() ?? 0}`}
              id={id}
              title={title}
              time={time}
              platforms={platforms}
              status={toDesignStatus(item.status)}
              isFailed={isFailed}
              onItemClick={onItemClick}
            />
          );
        })}

        {overflowCount > 0 && (
          <button
            type="button"
            className="mt-0.5 text-[10px] font-medium hover:underline"
            style={{ color: 'var(--c-orange)' }}
            onClick={() => onItemClick(getItemId(items[MAX_VISIBLE_ITEMS]))}
          >
            +{overflowCount} more
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Media-on tile (showImages=true)                                    */
/* ------------------------------------------------------------------ */

interface MediaOnTileProps {
  id: string;
  title: string;
  time: DateTime | null;
  platforms: Platform[];
  thumbnailUrl: string | null;
  isFailed: boolean;
  onItemClick: (id: string) => void;
}

function MediaOnTile({ id, title, time, platforms, thumbnailUrl, isFailed, onItemClick }: MediaOnTileProps) {
  return (
    <button
      type="button"
      onClick={() => onItemClick(id)}
      className="w-full text-left transition focus:outline-none focus-visible:ring-1"
      style={{ borderRadius: 6 }}
    >
      {/* Thumbnail with 16:10 aspect ratio */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: '16/10',
          borderRadius: 6,
          backgroundColor: 'var(--c-paper-2)',
        }}
      >
        {thumbnailUrl && (
          <Image
            src={thumbnailUrl}
            alt={title || 'Post thumbnail'}
            fill
            sizes="(max-width: 768px) 100vw, 14vw"
            className="object-cover"
          />
        )}
        {/* Platform dot in top-left */}
        {platforms.length > 0 && (
          <span
            className="absolute top-1.5 left-1.5"
            style={{
              boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9)',
              borderRadius: '50%',
            }}
          >
            <PlatformDot platform={toPlatformKey(platforms[0])} size={18} />
          </span>
        )}

        {/* Time pill in top-right */}
        {time && (
          <span
            className="mono absolute top-1.5 right-1.5"
            style={{
              fontSize: 10,
              color: '#fff',
              backgroundColor: 'rgba(16,24,40,0.7)',
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            {time.toFormat('HH:mm')}
          </span>
        )}

        {/* Failed overlay */}
        {isFailed && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(180,35,24,0.18)' }}
          >
            <span
              className="text-[10px] font-semibold text-white"
              style={{
                backgroundColor: 'var(--c-claret)',
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              Failed
            </span>
          </div>
        )}
      </div>

      {/* Title below image */}
      <p
        className="truncate font-medium"
        style={{
          fontSize: 11,
          fontWeight: 500,
          padding: '5px 7px',
          color: 'var(--c-ink)',
        }}
      >
        {title}
      </p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Media-off tile (showImages=false) — compact row                    */
/* ------------------------------------------------------------------ */

interface MediaOffTileProps {
  id: string;
  title: string;
  time: DateTime | null;
  platforms: Platform[];
  status: DesignStatus;
  isFailed: boolean;
  onItemClick: (id: string) => void;
}

function MediaOffTile({ id, title, time, platforms, status, isFailed, onItemClick }: MediaOffTileProps) {
  return (
    <button
      type="button"
      onClick={() => onItemClick(id)}
      className="flex w-full items-center gap-1.5 text-left transition focus:outline-none focus-visible:ring-1"
      style={{
        backgroundColor: 'var(--c-card-raised)',
        border: '1px solid var(--c-line)',
        borderRadius: 7,
        padding: '4px 6px',
      }}
    >
      {/* Platform dot */}
      {platforms.length > 0 && (
        <PlatformDot platform={toPlatformKey(platforms[0])} size={14} />
      )}

      {/* Time */}
      {time && (
        <span
          className="mono shrink-0"
          style={{ fontSize: 10, color: 'var(--c-ink-3)' }}
        >
          {time.toFormat('HH:mm')}
        </span>
      )}

      {/* Title */}
      <span
        className="flex-1 truncate text-[10px]"
        style={{ color: 'var(--c-ink)' }}
      >
        {title}
      </span>

      {/* Failed indicator or status */}
      {isFailed ? (
        <Status status="failed" size="sm" />
      ) : (
        <Status status={status} size="sm" />
      )}
    </button>
  );
}
