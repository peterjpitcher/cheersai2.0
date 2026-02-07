"use client";

import { Plus } from "lucide-react";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { useCreateModal } from "@/features/create/create-modal-context";
import { DEFAULT_POST_TIME, DEFAULT_TIMEZONE } from "@/lib/constants";

interface AddToCalendarButtonProps {
  date: string; // ISO date string or date object
  isToday?: boolean;
}

export function AddToCalendarButton({ date, isToday }: AddToCalendarButtonProps) {
  const { openModal } = useCreateModal();

  const handleClick = () => {
    const [hour, minute] = DEFAULT_POST_TIME.split(":").map(Number);
    const dateObj = DateTime.fromISO(date || DateTime.now().toISO(), { zone: DEFAULT_TIMEZONE })
      .set({ hour, minute, second: 0, millisecond: 0 })
      .toJSDate();
    openModal({
      initialTab: "instant",
      initialDate: dateObj,
    });
  };

  return (
    <button
      onClick={handleClick}
      className={`rounded-full p-1 transition-colors hover:bg-black/5 active:bg-black/10 ${
        isToday ? "text-brand-blue hover:bg-brand-blue/10" : "text-brand-navy/40 hover:text-brand-navy"
      }`}
      title="Add post to this day"
    >
      <Plus size={14} strokeWidth={2.5} />
    </button>
  );
}

export function CreateWeeklyPlanButton() {
  const { openModal } = useCreateModal();

  return (
    <Button
      variant="default"
      className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
      onClick={() => openModal({ initialTab: "weekly" })}
    >
      Create weekly plan
    </Button>
  );
}
