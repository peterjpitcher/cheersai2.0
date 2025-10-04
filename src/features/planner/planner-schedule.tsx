import Link from "next/link";
import { DateTime } from "luxon";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

const STATUS_STYLES = {
  draft: "bg-amber-100 text-amber-700",
  scheduled: "bg-slate-100 text-slate-700",
  publishing: "bg-blue-100 text-blue-700",
  posted: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
} as const;

const PLATFORM_STYLES = {
  facebook: "bg-blue-100 text-blue-700",
  instagram: "bg-pink-100 text-pink-700",
  gbp: "bg-emerald-100 text-emerald-700",
} as const;

export async function PlannerSchedule() {
  const [{ items }, settings] = await Promise.all([getPlannerOverview(), getOwnerSettings()]);
  const timezone = settings.posting.timezone ?? DEFAULT_TIMEZONE;

  const draftsAwaiting = items.filter((item) => item.status === "draft").length;

  const now = DateTime.now().setZone(timezone);
  const startOfToday = now.startOf("day");
  const days = Array.from({ length: 7 }, (_, index) => startOfToday.plus({ days: index }));

  const scheduledItems = items
    .map((item) => {
      const occursAtUtc = DateTime.fromISO(item.scheduledFor, { zone: "utc" });
      const occursAt = occursAtUtc.isValid ? occursAtUtc.setZone(timezone) : null;
      return {
        ...item,
        occursAt,
      };
    })
    .filter((item) => item.occursAt !== null)
    .sort((a, b) => a.occursAt!.toMillis() - b.occursAt!.toMillis());

  const schedule = days.map((day) => {
    const itemsForDay = scheduledItems.filter((item) => item.occursAt!.hasSame(day, "day"));
    return {
      day,
      items: itemsForDay,
    };
  });

  const timezoneLabel = timezone.replace(/_/g, " ");

  return (
    <div className="space-y-6">
      {scheduledItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
          No scheduled content yet. Create a campaign or instant post to fill your week.
        </div>
      ) : null}

      {draftsAwaiting > 0 ? (
        <div
          aria-live="polite"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-700"
        >
          {draftsAwaiting === 1
            ? "1 draft is waiting for your approval."
            : `${draftsAwaiting} drafts are waiting for your approval.`}
          {" "}
          Approving will schedule the post immediately — you’ll see a confirmation in the toast tray.
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] gap-4 md:grid-cols-7">
          {schedule.map(({ day, items: dayItems }) => {
            const isToday = day.hasSame(now, "day");
            return (
              <section
                key={day.toISODate() ?? day.toString()}
                className="flex h-full min-h-[240px] flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <header className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{day.toFormat("ccc d MMM")}</p>
                    <p className="text-xs text-slate-500">{day.toFormat("EEEE")}</p>
                  </div>
                  {isToday ? (
                    <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                      Today
                    </span>
                  ) : null}
                </header>

                <div className="flex-1 space-y-3">
                  {dayItems.length ? (
                    dayItems.map((item) => {
                      const occursAt = item.occursAt!;
                      return (
                        <article
                          key={item.id}
                          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${
                                PLATFORM_STYLES[item.platform]
                              }`}
                            >
                              {formatPlatformLabel(item.platform)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-medium uppercase ${
                                STATUS_STYLES[item.status]
                              }`}
                            >
                              {formatStatusLabel(item.status)}
                            </span>
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-900">{item.campaignName}</p>
                            <p className="text-xs text-slate-500">
                              {occursAt.toFormat("HH:mm")} · {timezoneLabel}
                            </p>
                            {item.status === "draft" && item.autoGenerated ? (
                              <p className="text-xs font-medium text-amber-700">
                                Needs approval — generated from your recurring plan.
                              </p>
                            ) : null}
                          </div>

                          {item.status === "draft" ? (
                            <ApproveDraftButton contentId={item.id} />
                          ) : (
                            <Link
                              href={`/planner/${item.id}`}
                              className="self-start rounded-full border border-slate-900 px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white"
                            >
                              View details
                            </Link>
                          )}
                        </article>
                      );
                    })
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500">
                      No posts scheduled.
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Showing the next 7 days in {timezoneLabel}. Planner refreshes automatically when new posts are approved.
        </p>
        <button className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
          Create weekly plan
        </button>
      </div>
    </div>
  );
}
