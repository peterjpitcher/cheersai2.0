"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { dismissPlannerNotification } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

interface DismissNotificationButtonProps {
  notificationId: string;
}

export function DismissNotificationButton({ notificationId }: DismissNotificationButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      try {
        await dismissPlannerNotification({ notificationId });
        toast.success("Notification dismissed");
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not dismiss notification", { description: message });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? "Dismissing…" : "Mark done"}
    </button>
  );
}
