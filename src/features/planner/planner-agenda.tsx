'use client';

import { useCallback, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronRight } from 'lucide-react';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { MaterialisedSlot } from '@/lib/scheduling/materialise';
import type { ContentItem, ContentStatus, Platform } from '@/types/content';
import type { CalendarDisplayItem } from '@/features/planner/calendar-cell';
import { getDisplayTitle } from '@/lib/content/display-helpers';
import { PostDrawer } from '@/features/planner/post-drawer';
import { PlatformDot } from '@/components/ui/platform-dot';
import { Status, type DesignStatus } from '@/components/ui/status';
import { Button } from '@/components/ui/button';

/** Map ContentStatus to DesignStatus for the Status chip */
export function toDesignStatus(status: ContentStatus): DesignStatus {
  switch (status) {
    case 'published':
    case 'posted':
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

function getItemPlatforms(item: CalendarDisplayItem): Platform[] {
  if ('sourceId' in item && item.contentType === 'weekly_recurring') return [];
  const ci = item as ContentItem;
  const draft = ci.bodyDraft as Record<string, unknown> | null;
  const platforms = draft?.platforms;
  if (!Array.isArray(platforms)) return [];
  return platforms.filter(
    (p): p is Platform => p === 'facebook' || p === 'instagram' || p === 'gbp',
  );
}

function getItemCaption(item: CalendarDisplayItem): string | null {
  if ('sourceId' in item && item.contentType === 'weekly_recurring') return null;
  const ci = item as ContentItem;
  const draft = ci.bodyDraft as Record<string, unknown> | null;
  if (!draft) return null;
  const generatedCopy = draft.generatedCopy as Record<string, Record<string, string>> | undefined;
  if (!generatedCopy) return null;
  // Try facebook body, then instagram, then gbp
  return generatedCopy.facebook?.body ?? generatedCopy.instagram?.body ?? generatedCopy.gbp?.body ?? null;
}

interface DayGroup {
  date: DateTime;
  isToday: boolean;
  items: Array<{
    item: CalendarDisplayItem;
    id: string;
    title: string;
    time: DateTime | null;
    platforms: Platform[];
    caption: string | null;
    designStatus: DesignStatus;
  }>;
}

export interface PlannerAgendaProps {
  items: ContentItem[];
  materialisedSlots: MaterialisedSlot[];
  month?: string;
  statusFilter?: ContentStatus[];
  platformFilter?: Platform[];
}

/**
 * Agenda (list) view for the planner.
 * Groups content items by day with date headings and thin rule separators.
 * Each row shows time, title, status chip, caption preview, platform dots, and an "Open" button.
 */
export function PlannerAgenda({
  items,
  materialisedSlots,
  month,
  statusFilter = [],
  platformFilter = [],
}: PlannerAgendaProps): React.JSX.Element {
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
  const calendarEnd = useMemo(() => calendarStart.plus({ weeks: 6 }).minus({ days: 1 }).endOf('day'), [calendarStart]);

  // Drawer state
  const [drawerContentId, setDrawerContentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleItemClick = useCallback((id: string) => {
    setDrawerContentId(id);
    setDrawerOpen(true);
  }, []);

  // Merge, filter, and group items by day
  const dayGroups = useMemo<DayGroup[]>(() => {
    const merged: CalendarDisplayItem[] = [...items, ...materialisedSlots];

    // Apply filters
    const filtered = merged.filter((item) => {
      if (statusFilter.length > 0) {
        // Treat 'posted' and 'published' as equivalent for filtering
        const normalised = item.status === 'posted' ? 'published' : item.status;
        if (!statusFilter.includes(normalised)) return false;
      }
      if (platformFilter.length > 0 && 'bodyDraft' in item) {
        const draft = item.bodyDraft as Record<string, unknown> | null;
        const platforms = Array.isArray(draft?.platforms) ? (draft.platforms as string[]) : [];
        if (!platforms.some((p) => platformFilter.includes(p as Platform))) return false;
      }
      return true;
    });

    // Filter to items within the calendar range
    const inRange = filtered.filter((item) => {
      const scheduledAt = 'scheduledAt' in item ? item.scheduledAt : null;
      if (!scheduledAt) return false;
      const dt = DateTime.fromJSDate(
        scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt as unknown as string),
        { zone: DEFAULT_TIMEZONE },
      );
      return dt >= calendarStart && dt <= calendarEnd;
    });

    // Sort by scheduledAt
    inRange.sort((a, b) => {
      const aDate = 'scheduledAt' in a && a.scheduledAt ? new Date(a.scheduledAt as unknown as string).getTime() : 0;
      const bDate = 'scheduledAt' in b && b.scheduledAt ? new Date(b.scheduledAt as unknown as string).getTime() : 0;
      return aDate - bDate;
    });

    // Group by day
    const groups = new Map<string, DayGroup>();
    for (const item of inRange) {
      const scheduledAt = 'scheduledAt' in item ? item.scheduledAt : null;
      if (!scheduledAt) continue;
      const dt = DateTime.fromJSDate(
        scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt as unknown as string),
        { zone: DEFAULT_TIMEZONE },
      );
      const key = dt.toISODate()!;

      if (!groups.has(key)) {
        groups.set(key, {
          date: dt.startOf('day'),
          isToday: dt.hasSame(now, 'day'),
          items: [],
        });
      }

      const id = 'sourceId' in item ? item.sourceId : (item as ContentItem).id;
      groups.get(key)!.items.push({
        item,
        id,
        title: ('sourceId' in item && item.contentType === 'weekly_recurring')
          ? (item.title ?? 'Untitled')
          : getDisplayTitle(item as ContentItem),
        time: dt,
        platforms: getItemPlatforms(item),
        caption: getItemCaption(item),
        designStatus: toDesignStatus(item.status),
      });
    }

    return Array.from(groups.values());
  }, [items, materialisedSlots, statusFilter, platformFilter, calendarStart, calendarEnd, now]);

  if (dayGroups.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16"
        style={{ color: 'var(--c-ink-3)' }}
      >
        <p className="text-[15px]">No posts scheduled for this period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {dayGroups.map((group, groupIdx) => (
        <div key={group.date.toISODate()}>
          {/* Day heading with optional "Today" eyebrow and horizontal rule */}
          <div className="flex items-center gap-3 py-3">
            <span
              className="shrink-0 text-[15px] font-semibold"
              style={{ color: 'var(--c-ink)' }}
            >
              {group.date.toFormat('cccc d LLLL')}
            </span>
            {group.isToday && (
              <span className="eyebrow shrink-0" style={{ color: 'var(--c-orange)' }}>
                Today
              </span>
            )}
            <span
              className="flex-1"
              style={{
                height: 1,
                backgroundColor: 'var(--c-line)',
              }}
            />
          </div>

          {/* Item rows */}
          <div className="space-y-2">
            {group.items.map((entry) => (
              <button
                key={`${entry.id}-${entry.time?.toMillis() ?? 0}`}
                type="button"
                onClick={() => handleItemClick(entry.id)}
                className="w-full text-left transition hover:opacity-90 focus:outline-none focus-visible:ring-1"
                style={{
                  backgroundColor: 'var(--c-card)',
                  border: '1px solid var(--c-line)',
                  borderRadius: 14,
                  padding: '16px 20px',
                }}
              >
                {/* Mobile: stacked layout */}
                <div className="flex flex-col gap-2 sm:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="shrink-0 text-[13px] font-medium"
                        style={{ color: 'var(--c-ink-3)' }}
                      >
                        {entry.time ? entry.time.toFormat('HH:mm') : '--:--'}
                      </span>
                      <span
                        className="truncate text-[15px] font-medium"
                        style={{ color: 'var(--c-ink)' }}
                      >
                        {entry.title}
                      </span>
                    </div>
                    <Status status={entry.designStatus} size="sm" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {entry.platforms.length > 0 && (
                      <div className="flex items-center">
                        {entry.platforms.map((p, i) => (
                          <span
                            key={p}
                            style={{
                              marginLeft: i > 0 ? -6 : 0,
                              position: 'relative',
                              zIndex: entry.platforms.length - i,
                            }}
                          >
                            <PlatformDot platform={toPlatformKey(p)} size={22} />
                          </span>
                        ))}
                      </div>
                    )}
                    <ChevronRight className="size-4 shrink-0" style={{ color: 'var(--c-ink-3)' }} />
                  </div>
                </div>

                {/* Desktop: 3-column grid layout */}
                <div
                  className="hidden sm:grid items-center gap-4"
                  style={{ gridTemplateColumns: '84px 1fr auto' }}
                >
                  {/* Left column: time + timezone eyebrow */}
                  <div>
                    <span
                      className="block text-[15px]"
                      style={{ color: 'var(--c-ink)' }}
                    >
                      {entry.time ? entry.time.toFormat('HH:mm') : '--:--'}
                    </span>
                    <span className="eyebrow" style={{ fontSize: 9 }}>
                      Europe/London
                    </span>
                  </div>

                  {/* Centre column: title + status, then caption preview */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[15px] font-medium"
                        style={{ color: 'var(--c-ink)' }}
                      >
                        {entry.title}
                      </span>
                      <Status status={entry.designStatus} size="sm" />
                    </div>
                    {entry.caption && (
                      <p
                        className="mt-0.5 truncate text-[13px]"
                        style={{
                          color: 'var(--c-ink-2)',
                          maxWidth: 720,
                        }}
                      >
                        {entry.caption}
                      </p>
                    )}
                  </div>

                  {/* Right column: platform dots + Open button */}
                  <div className="flex items-center gap-3">
                    {entry.platforms.length > 0 && (
                      <div className="flex items-center">
                        {entry.platforms.map((p, i) => (
                          <span
                            key={p}
                            style={{
                              marginLeft: i > 0 ? -6 : 0,
                              position: 'relative',
                              zIndex: entry.platforms.length - i,
                            }}
                          >
                            <PlatformDot
                              platform={toPlatformKey(p)}
                              size={26}
                            />
                          </span>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      iconRight={ChevronRight}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick(entry.id);
                      }}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Separator between day groups (except last) */}
          {groupIdx < dayGroups.length - 1 && (
            <div
              className="my-1"
              style={{
                height: 1,
                backgroundColor: 'var(--c-line)',
              }}
            />
          )}
        </div>
      ))}

      {/* Post detail drawer */}
      <PostDrawer
        contentId={drawerContentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
