import Link from "next/link";
import { DateTime } from "luxon";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { PlannerOverview } from "@/lib/planner/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DeleteContentButton } from "@/features/planner/delete-content-button";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";

const PLATFORM_STYLES: Record<string, string> = {
  facebook: "bg-blue-100 text-blue-700",
  instagram: "bg-pink-100 text-pink-700",
  gbp: "bg-emerald-100 text-emerald-700",
};

const STATUS_TEXT_CLASSES: Record<string, string> = {
  draft: "text-amber-700",
  scheduled: "text-slate-600",
  publishing: "text-blue-700",
  posted: "text-emerald-700",
  failed: "text-rose-700",
};

type CalendarItem = PlannerOverview["items"][number] & { occursAt: DateTime };

interface PlannerCalendarProps {
  month?: string;
}

export async function PlannerCalendar({ month }: PlannerCalendarProps) {
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

  const monthLabel = monthStart.toFormat("LLLL yyyy");
  const prevMonthParam = monthStart.minus({ months: 1 }).toFormat("yyyy-MM");
  const nextMonthParam = monthStart.plus({ months: 1 }).toFormat("yyyy-MM");

  const buildMonthHref = (value?: string) => {
    if (!value) return "/planner";
    return `/planner?month=${value}`;
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold text-slate-900">{monthLabel}</h3>
          <p className="text-sm text-slate-500">Timezone: {timezoneLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildMonthHref(prevMonthParam)}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Previous month
          </Link>
          <Link
            href="/planner"
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Today
          </Link>
          <Link
            href={buildMonthHref(nextMonthParam)}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Next month
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[960px] space-y-3">
          <div className="hidden grid-cols-7 gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
            {Array.from({ length: 7 }).map((_, index) => {
              const weekday = calendarStart.plus({ days: index }).toFormat("ccc");
              return <span key={weekday}>{weekday}</span>;
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
            {weeks.flat().map(({ date, isCurrentMonth, isToday, items }) => {
              const classes = [
                "flex h-[260px] flex-col gap-3 rounded-2xl border p-4 transition",
                isCurrentMonth ? "bg-white border-slate-200 shadow-sm" : "bg-slate-50 border-slate-100 opacity-70",
                isToday ? "border-slate-900 shadow-md shadow-slate-900/10" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <section key={`${date.toISODate()}-cell`} className={classes}>
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{date.toFormat("d MMM")}</p>
                      <p className="text-xs text-slate-500">{date.toFormat("cccc")}</p>
                    </div>
                    {isToday ? (
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
                        Today
                      </span>
                    ) : null}
                  </header>

                  <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                    {items.length ? (
                      items.map((item) => (
                        <article
                          key={item.id}
                          className="space-y-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs shadow-sm transition hover:border-slate-400"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                PLATFORM_STYLES[item.platform]
                              }`}
                            >
                              {formatPlatformLabel(item.platform)}
                            </span>
                            <span
                              className={`text-[10px] font-semibold uppercase ${
                                STATUS_TEXT_CLASSES[item.status] ?? "text-slate-600"
                              }`}
                            >
                              {formatStatusLabel(item.status)}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[12px] font-semibold text-slate-900 leading-tight">
                              {item.campaignName}
                            </p>
                            <p className="text-[11px] text-slate-500">{item.occursAt.toFormat("HH:mm")}</p>
                            {item.status === "draft" && item.autoGenerated ? (
                              <p className="text-[10px] font-medium text-amber-700">Auto-generated draft</p>
                            ) : null}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/planner/${item.id}`}
                              className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                            >
                              View
                            </Link>
                            <DeleteContentButton contentId={item.id} />
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-4 text-center text-xs text-slate-500">
                        No posts scheduled
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <p>
          Showing scheduled posts for {monthLabel} in {timezoneLabel}. Planner updates automatically when
          campaigns are approved.
        </p>
        <Link
          href="/create?tab=weekly"
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Create weekly plan
        </Link>
      </div>
    </section>
  );
}
