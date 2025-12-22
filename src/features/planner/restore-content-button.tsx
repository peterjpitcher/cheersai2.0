"use client";

import { useTransition } from "react";

import { permanentlyDeletePlannerContent, restorePlannerContent } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";

interface RestoreContentButtonProps {
  contentId: string;
  className?: string;
}

export function RestoreContentButton({ contentId, className }: RestoreContentButtonProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleRestore = () => {
    startTransition(async () => {
      try {
        await restorePlannerContent({ contentId });
        toast.success("Post restored", { description: "The post is back in your planner." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not restore post", { description: message });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleRestore}
      className={cn(
        "rounded-full border border-transparent bg-primary px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      disabled={isPending}
    >
      {isPending ? "Restoring…" : "Restore"}
    </button>
  );
}

interface PermanentlyDeleteContentButtonProps {
  contentId: string;
  className?: string;
}

export function PermanentlyDeleteContentButton({ contentId, className }: PermanentlyDeleteContentButtonProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    const confirmed = window.confirm("Delete this post permanently? This cannot be undone.");
    if (!confirmed) return;

    startTransition(async () => {
      try {
        await permanentlyDeletePlannerContent({ contentId });
        toast.success("Post deleted", { description: "The post has been removed permanently." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not delete", { description: message });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      className={
        className ??
        "rounded-full border border-rose-300 px-3 py-1 text-[11px] font-semibold text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      }
      disabled={isPending}
    >
      {isPending ? "Deleting…" : "Delete permanently"}
    </button>
  );
}
