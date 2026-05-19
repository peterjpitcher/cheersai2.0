'use client';

import { startTransition, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { detectConflicts, type Conflict } from '@/lib/scheduling/conflicts';
import type { MaterialisedSlot } from '@/lib/scheduling/materialise';
import type { ContentItem, ContentStatus, Platform } from '@/types/content';
import { CalendarCell, type CalendarDisplayItem } from '@/features/planner/calendar-cell';
import { StatusFilters } from '@/features/planner/status-filters';
import { PostDrawer } from '@/features/planner/post-drawer';
import { StatusChip } from '@/components/ui/status-chip';
import { cn } from '@/lib/utils';

/** Weekday headers (Monday-first per ISO) */
const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TOTAL_DAYS = 42; // 6 weeks x 7 days

interface PlannerCalendarProps {
  items: ContentItem[];
  materialisedSlots: MaterialisedSlot[];
  month?: string; // yyyy-MM format
}

/**
 * 6-week calendar grid for the planner (SCHED-01).
 *
 * Merges scheduled content items and materialised recurring slots into a unified grid.
 * Runs conflict detection and passes warnings to each cell.
 * Supports month navigation, status/platform filtering, and post detail drawer.
 * Compact density per D-11.
 */
export function PlannerCalendar({
  items,
  materialisedSlots,
  month,
}: PlannerCalendarProps): React.JSX.Element {
  const now = useMemo(() => DateTime.now().setZone(DEFAULT_TIMEZONE), []);

  const referenceMonth = useMemo(() => {
    if (month) {
      const parsed = DateTime.fromFormat(month, 'yyyy-MM', { zone: DEFAULT_TIMEZONE });
      if (parsed.isValid) return parsed;
    }
    return now;
  }, [month, now]);

  const monthStart = useMemo(() => referenceMonth.startOf('month'), [referenceMonth]);
  const calendarStart = useMemo(() => monthStart.startOf('week'), [monthStart]);

  // Filtering state
  const [statusFilter, setStatusFilter] = useState<ContentStatus[]>([]);
  const [platformFilter, setPlatformFilter] = useState<Platform[]>([]);

  // Drawer state
  const [drawerContentId, setDrawerContentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** Wrap filter changes in startTransition — re-renders the entire grid (PERF-02, INP < 200ms) */
  const handleStatusChange = useCallback((statuses: ContentStatus[]) => {
    startTransition(() => {
      setStatusFilter(statuses);
    });
  }, []);

  const handlePlatformChange = useCallback((platforms: Platform[]) => {
    startTransition(() => {
      setPlatformFilter(platforms);
    });
  }, []);

  const handleItemClick = useCallback((id: string) => {
    setDrawerContentId(id);
    setDrawerOpen(true);
  }, []);

  // Merge and filter items
  const allDisplayItems = useMemo<CalendarDisplayItem[]>(() => {
    const merged: CalendarDisplayItem[] = [...items, ...materialisedSlots];

    return merged.filter((item) => {
      // Status filter
      if (statusFilter.length > 0 && !statusFilter.includes(item.status)) {
        return false;
      }
      // Platform filter (only for ContentItem with bodyDraft)
      if (platformFilter.length > 0 && 'bodyDraft' in item) {
        const draft = item.bodyDraft as Record<string, unknown> | null;
        const platforms = Array.isArray(draft?.platforms) ? (draft.platforms as string[]) : [];
        if (!platforms.some((p) => platformFilter.includes(p as Platform))) {
          return false;
        }
      }
      return true;
    });
  }, [items, materialisedSlots, statusFilter, platformFilter]);

  // Run conflict detection on all content items
  const conflicts = useMemo(() => detectConflicts(items), [items]);

  // Build 42-day grid
  const days = useMemo(() => {
    const result: Array<{
      date: DateTime;
      isCurrentMonth: boolean;
      isToday: boolean;
      items: CalendarDisplayItem[];
      conflicts: Conflict[];
    }> = [];

    for (let i = 0; i < TOTAL_DAYS; i++) {
      const date = calendarStart.plus({ days: i });
      const isoDate = date.toISODate();

      // Items for this day
      const dayItems = allDisplayItems.filter((item) => {
        const scheduledAt = 'scheduledAt' in item ? item.scheduledAt : null;
        if (!scheduledAt) return false;
        const dt = DateTime.fromJSDate(
          scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt as unknown as string),
          { zone: DEFAULT_TIMEZONE },
        );
        return dt.toISODate() === isoDate;
      });

      // Conflicts for this day
      const dayConflicts = conflicts.filter((c) => {
        const dtA = DateTime.fromJSDate(c.itemA.scheduledAt, { zone: DEFAULT_TIMEZONE });
        return dtA.toISODate() === isoDate;
      });

      result.push({
        date,
        isCurrentMonth: date.month === monthStart.month && date.year === monthStart.year,
        isToday: date.hasSame(now, 'day'),
        items: dayItems,
        conflicts: dayConflicts,
      });
    }

    return result;
  }, [calendarStart, monthStart, now, allDisplayItems, conflicts]);

  // Month navigation
  const monthLabel = monthStart.toFormat('LLLL yyyy');
  const prevMonth = monthStart.minus({ months: 1 }).toFormat('yyyy-MM');
  const nextMonth = monthStart.plus({ months: 1 }).toFormat('yyyy-MM');

  return (
    <div className="space-y-4">
      {/* Header: month navigation + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/planner?month=${prevMonth}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h3 className="min-w-[160px] text-center text-lg font-semibold text-foreground">
            {monthLabel}
          </h3>
          <Link
            href={`/planner?month=${nextMonth}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent"
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Link>
          <Link
            href="/planner"
            className="ml-2 text-xs font-medium text-primary hover:underline"
          >
            Today
          </Link>
        </div>

        <StatusFilters
          onStatusChange={handleStatusChange}
          onPlatformChange={handlePlatformChange}
        />
      </div>

      {/* Desktop: 6x7 grid */}
      <div className="hidden md:block">
        {/* Weekday headers */}
        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAY_HEADERS.map((day) => (
            <div
              key={day}
              className="px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {days.map(({ date, isCurrentMonth, isToday, items: dayItems, conflicts: dayConflicts }) => (
            <CalendarCell
              key={date.toISODate()}
              date={date}
              items={dayItems}
              conflicts={dayConflicts}
              isToday={isToday}
              isMuted={!isCurrentMonth}
              onItemClick={handleItemClick}
            />
          ))}
        </div>
      </div>

      {/* Mobile: list view (one day per row) */}
      <div className="space-y-2 md:hidden">
        {days
          .filter(({ items: dayItems }) => dayItems.length > 0)
          .map(({ date, isToday, items: dayItems, conflicts: dayConflicts }) => (
            <div
              key={date.toISODate()}
              className={cn(
                'rounded-lg border p-3',
                isToday ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <p className="mb-2 text-sm font-semibold text-foreground">
                {date.toFormat('cccc d LLLL')}
                {isToday && (
                  <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                    Today
                  </span>
                )}
              </p>
              <div className="space-y-1">
                {dayItems.map((item) => {
                  const id = 'sourceId' in item ? item.sourceId : item.id;
                  return (
                    <button
                      key={`${id}-${date.toISODate()}`}
                      type="button"
                      onClick={() => handleItemClick(id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent/50"
                    >
                      <StatusChip status={item.status} size="sm" />
                      <span className="flex-1 truncate">{item.title ?? 'Untitled'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      {/* Post detail drawer */}
      <PostDrawer
        contentId={drawerContentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
