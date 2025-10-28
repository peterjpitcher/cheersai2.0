"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime, getUserTimeZone } from "@/lib/datetime";

export type PlannerSlot = {
  id: string;
  iso: string;
  label: string;
  source: "recommended" | "custom";
  token?: string;
};

interface SchedulePlannerProps {
  slots: PlannerSlot[];
  onCreate: (dateKey: string) => void;
  onMove: (slotId: string, dateKey: string) => void;
  onDelete: (slotId: string) => void;
  onEditTime: (slotId: string, time: string) => void;
  onReset: () => void;
  recommendedDefaults: PlannerSlot[];
  minDate: string;
  maxDate: string | null;
  disableAddReason: string | null;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTimeValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function SchedulePlanner({
  slots,
  onCreate,
  onMove,
  onDelete,
  onEditTime,
  onReset,
  recommendedDefaults,
  minDate,
  maxDate,
  disableAddReason,
}: SchedulePlannerProps) {
  const initialMonth = useMemo(() => {
    if (slots.length > 0) {
      return new Date(slots[0].iso);
    }
    if (minDate) {
      return new Date(`${minDate}T00:00:00`);
    }
    return new Date();
  }, [slots, minDate]);

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = new Date(initialMonth);
    base.setDate(1);
    return base;
  });
  const [newSlotDate, setNewSlotDate] = useState("");
  const userTimeZone = useMemo(() => getUserTimeZone(), []);

  const slotMap = useMemo(() => {
    const map = new Map<string, PlannerSlot[]>();
    slots.forEach((slot) => {
      const dateKey = toDateKey(new Date(slot.iso));
      const list = map.get(dateKey) ?? [];
      list.push(slot);
      map.set(dateKey, list);
    });
    return map;
  }, [slots]);

  const recommendedMap = useMemo(() => {
    const map = new Map<string, PlannerSlot>();
    recommendedDefaults.forEach((slot) => {
      const dateKey = toDateKey(new Date(slot.iso));
      if (!map.has(dateKey)) {
        map.set(dateKey, slot);
      }
    });
    return map;
  }, [recommendedDefaults]);

  const minKey = minDate || null;
  const maxKey = maxDate || null;

  const daysInView = useMemo(() => {
    const firstOfMonth = new Date(viewMonth);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    });
  }, [viewMonth]);

  const canCreateForDate = (dateKey: string) => {
    if (!dateKey) return false;
    if (minKey && dateKey < minKey) return false;
    if (maxKey && dateKey > maxKey) return false;
    return true;
  };

  const handlePrevMonth = () => {
    const next = new Date(viewMonth);
    next.setMonth(viewMonth.getMonth() - 1);
    next.setDate(1);
    const endOfNext = new Date(next.getFullYear(), next.getMonth() + 1, 0);
    if (minKey && toDateKey(endOfNext) < minKey) {
      return;
    }
    setViewMonth(next);
  };

  const handleNextMonth = () => {
    const next = new Date(viewMonth);
    next.setMonth(viewMonth.getMonth() + 1);
    next.setDate(1);
    const startKey = toDateKey(next);
    if (maxKey && startKey > maxKey) {
      return;
    }
    setViewMonth(next);
  };

  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(viewMonth);

  const remainingRecommended = useMemo(() => {
    if (recommendedDefaults.length === 0) return 0;
    const takenTokens = new Set(
      slots.map((slot) => slot.token).filter((token): token is string => Boolean(token))
    );
    return recommendedDefaults.filter((slot) => {
      return slot.token ? !takenTokens.has(slot.token) : false;
    }).length;
  }, [slots, recommendedDefaults]);

  const groupedSlots = useMemo(() => {
    return slots
      .slice()
      .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  }, [slots]);

  return (
    <div className="w-full rounded-card border border-border bg-white p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handlePrevMonth}
            disabled={Boolean(minKey) && toDateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 0)) < (minKey ?? "")}
          >
            <ChevronLeft className="size-4" />
            <span className="sr-only">Previous month</span>
          </Button>
          <div className="font-semibold">{monthLabel}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleNextMonth}
            disabled={Boolean(maxKey) && toDateKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)) > (maxKey ?? "")}
          >
            <ChevronRight className="size-4" />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onReset}
            disabled={recommendedDefaults.length === 0}
          >
            <RefreshCcw className="mr-2 size-4" />
            Reset to recommended
          </Button>
          {remainingRecommended > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">
              {remainingRecommended} recommended posts available
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-medium text-text-secondary">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-2">
        {daysInView.map((day) => {
          const dateKey = toDateKey(day);
          const isCurrentMonth = day.getMonth() === viewMonth.getMonth();
          const daySlots = slotMap.get(dateKey) ?? [];
          const isDisabled =
            !canCreateForDate(dateKey) || Boolean(disableAddReason);
          const showRecommended = !daySlots.length && recommendedMap.has(dateKey);

          const dayClass = [
            "flex h-24 flex-col rounded-md border p-2 text-left transition",
            isCurrentMonth ? "bg-muted/30" : "bg-muted/10 text-text-tertiary",
            daySlots.length ? "border-primary" : "border-border hover:border-border/70",
            isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          ].join(" ");

          const handleDayClick = () => {
            if (isDisabled) return;
            if (!daySlots.length) {
              onCreate(dateKey);
            }
          };

          return (
            <button
              key={dateKey + day.getMonth()}
              type="button"
              onClick={handleDayClick}
              className={dayClass}
              title={
                daySlots.length
                  ? `${daySlots.length} post${daySlots.length === 1 ? "" : "s"} scheduled`
                  : disableAddReason || (isDisabled ? "Date unavailable" : "Click to add post")
              }
              disabled={!isCurrentMonth && !canCreateForDate(dateKey)}
            >
              <div className="flex justify-between text-xs">
                <span className="font-medium">{day.getDate()}</span>
                {showRecommended ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Recommended
                  </span>
                ) : null}
              </div>
              <div className="mt-2 space-y-1">
                {daySlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="rounded-md bg-white/80 p-2 text-xs text-text-secondary shadow-sm"
                  >
                    <div className="font-semibold text-text-primary">
                      {formatTime(slot.iso, userTimeZone)}
                    </div>
                    <div className="truncate">{slot.label}</div>
                    {slot.source === "recommended" && (
                      <div className="text-[10px] uppercase tracking-wide text-amber-600">
                        Recommended
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-card border border-border bg-muted/30 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col">
            <label htmlFor="planner-new-slot" className="text-xs text-text-secondary">
              Add a post on
            </label>
            <input
              id="planner-new-slot"
              type="date"
              value={newSlotDate}
              onChange={(event) => setNewSlotDate(event.target.value)}
              min={minDate}
              max={maxDate ?? undefined}
              className="rounded-md border border-border bg-white px-3 py-2 text-sm"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              if (newSlotDate && !disableAddReason && canCreateForDate(newSlotDate)) {
                onCreate(newSlotDate);
                setNewSlotDate("");
              }
            }}
            disabled={
              !newSlotDate ||
              Boolean(disableAddReason) ||
              !canCreateForDate(newSlotDate) ||
              Boolean(slotMap.get(newSlotDate)?.length)
            }
          >
            Add post
          </Button>
        </div>
        {disableAddReason && (
          <p className="mt-3 text-xs text-destructive">{disableAddReason}</p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {groupedSlots.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No posts planned yet. Add a date above to get started.
          </p>
        ) : (
          groupedSlots.map((slot) => {
            const dateKey = toDateKey(new Date(slot.iso));
            return (
              <div
                key={slot.id}
                className="flex flex-col gap-3 rounded-card border border-border bg-white p-3 shadow-xs md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-end md:gap-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-text-secondary">Date</span>
                    <input
                      type="date"
                      value={dateKey}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue && nextValue !== dateKey && canCreateForDate(nextValue)) {
                          onMove(slot.id, nextValue);
                        }
                      }}
                      min={minDate}
                      max={maxDate ?? undefined}
                      className="h-10 rounded-md border border-border px-3 text-sm"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-text-secondary">Time</span>
                    <input
                      type="time"
                      value={getTimeValue(slot.iso)}
                      onChange={(event) => {
                        const time = event.target.value;
                        if (time) onEditTime(slot.id, time);
                      }}
                      className="h-10 rounded-md border border-border px-3 text-sm"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-text-secondary">Details</span>
                    <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-secondary">
                      <div className="font-medium text-text-primary">
                        {formatDate(slot.iso, userTimeZone, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                      <div className="text-xs">
                        {slot.source === "recommended" ? "Recommended slot" : slot.label}
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(slot.id)}
                  className="self-start md:self-center"
                >
                  <Trash2 className="mr-2 size-4" />
                  Remove
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
