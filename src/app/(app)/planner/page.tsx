import { Suspense } from 'react';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { getContentForCalendar, getContentByAccount } from '@/lib/content/queries';
import { resolveThumbnails } from '@/lib/media/resolve-thumbnails';
import { materialiseRecurring } from '@/lib/scheduling/materialise';
import { PlannerSkeleton } from '@/features/planner/planner-skeleton';
import { getCurrentUser } from '@/lib/auth/server';
import { getFailedPublishCount, listPlannerNotifications } from '@/lib/planner/notifications';
import { AttentionNeededBanner } from '@/features/planner/attention-needed-banner';
import { PlannerShell } from '@/features/planner/planner-shell';
import type { PlannerActivityItem } from '@/features/planner/activity-feed';

/** Force dynamic rendering — planner shows personalised data (PERF-01) */
export const dynamic = 'force-dynamic';

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const params = searchParams ? await searchParams : {};
  const monthParam = typeof params.month === 'string' ? params.month.trim() : undefined;
  const viewParam = typeof params.view === 'string' ? params.view : undefined;
  const showImagesParam = params.show_images !== 'false';

  // Get accountId for realtime subscriptions (non-blocking — used by client components)
  const user = await getCurrentUser();
  const accountId = user?.accountId ?? '';

  // Compute display values for header
  const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
  const referenceMonth = monthParam
    ? DateTime.fromFormat(monthParam, 'yyyy-MM', { zone: DEFAULT_TIMEZONE })
    : now;
  const effectiveMonth = referenceMonth.isValid ? referenceMonth : now;
  const dayLine = now.toFormat("cccc d LLLL");

  // Fetch attention banner count and initial feed events in parallel
  const [failedCount, notifications] = await Promise.all([
    getFailedPublishCount().catch(() => 0),
    listPlannerNotifications(20).catch(() => []),
  ]);

  // Map server notifications to PlannerActivityItem[] for the feed
  const initialEvents: PlannerActivityItem[] = notifications.map((n) => ({
    id: n.id,
    message: n.message,
    timestamp: n.createdAt,
    level: 'info' as const,
    category: n.category,
    metadata: n.metadata,
    readAt: n.readAt,
  }));

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Attention Needed banner — shows failed publish count with realtime updates */}
      {accountId ? (
        <AttentionNeededBanner accountId={accountId} initialCount={failedCount} />
      ) : null}

      {/* Suspense boundary isolates data-fetching to PlannerCalendarLoader only (PERF-01) */}
      <Suspense fallback={<PlannerSkeleton />}>
        <PlannerCalendarLoader
          month={monthParam}
          view={viewParam}
          showImages={showImagesParam}
          dayLine={dayLine}
          displayMonth={effectiveMonth.toFormat('LLLL')}
          accountId={accountId}
          initialEvents={initialEvents}
        />
      </Suspense>
    </div>
  );
}

/**
 * Server component that fetches calendar data and passes to the client shell.
 * Separated to enable Suspense streaming.
 */
async function PlannerCalendarLoader({
  month,
  view,
  showImages,
  dayLine,
  displayMonth,
  accountId,
  initialEvents,
}: {
  month?: string;
  view?: string;
  showImages: boolean;
  dayLine: string;
  displayMonth: string;
  accountId: string;
  initialEvents: PlannerActivityItem[];
}) {
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

  // Resolve thumbnails for all content items via signed Storage URLs
  const allContentIds = [
    ...calendarItems.map((i) => i.id),
    ...recurringItems.map((i) => i.id),
  ];
  const thumbnails = await resolveThumbnails(allContentIds);

  // Merge signed URLs into calendar items
  for (const item of calendarItems) {
    item.thumbnailUrl = thumbnails.get(item.id) ?? null;
  }

  // Filter to weekly_recurring items for materialisation
  const recurring = recurringItems.filter(
    (item) => item.contentType === 'weekly_recurring',
  );

  // Materialise recurring items into individual calendar slots
  const materialisedSlots = materialiseRecurring(
    recurring,
    calendarStart,
    calendarEnd,
    thumbnails,
  );

  // Compute summary counts for header
  const allItems = [...calendarItems, ...materialisedSlots];
  const scheduledCount = allItems.filter((i) => i.status === 'scheduled' || i.status === 'approved').length;
  const needAttentionCount = allItems.filter((i) => i.status === 'failed' || i.status === 'review').length;

  return (
    <PlannerShell
      items={calendarItems}
      materialisedSlots={materialisedSlots}
      month={month}
      initialView={view === 'list' ? 'list' : 'cal'}
      initialShowImages={showImages}
      dayLine={dayLine}
      displayMonth={displayMonth}
      scheduledCount={scheduledCount}
      needAttentionCount={needAttentionCount}
      accountId={accountId}
      initialEvents={initialEvents}
    />
  );
}
