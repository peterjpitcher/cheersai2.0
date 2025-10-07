"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";

import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";

export interface SelectedSlotDisplay {
  key: string;
  date: string; // YYYY-MM-DD in owner timezone
  time: string; // HH:mm
}

export interface SuggestedSlotDisplay {
  id: string;
  date: string;
  time: string;
  label: string;
}

export interface ExistingPlannerItemDisplay {
  id: string;
  scheduledFor: string; // ISO timestamp in UTC
  platform: "facebook" | "instagram" | "gbp";
  status: "draft" | "scheduled" | "publishing" | "posted" | "failed";
}

interface ScheduleCalendarProps {
  timezone: string;
  initialMonth: string; // yyyy-MM
  selected: SelectedSlotDisplay[];
  suggestions?: SuggestedSlotDisplay[];
  existingItems?: ExistingPlannerItemDisplay[];
  onAddSlot: (slot: { date: string; time: string }) => void;
  onRemoveSlot: (slotKey: string) => void;
}

interface DayBucket {
  date: DateTime;
  isCurrentMonth: boolean;
  isToday: boolean;
  existing: Array<ExistingEntry>;
  selected: SelectedSlotDisplay[];
  suggestions: SuggestedSlotDisplay[];
}

interface ExistingEntry {
  id: string;
  occursAt: DateTime;
  platform: "facebook" | "instagram" | "gbp";
  status: "draft" | "scheduled" | "publishing" | "posted" | "failed";
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-600",
  publishing: "bg-blue-100 text-blue-700",
  posted: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  draft: "bg-amber-100 text-amber-700",
};

const MIN_LEAD_MINUTES = 15;

function normaliseDate(value: string) {
  if (!value) return null;
  return value.slice(0, 10);
}

function buildMonthFromIso(month: string, timezone: string) {
  const parsed = DateTime.fromFormat(month, "yyyy-MM", { zone: timezone });
  if (!parsed.isValid) {
    return DateTime.now().setZone(timezone).startOf("month");
  }
  return parsed.startOf("month");
}

export function ScheduleCalendar({
  timezone,
  initialMonth,
  selected,
  suggestions = [],
  existingItems = [],
  onAddSlot,
  onRemoveSlot,
}: ScheduleCalendarProps) {
  const [activeMonth, setActiveMonth] = useState(() => buildMonthFromIso(initialMonth, timezone));
  const today = DateTime.now().setZone(timezone).startOf("day");

  const selectedMap = useMemo(() => {
    const map = new Map<string, SelectedSlotDisplay[]>();
    for (const slot of selected) {
      const dateKey = normaliseDate(slot.date);
      if (!dateKey) continue;
      const bucket = map.get(dateKey) ?? [];
      bucket.push(slot);
      map.set(dateKey, bucket);
    }
    return map;
  }, [selected]);

  const suggestionMap = useMemo(() => {
    const map = new Map<string, SuggestedSlotDisplay[]>();
    for (const suggestion of suggestions) {
      const dateKey = normaliseDate(suggestion.date);
      if (!dateKey) continue;
      const bucket = map.get(dateKey) ?? [];
      bucket.push(suggestion);
      map.set(dateKey, bucket);
    }
    return map;
  }, [suggestions]);

  const selectedKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const slot of selected) {
      set.add(`${normaliseDate(slot.date)}|${slot.time}`);
    }
    return set;
  }, [selected]);

  const existingMap = useMemo(() => {
    const map = new Map<string, ExistingEntry[]>();
    for (const item of existingItems) {
      const occursAtUtc = DateTime.fromISO(item.scheduledFor, { zone: "utc" });
      if (!occursAtUtc.isValid) continue;
      const occursAt = occursAtUtc.setZone(timezone);
      const dateKey = occursAt.toISODate();
      if (!dateKey) continue;
      const bucket = map.get(dateKey) ?? [];
      bucket.push({ id: item.id, occursAt, platform: item.platform, status: item.status });
      map.set(dateKey, bucket);
    }
    return map;
  }, [existingItems, timezone]);

  const monthStart = activeMonth.startOf("month");
  const calendarStart = monthStart.startOf("week");
  const totalDays = 42; // 6 weeks grid

  const days: DayBucket[] = [];
  let cursor = calendarStart;
  for (let i = 0; i < totalDays; i += 1) {
    const isoDate = cursor.toISODate();
    days.push({
      date: cursor,
      isCurrentMonth: cursor.month === monthStart.month,
      isToday: cursor.hasSame(today, "day"),
      existing: isoDate ? existingMap.get(isoDate) ?? [] : [],
      selected: isoDate ? selectedMap.get(isoDate) ?? [] : [],
      suggestions: isoDate ? suggestionMap.get(isoDate) ?? [] : [],
    });
    cursor = cursor.plus({ days: 1 });
  }

  const weeks: DayBucket[][] = [];
  for (let i = 0; i < totalDays; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const monthLabel = monthStart.toFormat("LLLL yyyy");

  const goToMonth = (delta: number) => {
    setActiveMonth((current) => current.plus({ months: delta }).startOf("month"));
  };

  const [pendingSlot, setPendingSlot] = useState<{ date: string; time: string } | null>(null);

  const getMinimumSlot = () => DateTime.now().setZone(timezone).plus({ minutes: MIN_LEAD_MINUTES }).startOf("minute");

  const handleAdd = (date: string) => {
    const defaultSuggestion = suggestionMap.get(date)?.[0];
    const defaultTime = defaultSuggestion?.time ?? "07:00";
    const candidate = DateTime.fromISO(`${date}T${defaultTime}`, { zone: timezone });
    const minSlot = getMinimumSlot();
    const resolved = candidate.isValid ? candidate : DateTime.fromISO(`${date}T07:00`, { zone: timezone });
    const clamped = resolved?.isValid && resolved >= minSlot ? resolved : minSlot;
    setPendingSlot({ date: clamped.toISODate() ?? date, time: clamped.toFormat("HH:mm") });
  };

  const confirmPending = () => {
    if (!pendingSlot) return;
    const { date, time } = pendingSlot;
    const minSlot = getMinimumSlot();
    let target = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
    if (!target.isValid || target < minSlot) {
      target = minSlot;
    }
    onAddSlot({ date: target.toISODate() ?? date, time: target.toFormat("HH:mm") });
    setPendingSlot(null);
  };

  const cancelPending = () => setPendingSlot(null);

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold text-slate-900">Schedule preview</h4>
          <p className="text-xs text-slate-500">
            Click suggested slots to add them. Existing posts appear with platform/status chips so you can avoid clashes.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => goToMonth(-1)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
          >
            Previous
          </button>
          <div className="rounded-full border border-slate-200 px-4 py-1 text-xs font-semibold text-slate-700">
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() => goToMonth(1)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
          >
            Next
          </button>
        </div>
      </header>

      <div className="hidden grid-cols-7 gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
        {Array.from({ length: 7 }).map((_, index) => {
          const weekday = calendarStart.plus({ days: index }).toFormat("ccc");
          return <span key={weekday}>{weekday}</span>;
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
        {weeks.flat().map((day) => {
          const isoDate = day.date.toISODate();
          if (!isoDate) return null;
          const isPending = pendingSlot?.date === isoDate;

          return (
            <div
              key={isoDate}
              className={`flex min-h-[220px] flex-col gap-3 rounded-2xl border p-4 transition ${
                day.isCurrentMonth ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-70"
              } ${day.isToday ? "border-slate-900 shadow-md shadow-slate-900/10" : ""}`}
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{day.date.toFormat("d MMM")}</p>
                  <p className="text-xs text-slate-500">{day.date.toFormat("cccc")}</p>
                </div>
                {day.isToday ? (
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
                    Today
                  </span>
                ) : null}
              </header>

              {day.existing.length ? (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-[11px] text-emerald-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Existing posts</p>
                  <ul className="space-y-1">
                    {day.existing.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2">
                        <span>{item.occursAt.toFormat("HH:mm")}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          {formatPlatformLabel(item.platform)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            STATUS_BADGE[item.status] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {formatStatusLabel(item.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2 text-xs">
                {day.selected.map((slot) => {
                  const suggestionLabel = suggestionMap.get(normaliseDate(slot.date) ?? "")?.find(
                    (suggestion) => suggestion.time === slot.time,
                  )?.label;
                  return (
                    <div
                      key={slot.key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-900">{slot.time}</span>
                        {suggestionLabel ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            {suggestionLabel}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Custom slot</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveSlot(slot.key)}
                        className="rounded-full border border-brand-ambergold bg-brand-ambergold px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-brand-ambergold/90"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}

                {day.suggestions
                  .filter((suggestion) => !selectedKeySet.has(`${normaliseDate(suggestion.date)}|${suggestion.time}`))
                  .map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => onAddSlot({ date: suggestion.date, time: suggestion.time })}
                      className="w-full rounded-xl border border-brand-ambergold bg-brand-ambergold px-3 py-2 text-left text-[11px] font-semibold text-white transition hover:bg-brand-ambergold/90"
                    >
                      Add suggested slot · {suggestion.label} · {suggestion.time}
                    </button>
                  ))}

                {isPending ? (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px]">
                    <input
                      type="time"
                      value={pendingSlot?.time ?? "12:00"}
                      onChange={(event) => setPendingSlot({ date: isoDate, time: event.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                      type="button"
                      onClick={confirmPending}
                      className="rounded-full bg-brand-ambergold px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-ambergold/90"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={cancelPending}
                      className="rounded-full border border-brand-ambergold bg-brand-ambergold px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-brand-ambergold/90"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAdd(isoDate)}
                    className="w-full rounded-xl border border-brand-ambergold bg-brand-ambergold px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-brand-ambergold/90"
                  >
                    Add custom slot
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
