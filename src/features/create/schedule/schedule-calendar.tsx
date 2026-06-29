"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { DateTime } from "luxon";

import {
  MediaFrameRawImage,
  MediaFrameVideo,
  resolveMediaPlacement,
} from "@/components/media/media-frame";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { DEFAULT_POST_TIME } from "@/lib/constants";

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
  platform: "facebook" | "instagram";
  status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed";
  placement?: "feed" | "story";
  campaignName?: string | null;
  mediaPreview?: {
    url: string;
    mediaType: "image" | "video";
  } | null;
}

interface ScheduleCalendarProps {
  timezone: string;
  initialMonth: string; // yyyy-MM
  selected: SelectedSlotDisplay[];
  suggestions?: SuggestedSlotDisplay[];
  existingItems?: ExistingPlannerItemDisplay[];
  onAddSlot: (slot: { date: string; time: string }) => void;
  showTimes?: boolean;
  onRemoveSlot: (slotKey: string) => void;
  readOnly?: boolean;
  /**
   * Default time (HH:MM) to use when the user clicks "Add custom slot" on a day
   * with no existing suggestion. Defaults to DEFAULT_POST_TIME ("12:00") for
   * feed-style content; pass STORY_POST_TIME ("07:00") when the form is
   * configured for stories only so manually-added story slots default to 7am.
   */
  defaultSlotTime?: string;
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
  platform: "facebook" | "instagram";
  status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed";
  placement?: "feed" | "story";
  campaignName?: string | null;
  mediaPreview?: {
    url: string;
    mediaType: "image" | "video";
  } | null;
}

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  scheduled: { backgroundColor: 'var(--c-status-scheduled-bg)', color: 'var(--c-status-scheduled-fg)' },
  queued: { backgroundColor: 'var(--c-status-scheduled-bg)', color: 'var(--c-status-scheduled-fg)' },
  publishing: { backgroundColor: 'var(--c-status-publishing-bg)', color: 'var(--c-status-publishing-fg)' },
  posted: { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' },
  failed: { backgroundColor: 'var(--c-status-failed-bg)', color: 'var(--c-status-failed-fg)' },
  draft: { backgroundColor: 'var(--c-status-draft-bg)', color: 'var(--c-status-draft-fg)' },
};

const TIME_PRESETS = [
  { time: '07:00', label: '7am' },
  { time: '11:00', label: '11am' },
  { time: '14:00', label: '2pm' },
  { time: '17:00', label: '5pm' },
  { time: '21:00', label: '9pm' },
] as const;

export const SOON_SLOT_LEAD_MINUTES = 10;

export function getMinimumScheduleSlot(now: DateTime, leadMinutes = SOON_SLOT_LEAD_MINUTES) {
  const minimum = now.plus({ minutes: leadMinutes });
  const rounded = minimum.startOf("minute");
  return rounded < minimum ? rounded.plus({ minutes: 1 }) : rounded;
}

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
  showTimes = true,
  readOnly = false,
  defaultSlotTime = DEFAULT_POST_TIME,
}: ScheduleCalendarProps) {
  const [activeMonth, setActiveMonth] = useState(() => buildMonthFromIso(initialMonth, timezone));

  useEffect(() => {
    setActiveMonth(buildMonthFromIso(initialMonth, timezone));
  }, [initialMonth, timezone]);

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
      set.add(showTimes ? `${normaliseDate(slot.date)}|${slot.time ?? DEFAULT_POST_TIME}` : `${normaliseDate(slot.date)}`);
    }
    return set;
  }, [selected, showTimes]);

  const existingMap = useMemo(() => {
    const map = new Map<string, ExistingEntry[]>();
    for (const item of existingItems) {
      const occursAtUtc = DateTime.fromISO(item.scheduledFor, { zone: "utc" });
      if (!occursAtUtc.isValid) continue;
      const occursAt = occursAtUtc.setZone(timezone);
      const dateKey = occursAt.toISODate();
      if (!dateKey) continue;
      const bucket = map.get(dateKey) ?? [];
      bucket.push({
        id: item.id,
        occursAt,
        platform: item.platform,
        status: item.status,
        placement: item.placement,
        campaignName: item.campaignName,
        mediaPreview: item.mediaPreview,
      });
      map.set(dateKey, bucket);
    }
    return map;
  }, [existingItems, timezone]);

  const monthStart = activeMonth.startOf("month");
  const baselineCalendarStart = monthStart.startOf("week");
  const weekStartToday = today.startOf("week");
  const clampToCurrentWeek = monthStart.hasSame(today, "month");
  const calendarStart =
    clampToCurrentWeek && baselineCalendarStart < weekStartToday ? weekStartToday : baselineCalendarStart;
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

  const getMinimumSlot = () => getMinimumScheduleSlot(DateTime.now().setZone(timezone));

  const handleAdd = (date: string) => {
    if (readOnly) return;
    const defaultSuggestion = suggestionMap.get(date)?.[0];
    const defaultTime = defaultSuggestion?.time ?? defaultSlotTime;
    if (!showTimes) {
      onAddSlot({ date, time: defaultTime });
      return;
    }
    const candidate = DateTime.fromISO(`${date}T${defaultTime}`, { zone: timezone });
    const minSlot = getMinimumSlot();
    const resolved = candidate.isValid
      ? candidate
      : DateTime.fromISO(`${date}T${defaultSlotTime}`, { zone: timezone });
    const clamped = resolved?.isValid && resolved >= minSlot ? resolved : minSlot;
    const timeValue = clamped?.isValid ? clamped.toFormat("HH:mm") : defaultTime;
    setPendingSlot({ date, time: timeValue });
  };

  const cancelPending = () => {
    if (readOnly) return;
    setPendingSlot(null);
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>Schedule preview</h4>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
            Click suggested slots to add them. Existing posts appear with platform/status chips so you can avoid clashes.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => goToMonth(-1)}
            className="rounded-full border px-3 py-1 text-xs font-semibold transition hover:opacity-80"
            style={{ borderColor: 'var(--c-line)', color: 'var(--c-ink)' }}
          >
            Previous
          </button>
          <div className="rounded-full border px-4 py-1 text-xs font-semibold" style={{ borderColor: 'var(--c-line)', color: 'var(--c-ink)' }}>
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() => goToMonth(1)}
            className="rounded-full border px-3 py-1 text-xs font-semibold transition hover:opacity-80"
            style={{ borderColor: 'var(--c-line)', color: 'var(--c-ink)' }}
          >
            Next
          </button>
        </div>
      </header>

      <div className="hidden grid-cols-7 gap-3 text-[11px] font-semibold uppercase tracking-wide sm:grid" style={{ color: 'var(--c-ink-3)' }}>
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
          const minimumSlot = getMinimumSlot();
          const minimumSlotDate = minimumSlot.toISODate();
          const soonSlotTime = minimumSlot.toFormat("HH:mm");
          const canShowSoonSlot = minimumSlotDate === isoDate;
          const isSoonSlotAlreadySelected = selectedKeySet.has(`${isoDate}|${soonSlotTime}`);
          const arePresetTimesUnavailable = TIME_PRESETS.every((preset) => {
            const slotDt = DateTime.fromISO(`${isoDate}T${preset.time}`, { zone: timezone });
            return slotDt < minimumSlot;
          });

          const hasSelected = day.selected.length > 0;

          return (
            <div
              key={isoDate}
              className={`${day.isCurrentMonth || hasSelected ? "flex" : "hidden sm:flex"} min-h-[220px] flex-col gap-3 rounded-2xl border p-4 transition`}
              style={
                hasSelected
                  ? { borderColor: 'var(--c-claret)', backgroundColor: 'var(--c-claret-soft)' }
                  : day.isToday
                    ? { borderColor: 'var(--c-orange)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--c-orange) 30%, transparent)', background: 'linear-gradient(to bottom right, color-mix(in srgb, var(--c-orange) 12%, transparent), white, color-mix(in srgb, var(--c-status-posted-fg) 12%, transparent))' }
                    : day.isCurrentMonth
                      ? { borderColor: 'var(--c-line)', background: 'linear-gradient(to bottom, white, var(--c-paper-2))' }
                      : { borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)', opacity: 0.8 }
              }
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>{day.date.toFormat("d MMM")}</p>
                  <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{day.date.toFormat("cccc")}</p>
                </div>
                {day.isToday ? (
                  <span className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow ring-1 ring-white/50" style={{ backgroundColor: 'var(--c-orange)' }}>
                    Today
                  </span>
                ) : null}
              </header>

              {day.existing.length ? (
                <div className="space-y-2 rounded-xl border p-3 text-[11px]" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-ink-2)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--c-ink-2)' }}>Existing posts</p>
                  <ul className="space-y-2">
                    {day.existing.map((item) => {
                      const occursLabel = item.occursAt.toFormat("HH:mm");
                      const name = item.campaignName?.trim() ? item.campaignName : "Scheduled post";
                      const preview = item.mediaPreview;

                      const initialsSource = name?.trim() || formatPlatformLabel(item.platform);
                      const fallbackInitial = initialsSource ? initialsSource.charAt(0).toUpperCase() : "?";

                      return (
                    <li
                      key={item.id}
                      className="flex flex-col gap-3 rounded-xl border bg-white/95 p-3 shadow-sm"
                      style={{ borderColor: 'var(--c-line)' }}
                    >
                      <div className="space-y-2">
                        {preview ? (
                          preview.mediaType === "image" ? (
                            <MediaFrameRawImage
                              src={preview.url}
                              alt={name}
                              placement={resolveMediaPlacement({ placement: item.placement })}
                              size="calendar"
                              className="shadow-sm"
                            />
                          ) : (
                            <MediaFrameVideo
                              src={preview.url}
                              placement={resolveMediaPlacement({ placement: item.placement })}
                              size="calendar"
                              className="shadow-sm"
                            />
                          )
                        ) : (
                          <div className="mx-auto flex aspect-square w-[118px] max-w-full items-center justify-center rounded-lg border text-base font-semibold uppercase tracking-wide shadow-sm" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}>
                            {fallbackInitial}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="whitespace-normal break-words text-sm font-semibold leading-snug" style={{ color: 'var(--c-ink)' }}>
                          {name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--c-ink-3)' }}>
                          <span className="font-medium" style={{ color: 'var(--c-ink)' }}>{occursLabel}</span>
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide" style={{ backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}>
                            {formatPlatformLabel(item.platform)}
                          </span>
                          {item.placement === "story" ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide" style={{ backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}>
                              Story
                            </span>
                          ) : null}
                        </div>
                        <span
                          className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={STATUS_BADGE_STYLES[item.status] ?? { backgroundColor: 'var(--c-paper-2)', color: 'var(--c-ink-3)' }}
                        >
                          {formatStatusLabel(item.status)}
                        </span>
                      </div>
                    </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2 text-xs">
                {day.selected.map((slot) => {
                  const suggestionLabel = suggestionMap.get(normaliseDate(slot.date) ?? "")?.find(
                    (suggestion) => !showTimes || suggestion.time === slot.time,
                  )?.label;
                  return (
                    <div
                      key={slot.key}
                      className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 shadow-sm"
                      style={{ borderColor: 'var(--c-claret)', backgroundColor: 'var(--c-claret-soft)' }}
                    >
                      <div className="flex flex-col">
                        {showTimes ? (
                          <span className="text-sm font-semibold" style={{ color: 'var(--c-claret)' }}>{slot.time ?? DEFAULT_POST_TIME}</span>
                        ) : null}
                        {suggestionLabel ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--c-claret)' }}>
                            {suggestionLabel}
                          </span>
                        ) : (
                          <span className="text-[10px]" style={{ color: 'var(--c-claret)' }}>
                            {showTimes ? "Custom slot" : "Custom date"}
                          </span>
                        )}
                      </div>
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => onRemoveSlot(slot.key)}
                          className="rounded-full border px-2.5 py-1 text-[10px] font-semibold text-white transition hover:opacity-90"
                          style={{ borderColor: 'var(--c-claret)', backgroundColor: 'var(--c-claret)' }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  );
                })}

                {day.suggestions
                  .filter((suggestion) => {
                    const key = showTimes
                      ? `${normaliseDate(suggestion.date)}|${suggestion.time ?? DEFAULT_POST_TIME}`
                      : `${normaliseDate(suggestion.date)}`;
                    return !selectedKeySet.has(key);
                  })
                  .map((suggestion) =>
                    readOnly ? (
                      <div
                        key={suggestion.id}
                        className="w-full rounded-xl border border-dashed bg-white px-3 py-2 text-left text-[11px] font-semibold"
                        style={{ borderColor: 'var(--c-ink-3)', color: 'var(--c-ink)' }}
                      >
                        {showTimes ? "Suggested slot" : "Suggested date"} · {suggestion.label}
                        {showTimes ? ` · ${suggestion.time ?? DEFAULT_POST_TIME}` : ""}
                      </div>
                    ) : (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => onAddSlot({ date: suggestion.date, time: suggestion.time ?? DEFAULT_POST_TIME })}
                        className="w-full rounded-xl border px-3 py-2 text-left text-[11px] font-semibold text-white transition hover:opacity-90"
                        style={{ borderColor: 'var(--c-orange)', backgroundColor: 'var(--c-orange)' }}
                      >
                        Add {showTimes ? "suggested slot" : "suggested date"} · {suggestion.label}
                        {showTimes ? ` · ${suggestion.time ?? DEFAULT_POST_TIME}` : ""}
                      </button>
                    ),
                  )}

                {readOnly ? (
                  <div className="rounded-xl border border-dashed bg-white px-3 py-2 text-[11px] font-semibold" style={{ borderColor: 'var(--c-line)', color: 'var(--c-ink-3)' }}>
                    Enable manual editing to add custom {showTimes ? "slots" : "dates"}.
                  </div>
                ) : isPending ? (
                  <div className="relative space-y-1.5 rounded-xl border bg-white px-3 py-2 text-[11px]" style={{ borderColor: 'var(--c-line)' }}>
                    <div className="flex flex-wrap gap-1.5">
                      {canShowSoonSlot ? (
                        <button
                          type="button"
                          disabled={isSoonSlotAlreadySelected}
                          onClick={() => {
                            onAddSlot({ date: isoDate, time: soonSlotTime });
                            setPendingSlot(null);
                          }}
                          className="rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                          style={{
                            borderColor: 'var(--c-orange)',
                            color: 'white',
                            backgroundColor: 'var(--c-orange)',
                          }}
                        >
                          In 10 min · {soonSlotTime}
                        </button>
                      ) : null}
                      {TIME_PRESETS.map((preset) => {
                        const slotDt = DateTime.fromISO(`${isoDate}T${preset.time}`, { zone: timezone });
                        const isDisabled = slotDt < minimumSlot;
                        const isAlreadySelected = selectedKeySet.has(`${isoDate}|${preset.time}`);

                        return (
                          <button
                            key={preset.time}
                            type="button"
                            disabled={isDisabled || isAlreadySelected}
                            onClick={() => {
                              onAddSlot({ date: isoDate, time: preset.time });
                              setPendingSlot(null);
                            }}
                            className="rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                              borderColor: 'var(--c-line)',
                              color: 'var(--c-ink)',
                              backgroundColor: 'white',
                            }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    {arePresetTimesUnavailable && !canShowSoonSlot && (
                      <p className="text-[10px]" style={{ color: 'var(--c-ink-3)' }}>No times available today</p>
                    )}
                    <button
                      type="button"
                      onClick={cancelPending}
                      aria-label="Close time presets"
                      className="absolute right-2 top-2 rounded-full p-0.5 transition hover:bg-black/5"
                      style={{ color: 'var(--c-ink-3)' }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAdd(isoDate)}
                    aria-label={`${showTimes ? "Add custom slot" : "Add reminder date"} for ${day.date.toFormat("d MMM")}`}
                    className="w-full rounded-xl border px-3 py-2 text-[11px] font-semibold text-white transition hover:opacity-90"
                    style={{ borderColor: 'var(--c-orange)', backgroundColor: 'var(--c-orange)' }}
                  >
                    {showTimes ? "Add custom slot" : "Add reminder date"}
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
