"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";

import { updatePlannerContentSchedule } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

const EDITABLE_STATUSES = new Set(["draft", "scheduled", "queued", "failed"]);

interface PlannerContentScheduleFormProps {
  contentId: string;
  initialDate: string;
  initialTime: string;
  timezone: string;
  timezoneLabel: string;
  status: string;
  returnToPlannerAfterSave?: boolean;
}

export function PlannerContentScheduleForm({
  contentId,
  initialDate,
  initialTime,
  timezone,
  timezoneLabel,
  status,
  returnToPlannerAfterSave = true,
}: PlannerContentScheduleFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [baseline, setBaseline] = useState({ date: initialDate, time: initialTime });
  const [shouldReturnToPlanner, setShouldReturnToPlanner] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canEdit = EDITABLE_STATUSES.has(status);
  const isDirty = date !== baseline.date || time !== baseline.time;
  const minDate = DateTime.now().setZone(timezone).toISODate() ?? initialDate;

  useEffect(() => {
    if (!shouldReturnToPlanner) return;
    const timeoutId = globalThis.setTimeout(() => {
      router.replace("/planner");
    }, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [router, shouldReturnToPlanner]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || isPending) return;
    if (!date || !time) {
      setError("Pick both a date and time.");
      return;
    }

    setError(null);
    setFeedback(null);

    startTransition(async () => {
      try {
        const result = await updatePlannerContentSchedule({ contentId, date, time });
        const scheduled = DateTime.fromISO(result.scheduledFor, { zone: "utc" }).setZone(result.timezone);
        const nextDate = scheduled.toISODate() ?? date;
        const nextTime = scheduled.toFormat("HH:mm");
        setDate(nextDate);
        setTime(nextTime);
        setBaseline({ date: nextDate, time: nextTime });
        const friendly = scheduled.toFormat("cccc d LLLL yyyy · HH:mm");
        setFeedback(`Scheduled for ${friendly}`);
        toast.success("Schedule updated", {
          description: `Post will go out at ${friendly} (${timezoneLabel}).`,
        });
        if (returnToPlannerAfterSave) {
          setShouldReturnToPlanner(true);
        } else {
          router.refresh();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update schedule.";
        setError(message);
        toast.error("Could not update", { description: message });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Date
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            min={minDate}
            disabled={!canEdit || isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Time
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            step={60}
            disabled={!canEdit || isPending}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>Timezone: {timezoneLabel}</span>
        {!canEdit ? <span>This post can no longer be rescheduled.</span> : null}
      </div>
      <div className="space-y-3">
        <div className="min-h-[1.25rem] text-xs text-rose-600">{error ?? ""}</div>
        <div className="min-h-[1.25rem] text-xs text-emerald-600">{feedback ?? ""}</div>
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!canEdit || !isDirty || isPending}
            className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:bg-brand-navy/60"
          >
            {isPending ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>
    </form>
  );
}
