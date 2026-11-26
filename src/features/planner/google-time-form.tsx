"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";

import { moveGoogleVersion } from "@/app/(app)/planner/google-version-actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";

/**
 * The time of a Google post (tasks/SPEC-gbp-separate-posts.md, decision D16).
 * A Google post goes out with its Facebook post unless a person gives it its
 * own time here; "Use the Facebook post's time" puts it back.
 *
 * The date and time are read in the brand's time zone with Luxon, so a time
 * typed in winter (GMT) or summer (BST) means that wall-clock time on that
 * day. A time that does not exist on the spring clock-change day (01:00 to
 * 01:59) is moved forward an hour by Luxon, which is what the planner's other
 * schedule forms do.
 */

interface GoogleTimeFormProps {
  contentId: string;
  /** The time it goes out now (ISO), own or the Facebook post's. Null when the Facebook post has no time. */
  currentTime: string | null;
  /** True when the Google post has its own time. */
  hasOwnTime: boolean;
  canMove: boolean;
  timezone: string;
  timezoneLabel: string;
  /** Called after the time is saved, so a caller holding its own copy (the planner drawer) can re-read it. */
  onChanged?: () => void;
}

export function GoogleTimeForm({
  contentId,
  currentTime,
  hasOwnTime,
  canMove,
  timezone,
  timezoneLabel,
  onChanged,
}: GoogleTimeFormProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const current = currentTime ? DateTime.fromISO(currentTime, { zone: "utc" }).setZone(timezone) : null;
  const [date, setDate] = useState(current?.toISODate() ?? "");
  const [time, setTime] = useState(current?.toFormat("HH:mm") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const minDate = DateTime.now().setZone(timezone).toISODate() ?? undefined;
  const isDirty = date !== (current?.toISODate() ?? "") || time !== (current?.toFormat("HH:mm") ?? "");

  const run = (scheduledFor: string | null, done: string): void => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await moveGoogleVersion({ contentId, scheduledFor });
        if (!result.success) {
          const message = result.error ?? "Please try again.";
          setError(message);
          toast.error("Could not change the time", { description: message });
          return;
        }
        toast.success(done);
        onChanged?.();
        router.refresh();
      } catch {
        setError("Please try again.");
        toast.error("Could not change the time", { description: "Please try again." });
      }
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canMove || isPending) return;
    const chosen = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
    if (!date || !time || !chosen.isValid) {
      setError("Pick both a date and a time.");
      return;
    }
    run(chosen.toUTC().toISO(), "Google post time saved");
  };

  if (!canMove) {
    return (
      <p className="text-sm text-[var(--c-ink-2)]">
        {current ? current.toFormat("cccc d LLLL yyyy, HH:mm") : "No time set."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="eyebrow text-[var(--c-ink-3)]">Date</span>
          <input
            type="date"
            value={date}
            min={minDate}
            onChange={(event) => setDate(event.target.value)}
            disabled={isPending}
            className="rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-2 text-[var(--c-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="eyebrow text-[var(--c-ink-3)]">Time ({timezoneLabel})</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            disabled={isPending}
            className="rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-2 text-[var(--c-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]"
          />
        </label>
        <Button type="submit" size="sm" disabled={isPending || !isDirty}>
          Save time
        </Button>
        {hasOwnTime && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => run(null, "Back on the Facebook post's time")}
          >
            Use the Facebook post&apos;s time
          </Button>
        )}
      </div>
      <p className="text-sm text-[var(--c-ink-2)]">
        {hasOwnTime
          ? "This Google post has its own time."
          : "This Google post goes out at the same time as its Facebook post until you give it its own time."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-[var(--c-claret)]">
          {error}
        </p>
      )}
    </form>
  );
}
