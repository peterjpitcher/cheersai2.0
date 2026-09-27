"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Play, RefreshCw, Trash2 } from "lucide-react";

import {
  deletePlannerContent,
  publishPlannerContentNow,
  restorePlannerContent,
} from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * The live publish worker takes anything due within its five minute lead
 * window on its next run (the scheduler cron runs every minute). A send time
 * later than this means the slot was taken and the post was moved, so it is
 * not going out "now".
 */
const SEND_NOW_WINDOW_MINUTES = 5;

// The page is a server component and cannot pass an icon component across the
// client boundary, so it picks one by name.
const PUBLISH_ICONS = { play: Play, retry: RefreshCw } as const;

interface PublishNowButtonProps {
  contentId: string;
  label?: string;
  variant?: ButtonProps["variant"];
  icon?: keyof typeof PUBLISH_ICONS;
}

export function PublishNowButton({
  contentId,
  label = "Publish now",
  variant = "amber",
  icon = "play",
}: PublishNowButtonProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await publishPlannerContentNow({ contentId });

        if ("error" in result && typeof result.error === "string") {
          toast.error("Could not publish", { description: result.error });
          return;
        }

        if (!("ok" in result)) return;

        const sendAt = DateTime.fromISO(result.scheduledFor, { zone: "utc" }).setZone(result.timezone);
        const minutesAway = sendAt.diffNow("minutes").minutes;

        if (minutesAway > SEND_NOW_WINDOW_MINUTES) {
          // A feed post keeps a 30 minute gap from others on the same channel
          // that day, so the schedule action moved it to the next free slot.
          const slotNote = "Another post already goes out on this channel at this time, so this one takes the next free slot.";
          toast.info(`Scheduled for ${sendAt.toFormat("HH:mm")}`, {
            description: result.warning ? `${slotNote} ${result.warning}` : slotNote,
            durationMs: 9000,
          });
        } else if (result.warning) {
          // Advisory only: the post is already on its way.
          toast.info("Publishing now, but check the copy", { description: result.warning, durationMs: 9000 });
        } else {
          toast.success("Publishing now", { description: "It should go out within a couple of minutes." });
        }

        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to publish this post.";
        toast.error("Could not publish", { description: message });
      }
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      size="md"
      icon={PUBLISH_ICONS[icon]}
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Publishing…" : label}
    </Button>
  );
}

interface CancelPostButtonProps {
  contentId: string;
}

export function CancelPostButton({ contentId }: CancelPostButtonProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // Runs from the toast after this page has gone, so it must not rely on
  // component state.
  const handleUndo = async () => {
    try {
      await restorePlannerContent({ contentId });
      router.refresh();
      toast.success("Post restored", { description: "The post is back in your planner." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to restore post.";
      toast.error("Could not restore post", { description: message });
    }
  };

  const handleClick = () => {
    const confirmed = window.confirm(
      "Cancel this post? It will not be published. It moves to Trash, where you can restore it.",
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        await deletePlannerContent({ contentId });
        toast.success("Post cancelled", {
          description: "It will not be published. Undo within 10 seconds or restore it later from the Trash section.",
          durationMs: 10_000,
          action: { label: "Undo", onClick: handleUndo },
        });
        // The post page only shows live posts, so go back to the planner.
        router.push("/planner");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to cancel post.";
        toast.error("Could not cancel post", { description: message });
      }
    });
  };

  return (
    <Button type="button" variant="danger" size="md" icon={Trash2} onClick={handleClick} disabled={isPending}>
      {isPending ? "Cancelling…" : "Cancel this post"}
    </Button>
  );
}
