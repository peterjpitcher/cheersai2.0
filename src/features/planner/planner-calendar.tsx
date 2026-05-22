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
import {
  PermanentlyDeleteAllTrashButton,
  PermanentlyDeleteContentButton,
  RestoreContentButton,
} from "@/features/planner/restore-content-button";
import {
  MediaFrame,
  MediaFrameRawImage,
  MediaFrameVideo,
  resolveMediaPlacement,
} from "@/components/media/media-frame";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { PlannerViewToggle } from "./planner-view-toggle";
import { AddToCalendarButton, CreateWeeklyPlanButton } from "@/features/planner/planner-interaction-components";
import { BannerOverlay } from "@/features/planner/banner-overlay";

const PLATFORM_STYLES: Record<string, React.CSSProperties> = {
  facebook: { backgroundColor: 'color-mix(in srgb, var(--c-fb) 10%, transparent)', color: 'var(--c-fb)', border: '1px solid color-mix(in srgb, var(--c-fb) 30%, transparent)' },
  instagram: { backgroundColor: 'color-mix(in srgb, var(--c-ig) 12%, transparent)', color: 'var(--c-ig)', border: '1px solid color-mix(in srgb, var(--c-ig) 30%, transparent)' },
  gbp: { backgroundColor: 'color-mix(in srgb, var(--c-gbp) 12%, transparent)', color: 'var(--c-gbp)', border: '1px solid color-mix(in srgb, var(--c-gbp) 30%, transparent)' },
};

const STATUS_TEXT_STYLES: Record<string, React.CSSProperties> = {
  draft: { color: 'var(--c-status-draft-fg)' },
  scheduled: { color: 'var(--c-status-scheduled-fg)' },
  queued: { color: 'var(--c-status-scheduled-fg)' },
  publishing: { color: 'var(--c-status-publishing-fg)' },
  posted: { color: 'var(--c-status-posted-fg)' },
  failed: { color: 'var(--c-status-failed-fg)' },
};

const STATUS_ACCENT_STYLES: Record<string, React.CSSProperties> = {
  draft: { borderLeftColor: 'var(--c-status-draft-fg)', backgroundColor: 'var(--c-status-draft-bg)' },
  scheduled: { borderLeftColor: 'var(--c-status-scheduled-fg)', backgroundColor: 'var(--c-status-scheduled-bg)' },
  queued: { borderLeftColor: 'var(--c-status-scheduled-fg)', backgroundColor: 'var(--c-status-scheduled-bg)' },
  publishing: { borderLeftColor: 'var(--c-status-publishing-fg)', backgroundColor: 'var(--c-status-publishing-bg)' },
  posted: { borderLeftColor: 'var(--c-status-posted-fg)', backgroundColor: 'var(--c-status-posted-bg)' },
  failed: { borderLeftColor: 'var(--c-status-failed-fg)', backgroundColor: 'var(--c-status-failed-bg)' },
};

type CalendarItem = PlannerOverview["items"][number] & { occursAt: DateTime };

interface PlannerCalendarProps {
  month?: string;
  statusFilters?: PlannerStatusFilterValue[];
  showImages?: boolean;
}

export async function PlannerCalendar({ month, statusFilters, showImages = true }: PlannerCalendarProps) {
  const ownerSettings = await getOwnerSettings();

  const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
  const timezoneLabel = timezone.replace(/_/g, " ");

  const now = DateTime.now().setZone(timezone);
  const desiredMonth = month
    ? DateTime.fromFormat(month, "yyyy-MM", { zone: timezone })
    : now;
  const isMonthOverride = Boolean(month) && desiredMonth.isValid;
  const referenceMonth = desiredMonth.isValid ? desiredMonth : now;

  const monthStart = referenceMonth.startOf("month");
  const calendarStart = isMonthOverride ? monthStart.startOf("week") : now.startOf("week");
  const calendarEnd = calendarStart.plus({ weeks: 6 }).minus({ days: 1 });

  const overview = await getPlannerOverview({
    rangeStart: calendarStart.toUTC().toJSDate(),
    rangeEnd: calendarEnd.endOf("day").toUTC().toJSDate(),
    includeActivity: false,
  });

  const selectedStatuses = statusFilters?.length
    ? new Set(
      statusFilters
        .flatMap((value) => STATUS_FILTER_VALUE_TO_STATUS[value] ?? [])
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
    const params = new URLSearchParams();
    if (value) {
      params.set("month", value);
    }
    if (statusFilters?.length) {
      params.set("status", statusFilters.join(","));
    }
    if (!showImages) {
      params.set("show_images", "false");
    }
    const query = params.toString();
    return query ? `/planner?${query}` : "/planner";
  };

  const hasStatusFilters = Boolean(statusFilters?.length);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold" style={{ color: 'var(--c-ink)' }}>{monthLabel}</h3>
          <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>Timezone: {timezoneLabel}</p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildMonthHref(prevMonthParam)}
              className="rounded-full bg-primary border border-transparent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Previous month
            </Link>
            <Link
              href={buildMonthHref()}
              className="rounded-full bg-primary border border-transparent px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Today
            </Link>
            <Link
              href={buildMonthHref(nextMonthParam)}
              className="rounded-full bg-primary border border-transparent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              Next month
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <PlannerViewToggle />
            <PlannerStatusFilters selected={statusFilters ?? []} />
          </div>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="w-full space-y-3">
          <div className="hidden grid-cols-7 gap-3 rounded-xl p-2 text-[11px] font-bold uppercase tracking-wider md:grid" style={{ backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' }}>
            {Array.from({ length: 7 }).map((_, index) => {
              const weekday = calendarStart.plus({ days: index }).toFormat("ccc");
              return <span key={weekday} className="px-2 text-center">{weekday}</span>;
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-7">
            {weeks.flat().map(({ date, isCurrentMonth, isToday, items }) => {
              const isWeekend = date.weekday >= 6;
              const cellStyle: React.CSSProperties = isToday
                ? { borderColor: 'var(--c-orange)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--c-orange) 30%, transparent)', background: 'linear-gradient(to bottom right, color-mix(in srgb, var(--c-orange) 14%, transparent), white, color-mix(in srgb, var(--c-status-posted-fg) 20%, transparent))' }
                : isCurrentMonth
                  ? { borderColor: 'var(--c-line)', background: 'linear-gradient(to bottom, white, var(--c-paper-2))' }
                  : { borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)', opacity: 0.7 };
              const classes = [
                "flex min-h-[160px] flex-col gap-3 rounded-2xl border p-4 transition group sm:min-h-[220px]",
                isWeekend && isCurrentMonth && !isToday ? "ring-1 ring-paper-2" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <section key={`${date.toISODate()}-cell`} className={classes} style={cellStyle}>
                  <header className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold" style={{ color: isToday ? 'var(--c-orange)' : 'var(--c-ink)' }}>{date.toFormat("d")}</p>
                      <p className="text-[10px] uppercase font-semibold" style={{ color: isToday ? 'var(--c-orange)' : 'var(--c-ink-3)' }}>{date.toFormat("MMM")}</p>
                    </div>
                    {isToday ? (
                      <span className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow ring-1 ring-white/50" style={{ backgroundColor: 'var(--c-orange)' }}>
                        Today
                      </span>
                    ) : (
                      <AddToCalendarButton date={date.toISO() ?? ""} isToday={false} />
                    )}
                  </header>

                  <div className="flex-1 overflow-y-auto pr-1">
                    {items.length ? (
                      <ul className="space-y-2 text-xs">
                        {items.map((item) => {
                          const statusAccent = STATUS_ACCENT_STYLES[item.status] ?? { borderLeftColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)' };
                          const occursLabel = item.occursAt.toFormat("HH:mm");
                          return (
                            <li
                              key={item.id}
                              className="group relative cursor-pointer overflow-hidden rounded-xl border border-l-4 shadow-sm transition hover:bg-white"
                              style={{ borderColor: 'var(--c-line)', ...statusAccent }}
                            >
                              <Link
                                href={`/planner/${item.id}`}
                                aria-label={`Open details for ${item.campaignName}`}
                                className="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="sr-only">Open details</span>
                              </Link>
                              {showImages && item.mediaPreview ? (
                                <MediaFrame
                                  placement={resolveMediaPlacement({ placement: item.placement })}
                                  size="calendar"
                                  className="mb-2 rounded-md"
                                >
                                  {item.mediaPreview.mediaType === "image" ? (
                                    <BannerOverlay
                                      mediaUrl={item.mediaPreview.url}
                                      config={item.bannerConfig}
                                      label={item.bannerLabel}
                                      className="pointer-events-none h-full w-full"
                                    />
                                  ) : (
                                    <video
                                      src={item.mediaPreview.url}
                                      className="h-full w-full object-contain"
                                      preload="metadata"
                                      muted
                                    />
                                  )}
                                  <span className="absolute left-2 top-2 z-20 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold shadow" style={{ color: 'var(--c-ink-2)' }}>
                                    {occursLabel}
                                  </span>
                                  <span
                                    className="absolute right-2 top-2 z-20 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow"
                                    style={STATUS_TEXT_STYLES[item.status] ?? { color: 'var(--c-ink-2)' }}
                                  >
                                    {formatStatusLabel(item.status)}
                                  </span>
                                </MediaFrame>
                              ) : null}
                              {!showImages ? (
                                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)' }}>
                                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}>
                                    {occursLabel}
                                  </span>
                                  <span
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border border-transparent"
                                    style={STATUS_TEXT_STYLES[item.status] ?? { color: 'var(--c-ink-2)' }}
                                  >
                                    {formatStatusLabel(item.status)}
                                  </span>
                                </div>
                              ) : null}
                              <div className="space-y-3 p-3">
                                <div>
                                  <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
                                    {item.campaignName}
                                  </p>
                                  <p className="text-[11px]" style={{ color: 'var(--c-ink-3)' }}>
                                    {item.occursAt.toFormat("cccc d LLLL")}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--c-ink-3)' }}>
                                  <span
                                    className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wide"
                                    style={PLATFORM_STYLES[item.platform] ?? {}}
                                  >
                                    {formatPlatformLabel(item.platform)}
                                  </span>
                                  {item.placement === "story" ? (
                                    <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wide" style={{ backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}>
                                      Story
                                    </span>
                                  ) : null}
                                  {item.status === "draft" && item.autoGenerated ? (
                                    <span className="font-medium" style={{ color: 'var(--c-status-draft-fg)' }}>Auto-generated draft</span>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-primary">Open details</span>
                                  <div className="relative z-20 shrink-0">
                                    <DeleteContentButton contentId={item.id} />
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed px-2 py-4 text-center text-xs" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' }}>
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
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>
        <p>
          Showing scheduled posts and stories for {monthLabel} in {timezoneLabel}. Planner updates automatically when
          campaigns are approved.
        </p>
        <CreateWeeklyPlanButton />
      </div>

      {
        trashedItems.length ? (
          <section className="rounded-2xl border p-4 shadow-sm" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-card)' }}>
            <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>Trash</h4>
                <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
                  Recently deleted posts stay here for safe keeping. Restore them any time or they’ll be removed
                  permanently after 7 days.
                </p>
              </div>
            </header>
            <ul className="mt-4 space-y-3">
              {trashedItems.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-4 rounded-2xl border p-4 text-sm shadow-sm"
                  style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                    {item.mediaPreview ? (
                      item.mediaPreview.mediaType === "image" ? (
                        <MediaFrameRawImage
                          src={item.mediaPreview.url}
                          alt={item.mediaPreview.fileName ?? "Post media"}
                          placement={resolveMediaPlacement({ placement: item.placement })}
                          size="preview"
                          className="mx-0"
                        />
                      ) : (
                        <MediaFrameVideo
                          src={item.mediaPreview.url}
                          placement={resolveMediaPlacement({ placement: item.placement })}
                          size="preview"
                          controls
                          className="mx-0"
                        />
                      )
                    ) : null}
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <p className="text-base font-semibold" style={{ color: 'var(--c-ink)' }}>
                          {item.campaignName ?? "Untitled post"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                          <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-0.5 font-semibold uppercase tracking-wide" style={{ color: 'var(--c-ink-2)' }}>
                            {formatPlatformLabel(item.platform)}
                          </span>
                          {item.placement === "story" ? (
                            <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wide" style={{ backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}>
                              Story
                            </span>
                          ) : null}
                          <span
                            className="inline-flex items-center gap-2 rounded-full bg-white/85 px-2.5 py-0.5 font-semibold uppercase tracking-wide shadow"
                            style={STATUS_TEXT_STYLES[item.status] ?? { color: 'var(--c-ink-2)' }}
                          >
                            {formatStatusLabel(item.status)}
                          </span>
                        </div>
                      </div>
                      {item.bodyPreview ? (
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--c-ink-3)' }}>{item.bodyPreview}</p>
                      ) : null}
                      <div className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
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
            <div className="mt-4 flex justify-end">
              <PermanentlyDeleteAllTrashButton />
            </div>
          </section>
        ) : null
      }
    </section >
  );
}
