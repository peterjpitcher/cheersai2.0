'use client';

import { DateTime } from 'luxon';
import { AlertTriangle } from 'lucide-react';
import { StatusChip } from '@/components/ui/status-chip';
import { PlatformBadge } from '@/components/ui/platform-badge';
import type { ContentItem, Platform } from '@/types/content';
import type { MaterialisedSlot } from '@/lib/scheduling/materialise';
import type { Conflict } from '@/lib/scheduling/conflicts';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { cn } from '@/lib/utils';

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

function getItemPlatforms(item: CalendarDisplayItem): Platform[] {
  if (isMaterialised(item)) return [];
  const draft = item.bodyDraft as Record<string, unknown> | null;
  const platforms = draft?.platforms;
  if (!Array.isArray(platforms)) return [];
  return platforms.filter(
    (p): p is Platform => p === 'facebook' || p === 'instagram' || p === 'gbp',
  );
}

const MAX_VISIBLE_ITEMS = 3;

interface CalendarCellProps {
  date: DateTime;
  items: CalendarDisplayItem[];
  conflicts: Conflict[];
  isToday: boolean;
  isMuted: boolean;
  onItemClick: (id: string) => void;
}

/**
 * A single day cell in the planner calendar grid.
 * Shows compact content items with status chips and platform indicators.
 * Displays a conflict warning icon when scheduling conflicts exist for this day.
 */
export function CalendarCell({
  date,
  items,
  conflicts,
  isToday,
  isMuted,
  onItemClick,
}: CalendarCellProps): React.JSX.Element {
  const hasConflicts = conflicts.length > 0;
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const overflowCount = items.length - MAX_VISIBLE_ITEMS;

  return (
    <div
      className={cn(
        'flex min-h-[80px] flex-col gap-1 rounded-lg border p-1.5 text-xs transition',
        isToday && 'border-primary bg-primary/5 ring-1 ring-primary/20',
        isMuted && 'opacity-50',
        !isToday && !isMuted && 'border-border bg-card hover:border-primary/30',
      )}
    >
      {/* Cell header: date number + conflict indicator */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
            isToday && 'bg-primary text-primary-foreground',
            !isToday && 'text-muted-foreground',
          )}
        >
          {date.day}
        </span>
        {hasConflicts && (
          <span title={`${conflicts.length} conflict(s)`} className="text-amber-500">
            <AlertTriangle className="size-3.5" aria-label="Scheduling conflict" />
          </span>
        )}
      </div>

      {/* Content items */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        {visibleItems.map((item) => {
          const id = getItemId(item);
          const title = getItemTitle(item);
          const time = getItemTime(item);
          const platforms = getItemPlatforms(item);

          return (
            <button
              key={`${id}-${time?.toMillis() ?? 0}`}
              type="button"
              onClick={() => onItemClick(id)}
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <StatusChip status={item.status} size="sm" className="shrink-0 scale-75 origin-left" />
              <span className="flex-1 truncate text-[10px] leading-tight text-foreground">
                {time ? `${time.toFormat('HH:mm')} ` : ''}{title}
              </span>
              {platforms.length > 0 && (
                <span className="flex shrink-0 gap-0.5">
                  {platforms.map((p) => (
                    <span
                      key={p}
                      className={cn(
                        'inline-block size-1.5 rounded-full',
                        p === 'facebook' && 'bg-blue-500',
                        p === 'instagram' && 'bg-pink-500',
                        p === 'gbp' && 'bg-green-500',
                      )}
                      title={p}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}

        {overflowCount > 0 && (
          <button
            type="button"
            className="mt-0.5 text-[10px] font-medium text-primary hover:underline"
            onClick={() => onItemClick(getItemId(items[MAX_VISIBLE_ITEMS]))}
          >
            +{overflowCount} more
          </button>
        )}
      </div>
    </div>
  );
}
