import { Suspense } from 'react';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { getContentForCalendar } from '@/lib/content/queries';
import { getContentByAccount } from '@/lib/content/queries';
import { materialiseRecurring } from '@/lib/scheduling/materialise';
import { PlannerCalendar } from '@/features/planner/planner-calendar-v2';
import { PageHeader } from '@/components/layout/PageHeader';
import { CreatePostButton } from '@/features/planner/create-post-button';
import { PlannerSkeleton } from '@/features/planner/planner-skeleton';

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const params = searchParams ? await searchParams : {};
  const monthParam = typeof params.month === 'string' ? params.month.trim() : undefined;

  return (
    <div className="flex h-full flex-col gap-6">
      <PageHeader
        title="Planner"
        description="Review and track your scheduled content across all channels."
        action={<CreatePostButton />}
      />

      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-[0_1px_3px_0_rgb(0_0_0/0.07),0_1px_2px_-1px_rgb(0_0_0/0.05)] md:p-6">
        <Suspense fallback={<PlannerSkeleton />}>
          <PlannerCalendarLoader month={monthParam} />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Server component that fetches calendar data and passes to the client calendar.
 * Separated to enable Suspense streaming.
 */
async function PlannerCalendarLoader({ month }: { month?: string }) {
  const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
  const referenceMonth = month
    ? DateTime.fromFormat(month, 'yyyy-MM', { zone: DEFAULT_TIMEZONE })
    : now;
  const effectiveMonth = referenceMonth.isValid ? referenceMonth : now;

  // Calculate 6-week calendar range
  const monthStart = effectiveMonth.startOf('month');
  const calendarStart = monthStart.startOf('week');
  const calendarEnd = calendarStart.plus({ weeks: 6 }).minus({ days: 1 }).endOf('day');

  const startDate = calendarStart.toISO()!;
  const endDate = calendarEnd.toISO()!;

  // Fetch scheduled items and recurring campaigns in parallel
  const [calendarItems, recurringItems] = await Promise.all([
    getContentForCalendar(startDate, endDate),
    getContentByAccount({ status: ['scheduled', 'approved', 'draft'] }),
  ]);

  // Filter to weekly_recurring items for materialisation
  const recurring = recurringItems.filter(
    (item) => item.contentType === 'weekly_recurring',
  );

  // Materialise recurring items into individual calendar slots
  const materialisedSlots = materialiseRecurring(
    recurring,
    calendarStart,
    calendarEnd,
  );

  return (
    <PlannerCalendar
      items={calendarItems}
      materialisedSlots={materialisedSlots}
      month={month}
    />
  );
}
