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
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
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
      className="border-brand-mist/60 text-brand-navy hover:border-brand-navy hover:text-brand-rose hover:bg-transparent h-auto py-1 px-3 text-xs"
    >
      {isPending ? "Dismissing…" : "Mark done"}
    </Button>
  );
}
