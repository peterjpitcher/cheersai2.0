"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { approveDraftContent } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";

interface ApproveDraftButtonProps {
  contentId: string;
  disableRefresh?: boolean;
  onApproved?: (result: { status: string; scheduledFor: string | null }) => void;
}

export function ApproveDraftButton({ contentId, disableRefresh = false, onApproved }: ApproveDraftButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const handleClick = () => {
    setError(null);
    const optimisticToastId = toast.info("Approving draft…", { durationMs: 1800 });
    startTransition(async () => {
      try {
        const result = await approveDraftContent({ contentId });
        toast.dismiss(optimisticToastId);
        const scheduledFor = result?.scheduledFor ? new Date(result.scheduledFor) : null;

        if (result?.status === "scheduled") {
          toast.success("Draft approved", {
            description: scheduledFor
              ? `Scheduled for ${scheduledFor.toLocaleString()}`
              : "Queued to publish as soon as possible.",
          });
        } else {
          toast.info("Draft already processed", {
            description: scheduledFor
              ? `Current status: ${result?.status} · ${scheduledFor.toLocaleString()}`
              : `Current status: ${result?.status ?? "unknown"}`,
          });
        }
        if (!disableRefresh) {
          router.refresh();
        }
        onApproved?.({ status: result?.status ?? "unknown", scheduledFor: scheduledFor?.toISOString() ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
        toast.dismiss(optimisticToastId);
        toast.error("Approval failed", {
          description: message,
        });
      }
    });
  };

  return (
    <div className="flex w-full flex-col items-end gap-1 sm:w-auto">
      <Button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        size="sm"
        className="w-full text-xs sm:w-auto"
      >
        {isPending ? "Approving…" : "Review & approve"}
      </Button>
      <div aria-live="polite" className="min-h-[1rem] text-xs text-rose-600">
        {error ?? ""}
      </div>
    </div>
  );
}
