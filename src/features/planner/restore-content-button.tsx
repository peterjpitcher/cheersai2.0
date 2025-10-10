"use client";

import { useTransition } from "react";

import { restorePlannerContent } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

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
      className={
        className ??
        "rounded-full border border-brand-teal/40 px-3 py-1 text-[11px] font-semibold text-brand-teal transition hover:border-brand-teal hover:bg-brand-teal/10 disabled:cursor-not-allowed disabled:opacity-60"
      }
      disabled={isPending}
    >
      {isPending ? "Restoring…" : "Restore"}
    </button>
  );
}
