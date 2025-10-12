import Link from "next/link";
import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { PlannerOverview } from "@/lib/planner/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DeleteContentButton } from "@/features/planner/delete-content-button";
import { PlannerStatusFilters } from "@/features/planner/planner-status-filters";
import {
  type PlannerItemStatus,
  STATUS_FILTER_VALUE_TO_STATUS,
  type PlannerStatusFilterValue,
} from "@/features/planner/status-filter-options";
import { PermanentlyDeleteContentButton, RestoreContentButton } from "@/features/planner/restore-content-button";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";

const PLATFORM_STYLES: Record<string, string> = {
  facebook: "bg-brand-mist/70 text-brand-ambergold",
  instagram: "bg-brand-sandstone/20 text-brand-sandstone",
  gbp: "bg-brand-teal/20 text-brand-teal",
};

const STATUS_TEXT_CLASSES: Record<string, string> = {
  draft: "text-brand-sandstone",
  scheduled: "text-brand-teal",
  publishing: "text-brand-teal",
  posted: "text-brand-ambergold",
  failed: "text-rose-600",
};

const STATUS_ACCENT_CLASSES: Record<string, string> = {
  draft: "border-l-brand-caramel/60 bg-brand-caramel/20",
  scheduled: "border-l-brand-mist/60 bg-brand-mist/20",
  publishing: "border-l-brand-teal/60 bg-brand-teal/10",
  posted: "border-l-brand-ambergold/60 bg-brand-ambergold/10",
  failed: "border-l-rose-200 bg-rose-50/80",
};

type CalendarItem = PlannerOverview["items"][number] & { occursAt: DateTime };

interface PlannerCalendarProps {
  month?: string;
  statusFilters?: PlannerStatusFilterValue[];
}

export async function PlannerCalendar({ month, statusFilters }: PlannerCalendarProps) {
  const ownerSettings = await getOwnerSettings();
  const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
  const timezoneLabel = timezone.replace(/_/g, " ");

  const now = DateTime.now().setZone(timezone);
  const desiredMonth = month
    ? DateTime.fromFormat(month, "yyyy-MM", { zone: timezone })
    : now;
  const referenceMonth = desiredMonth.isValid ? desiredMonth : now;

  const monthStart = referenceMonth.startOf("month");
  const calendarStart = monthStart.startOf("week");
  const calendarEnd = calendarStart.plus({ weeks: 6 }).minus({ days: 1 });

  const overview = await getPlannerOverview({
    rangeStart: calendarStart.toUTC().toJSDate(),
    rangeEnd: calendarEnd.endOf("day").toUTC().toJSDate(),
  });

  const selectedStatuses = statusFilters?.length
    ? new Set(
        statusFilters
          .map((value) => STATUS_FILTER_VALUE_TO_STATUS[value])
          .filter((status): status is PlannerItemStatus => Boolean(status)),
      )
    : null;

  const scheduledItems: CalendarItem[] = overview.items
    .map((item) => {
      const occursAtUtc = DateTime.fromISO(item.scheduledFor, { zone: "utc" });
      if (!occursAtUtc.isValid) return null;
      return {
        ...item,
        occursAt: occursAtUtc.setZone(timezone),
      } satisfies CalendarItem;
    })
    .filter((entry): entry is CalendarItem => Boolean(entry))
    .filter((item) => {
      if (!selectedStatuses) return true;
      return selectedStatuses.has(item.status);
    })
    .sort((a, b) => a.occursAt.toMillis() - b.occursAt.toMillis());

  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const item of scheduledItems) {
    const key = item.occursAt.toISODate();
    if (!key) continue;
    const bucket = itemsByDate.get(key) ?? [];
    bucket.push(item);
    itemsByDate.set(key, bucket);
  }

  const totalDays = 42; // 6 weeks grid
  const days: Array<{
    date: DateTime;
    isCurrentMonth: boolean;
    isToday: boolean;
    items: CalendarItem[];
  }> = [];

  let cursor = calendarStart;
  for (let i = 0; i < totalDays; i += 1) {
    const isoDate = cursor.toISODate();
    days.push({
      date: cursor,
      isCurrentMonth: cursor.month === monthStart.month,
      isToday: cursor.hasSame(now, "day"),
      items: isoDate ? itemsByDate.get(isoDate) ?? [] : [],
    });
    cursor = cursor.plus({ days: 1 });
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < 6; i += 1) {
    weeks.push(days.slice(i * 7, (i + 1) * 7));
  }

  const trashedItems = overview.trash.map((item) => {
    const deletedAt = DateTime.fromISO(item.deletedAt, { zone: timezone });
    const scheduledFor = item.scheduledFor ? DateTime.fromISO(item.scheduledFor, { zone: "utc" }).setZone(timezone) : null;
    return {
      ...item,
      deletedAt,
      scheduledFor,
      deletedRelative: deletedAt.isValid ? deletedAt.toRelative({ base: now }) : null,
    };
  });

  const monthLabel = monthStart.toFormat("LLLL yyyy");
  const prevMonthParam = monthStart.minus({ months: 1 }).toFormat("yyyy-MM");
  const nextMonthParam = monthStart.plus({ months: 1 }).toFormat("yyyy-MM");

  const buildMonthHref = (value?: string) => {
    if (!value) return "/planner";
    return `/planner?month=${value}`;
  };

  const hasStatusFilters = Boolean(statusFilters?.length);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold text-brand-ambergold">{monthLabel}</h3>
          <p className="text-sm text-brand-ambergold/70">Timezone: {timezoneLabel}</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildMonthHref(prevMonthParam)}
              className="rounded-full border border-brand-mist/60 px-4 py-2 text-sm font-semibold text-brand-teal transition hover:border-brand-teal/80 hover:text-brand-teal"
            >
              Previous month
            </Link>
            <Link
              href="/planner"
              className="rounded-full border border-brand-mist/60 px-4 py-2 text-sm font-semibold text-brand-teal transition hover:border-brand-teal/80 hover:text-brand-teal"
            >
              Today
            </Link>
            <Link
              href={buildMonthHref(nextMonthParam)}
              className="rounded-full border border-brand-mist/60 px-4 py-2 text-sm font-semibold text-brand-teal transition hover:border-brand-teal/80 hover:text-brand-teal"
            >
              Next month
            </Link>
          </div>
          <PlannerStatusFilters selected={statusFilters ?? []} />
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="w-full space-y-3">
          <div className="hidden grid-cols-7 gap-3 text-[11px] font-semibold uppercase tracking-wide text-brand-teal/70 md:grid">
            {Array.from({ length: 7 }).map((_, index) => {
              const weekday = calendarStart.plus({ days: index }).toFormat("ccc");
              return <span key={weekday}>{weekday}</span>;
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
            {weeks.flat().map(({ date, isCurrentMonth, isToday, items }) => {
              const classes = [
                "flex min-h-[220px] flex-col gap-3 rounded-2xl border p-4 transition",
                isCurrentMonth
                  ? "border-brand-mist/60 bg-white/95 shadow-sm"
                  : "border-brand-mist/40 bg-brand-mist/15 opacity-80",
                isToday ? "border-brand-teal ring-2 ring-brand-teal/50" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <section key={`${date.toISODate()}-cell`} className={classes}>
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-brand-teal">{date.toFormat("d MMM")}</p>
                      <p className="text-xs text-brand-teal/70">{date.toFormat("cccc")}</p>
                    </div>
                    {isToday ? (
                      <span className="rounded-full bg-brand-teal px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
                        Today
                      </span>
                    ) : null}
                  </header>

                  <div className="flex-1 overflow-y-auto pr-1">
                    {items.length ? (
                      <ul className="space-y-2 text-xs">
                        {items.map((item) => {
                          const statusAccent = STATUS_ACCENT_CLASSES[item.status] ?? "border-l-brand-mist/60 bg-white/90";
                          const occursLabel = item.occursAt.toFormat("HH:mm");
                          return (
                            <li
                              key={item.id}
                              className={`group overflow-hidden rounded-xl border border-brand-mist/50 ${statusAccent} shadow-sm transition hover:border-brand-teal/60 hover:bg-white`}
                            >
                              {item.mediaPreview ? (
                                <div className="relative aspect-square w-full overflow-hidden border-b border-brand-mist/40 bg-white">
                                  {item.mediaPreview.mediaType === "image" ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={item.mediaPreview.url}
                                      alt="Scheduled media preview"
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <video
                                      src={item.mediaPreview.url}
                                      className="h-full w-full object-cover"
                                      preload="metadata"
                                      muted
                                    />
                                  )}
                                  <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-brand-teal shadow">
                                    {occursLabel}
                                  </span>
                                  <span
                                    className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                      STATUS_TEXT_CLASSES[item.status] ?? "text-brand-teal"
                                    }`}
                                  >
                                    {formatStatusLabel(item.status)}
                                  </span>
                                </div>
                              ) : null}
                              <div className="space-y-3 p-3">
                                <div>
                                  <p className="text-sm font-semibold text-brand-teal">
                                    {item.campaignName}
                                  </p>
                                  <p className="text-[11px] text-brand-teal/60">
                                    {item.occursAt.toFormat("cccc d LLLL")}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-brand-teal/70">
                                  <span
                                    className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wide ${
                                      PLATFORM_STYLES[item.platform]
                                    }`}
                                  >
                                    {formatPlatformLabel(item.platform)}
                                  </span>
                                  {item.placement === "story" ? (
                                    <span className="inline-flex items-center gap-2 rounded-full bg-brand-sandstone/20 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-brand-sandstone">
                                      Story
                                    </span>
                                  ) : null}
                                  {item.status === "draft" && item.autoGenerated ? (
                                    <span className="font-medium text-brand-caramel">Auto-generated draft</span>
                                  ) : null}
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <Link
                                    href={`/planner/${item.id}`}
                                    className="text-[11px] font-semibold text-brand-teal underline-offset-4 transition hover:text-brand-caramel hover:underline"
                                  >
                                    View details
                                  </Link>
                                  <DeleteContentButton contentId={item.id} />
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-brand-mist/60 bg-brand-mist/20 px-2 py-4 text-center text-xs text-brand-teal/70">
                        {hasStatusFilters ? "No posts match selected filters" : "No posts scheduled"}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-brand-teal/70">
        <p>
          Showing scheduled posts and stories for {monthLabel} in {timezoneLabel}. Planner updates automatically when
          campaigns are approved.
        </p>
        <Link
          href="/create?tab=weekly"
        className="rounded-full bg-brand-ambergold px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-ambergold/90"
        >
          Create weekly plan
        </Link>
      </div>

      {trashedItems.length ? (
        <section className="rounded-2xl border border-brand-mist/60 bg-white/95 p-4 shadow-sm">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold text-brand-teal">Trash</h4>
              <p className="text-sm text-brand-teal/70">
                Recently deleted posts stay here for safe keeping. Restore them any time or they’ll be removed
                permanently after 7 days.
              </p>
            </div>
          </header>
          <ul className="mt-4 space-y-3">
            {trashedItems.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-4 rounded-2xl border border-brand-mist/50 bg-brand-mist/10 p-4 text-sm text-brand-teal shadow-sm"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                  {item.mediaPreview ? (
                    <div className="relative aspect-square w-full max-w-[160px] overflow-hidden rounded-xl border border-brand-mist/40 bg-white">
                      {item.mediaPreview.mediaType === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.mediaPreview.url}
                          alt={item.mediaPreview.fileName ?? "Post media"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <video
                          src={item.mediaPreview.url}
                          className="h-full w-full object-cover"
                          preload="metadata"
                          muted
                          controls
                        />
                      )}
                    </div>
                  ) : null}
                  <div className="flex-1 space-y-2">
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-brand-teal">
                        {item.campaignName ?? "Untitled post"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-brand-teal/70">
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-0.5 font-semibold uppercase tracking-wide text-brand-teal">
                          {formatPlatformLabel(item.platform)}
                        </span>
                        {item.placement === "story" ? (
                          <span className="inline-flex items-center gap-2 rounded-full bg-brand-sandstone/20 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-brand-sandstone">
                            Story
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-0.5 font-semibold uppercase tracking-wide text-brand-teal/80">
                          {formatStatusLabel(item.status)}
                        </span>
                      </div>
                    </div>
                    {item.bodyPreview ? (
                      <p className="text-xs leading-relaxed text-brand-teal/80">{item.bodyPreview}</p>
                    ) : null}
                    <div className="text-xs text-brand-teal/70">
                      <p>
                        Deleted {item.deletedRelative ?? item.deletedAt.toFormat("d MMM, HH:mm")} ({timezoneLabel})
                      </p>
                      <p>
                        Scheduled for{" "}
                        {item.scheduledFor ? item.scheduledFor.toFormat("d MMM yyyy · HH:mm") : "unscheduled"}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RestoreContentButton contentId={item.id} />
                  <PermanentlyDeleteContentButton contentId={item.id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
