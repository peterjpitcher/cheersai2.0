"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { dismissPlannerNotification } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";

interface DismissNotificationButtonProps {
  notificationId: string;
  onDismiss?: (notificationId: string) => void;
}

export function DismissNotificationButton({ notificationId, onDismiss }: DismissNotificationButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      try {
        await dismissPlannerNotification({ notificationId });
        toast.success("Notification dismissed");
        onDismiss?.(notificationId);
        router.refresh();
      } catch {
        // A thrown server action reaches the browser as technical text: never show it.
        const message = "Please try again.";
        toast.error("Could not dismiss notification", { description: message });
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
      className="hover:bg-transparent h-auto py-1 px-3 text-xs"
      style={{ borderColor: "color-mix(in srgb, var(--c-paper-2) 60%, transparent)", color: "var(--c-ink)" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-ink)"; e.currentTarget.style.color = "var(--c-claret)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--c-paper-2) 60%, transparent)"; e.currentTarget.style.color = "var(--c-ink)"; }}
    >
      {isPending ? "Dismissing…" : "Mark done"}
    </Button>
  );
}
