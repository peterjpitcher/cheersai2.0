"use client";

import { useTransition } from "react";

import { deletePlannerContent, restorePlannerContent } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

interface DeleteContentButtonProps {
  contentId: string;
  className?: string;
}

export function DeleteContentButton({ contentId, className }: DeleteContentButtonProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deletePlannerContent({ contentId });
        const handleUndo = () =>
          startTransition(async () => {
            try {
              await restorePlannerContent({ contentId });
              toast.success("Post restored", { description: "The post is back in your planner." });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Something went wrong";
              toast.error("Could not restore post", { description: message });
            }
          });

        toast.success("Post moved to trash", {
          description: "Undo within 10 seconds or restore later from the Trash section.",
          durationMs: 10_000,
          action: {
            label: "Undo",
            onClick: handleUndo,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not delete post", { description: message });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      className={
        className ??
        "rounded-full border border-rose-200 px-3 py-1 text-[11px] font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      }
      disabled={isPending}
    >
      {isPending ? "Deleting…" : "Delete"}
    </button>
  );
}
