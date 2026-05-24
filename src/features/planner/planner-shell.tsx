'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { Calendar, List, Image, Plus } from 'lucide-react';

import type { ContentItem } from '@/types/content';
import type { MaterialisedSlot } from '@/lib/scheduling/materialise';
import type { PlannerActivityItem } from '@/features/planner/activity-feed';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

import { PlannerCalendar } from '@/features/planner/planner-calendar-v2';
import { PlannerAgenda } from '@/features/planner/planner-agenda';
import { PlannerActivityFeed } from '@/features/planner/activity-feed';
import { StatusDrawer } from '@/components/layout/status-drawer';

import { Segmented } from '@/components/ui/segmented';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { Button } from '@/components/ui/button';

const VIEW_OPTIONS = [
  { value: 'cal', label: 'Calendar', icon: Calendar },
  { value: 'list', label: 'Agenda', icon: List },
];

export interface PlannerShellProps {
  items: ContentItem[];
  materialisedSlots: MaterialisedSlot[];
  month?: string;
  initialView: 'cal' | 'list';
  initialShowImages: boolean;
  initialStatus?: string;
  dayLine: string;
  displayMonth: string;
  scheduledCount: number;
  needAttentionCount: number;
  accountId: string;
  initialEvents: PlannerActivityItem[];
}

/**
 * Client-side planner shell: header with controls, Segmented toggle for
 * calendar vs agenda, and image toggle chip. Renders either PlannerCalendar
 * or PlannerAgenda based on the current view.
 */
export function PlannerShell({
  items,
  materialisedSlots,
  month,
  initialView,
  initialShowImages,
  initialStatus,
  dayLine,
  displayMonth,
  scheduledCount,
  needAttentionCount,
  accountId,
  initialEvents,
}: PlannerShellProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<string>(initialView);
  const [showImages, setShowImages] = useState(initialShowImages);
  const [displayedMonth, setDisplayedMonth] = useState<string | undefined>(month);

  useEffect(() => {
    setDisplayedMonth(month);
  }, [month]);

  const activeDisplayMonth = useMemo(() => {
    const parsed = displayedMonth
      ? DateTime.fromFormat(displayedMonth, 'yyyy-MM', { zone: DEFAULT_TIMEZONE })
      : null;
    return parsed?.isValid ? parsed.toFormat('LLLL') : displayMonth;
  }, [displayMonth, displayedMonth]);

  const buildPlannerHref = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      return query ? `/planner?${query}` : '/planner';
    },
    [],
  );

  const handleViewChange = useCallback(
    (newView: string) => {
      setView(newView);
      const params = new URLSearchParams(searchParams.toString());
      if (newView === 'list') {
        params.set('view', 'list');
      } else {
        params.delete('view');
      }
      router.push(buildPlannerHref(params), { scroll: false });
    },
    [buildPlannerHref, router, searchParams],
  );

  const handleImageToggle = useCallback(() => {
    setShowImages((prev) => {
      const next = !prev;
      const params = new URLSearchParams(searchParams.toString());
      if (!next) {
        params.set('show_images', 'false');
      } else {
        params.delete('show_images');
      }
      router.push(buildPlannerHref(params), { scroll: false });
      return next;
    });
  }, [buildPlannerHref, router, searchParams]);

  const handleMonthChange = useCallback(
    (newMonth: string) => {
      setDisplayedMonth(newMonth);
      const params = new URLSearchParams(searchParams.toString());
      params.set('month', newMonth);
      if (view === 'list') {
        params.set('view', 'list');
      } else {
        params.delete('view');
      }
      if (!showImages) {
        params.set('show_images', 'false');
      } else {
        params.delete('show_images');
      }
      router.push(buildPlannerHref(params), { scroll: false });
    },
    [buildPlannerHref, router, searchParams, showImages, view],
  );

  const handleTodayClick = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('month');
    setDisplayedMonth(DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM'));
    router.push(buildPlannerHref(params), { scroll: false });
  }, [buildPlannerHref, router, searchParams]);

  // Build summary line
  const summaryParts: string[] = [];
  if (scheduledCount > 0) summaryParts.push(`${scheduledCount} post${scheduledCount !== 1 ? 's' : ''} scheduled`);
  if (needAttentionCount > 0) summaryParts.push(`${needAttentionCount} need your eye`);
  const summaryLine = summaryParts.join(' · ');

  return (
    <>
      {/* ── Planner header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left side: eyebrow + h1 + summary */}
        <div className="min-w-0">
          <p className="eyebrow">
            {dayLine} &middot; Europe/London
          </p>
          <h1
            className="mt-1 text-[22px] font-semibold leading-tight"
            style={{ color: 'var(--c-ink)' }}
          >
            <span style={{ color: 'var(--c-orange)' }}>{activeDisplayMonth}</span> at Your Venue
          </h1>
          {summaryLine && (
            <p
              className="mt-1 text-[14px]"
              style={{ color: 'var(--c-ink-2)' }}
            >
              {summaryLine}
            </p>
          )}
        </div>

        {/* Right side: controls row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status drawer */}
          {accountId ? (
            <StatusDrawer
              feed={
                <PlannerActivityFeed
                  accountId={accountId}
                  initialEvents={initialEvents}
                />
              }
            />
          ) : null}

          {/* Image toggle chip — only relevant in calendar view */}
          {view !== 'list' && (
            <ToggleChip
              active={showImages}
              onClick={handleImageToggle}
              icon={Image}
            >
              Images
            </ToggleChip>
          )}

          {/* Calendar / Agenda segmented control */}
          <Segmented
            options={VIEW_OPTIONS}
            value={view}
            onChange={handleViewChange}
          />

          {/* Today button */}
          <Button variant="secondary" size="sm" type="button" onClick={handleTodayClick}>
            Today
          </Button>

          {/* New post button */}
          <Button variant="primary" size="sm" asChild>
            <Link href="/create">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New post
            </Link>
          </Button>
        </div>
      </header>

      {/* ── Calendar container ── */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          backgroundColor: 'var(--c-card)',
          border: '1px solid var(--c-line)',
          borderRadius: 18,
          padding: 16,
          boxShadow: 'var(--sh-sm)',
        }}
      >
        {view === 'cal' ? (
          <PlannerCalendar
            items={items}
            materialisedSlots={materialisedSlots}
            month={displayedMonth}
            showImages={showImages}
            initialStatus={initialStatus}
            onMonthChange={handleMonthChange}
          />
        ) : (
          <PlannerAgenda
            items={items}
            materialisedSlots={materialisedSlots}
            month={displayedMonth}
          />
        )}
      </div>

    </>
  );
}
