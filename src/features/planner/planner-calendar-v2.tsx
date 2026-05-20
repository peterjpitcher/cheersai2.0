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
import { Button } from '@/components/ui/button';

/** Weekday headers (Monday-first per ISO) */
const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TOTAL_DAYS = 42; // 6 weeks x 7 days

export interface PlannerCalendarProps {
  items: ContentItem[];
  materialisedSlots: MaterialisedSlot[];
  month?: string; // yyyy-MM format
  showImages: boolean;
}

/**
 * 6-week calendar grid for the planner (SCHED-01).
 *
 * Merges scheduled content items and materialised recurring slots into a unified grid.
 * Runs conflict detection and passes warnings to each cell.
 * Supports month navigation, status/platform filtering, and post detail drawer.
 */
export function PlannerCalendar({
  items,
  materialisedSlots,
  month,
  showImages,
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
  const prevMonth = monthStart.minus({ months: 1 }).toFormat('yyyy-MM');
  const nextMonth = monthStart.plus({ months: 1 }).toFormat('yyyy-MM');

  return (
    <div className="space-y-4">
      {/* In-calendar month nav + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/planner?month=${prevMonth}`}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/planner?month=${nextMonth}`}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>

        <StatusFilters
          onStatusChange={handleStatusChange}
          onPlatformChange={handlePlatformChange}
        />
      </div>

      {/* Desktop: 6x7 grid */}
      <div className="hidden md:block">
        {/* Weekday headers */}
        <div className="mb-2 grid grid-cols-7 gap-2">
          {WEEKDAY_HEADERS.map((day) => (
            <div
              key={day}
              className="eyebrow pl-3"
              style={{ fontSize: 10 }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-2">
          {days.map(({ date, isCurrentMonth, isToday, items: dayItems, conflicts: dayConflicts }) => (
            <CalendarCell
              key={date.toISODate()}
              date={date}
              items={dayItems}
              conflicts={dayConflicts}
              isToday={isToday}
              isMuted={!isCurrentMonth}
              showImages={showImages}
              onItemClick={handleItemClick}
            />
          ))}
        </div>
      </div>

      {/* Mobile: list view (one day per row) */}
      <div className="space-y-2 md:hidden">
        {days
          .filter(({ items: dayItems }) => dayItems.length > 0)
          .map(({ date, isToday, items: dayItems }) => (
            <div
              key={date.toISODate()}
              style={{
                backgroundColor: 'var(--c-card)',
                border: '1px solid var(--c-line)',
                borderRadius: 10,
                padding: 12,
                ...(isToday ? { boxShadow: 'inset 0 0 0 2px var(--c-orange)' } : {}),
              }}
            >
              <p
                className="mb-2 text-sm font-semibold"
                style={{ color: 'var(--c-ink)' }}
              >
                {date.toFormat('cccc d LLLL')}
                {isToday && (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: 'var(--c-orange)' }}
                  >
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
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:opacity-80"
                      style={{ color: 'var(--c-ink)' }}
                    >
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
