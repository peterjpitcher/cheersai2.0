"use client";

import { useTransition } from "react";

import { initiateOAuthConnect } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

interface ChangePageButtonProps {
  provider: "facebook" | "instagram";
  /** True for Change Page (always show the chooser); false restarts a normal connect. */
  changePage?: boolean;
  label?: string;
}

const TRY_AGAIN = "Please try again.";

/**
 * Sends the owner back through the Facebook login. With `changePage` the
 * callback always shows the Page chooser, even when a stored Page matches.
 */
export function ChangePageButton({ provider, changePage = true, label = "Change Page" }: ChangePageButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await initiateOAuthConnect(provider, { changePage });
        if (!result?.success || !result.redirectUrl) {
          toast.error("Could not open Facebook", { description: result?.error ?? TRY_AGAIN });
          return;
        }
        window.location.href = result.redirectUrl;
      } catch {
        // A thrown server action reaches the browser as technical text: never show it.
        toast.error("Could not open Facebook", { description: TRY_AGAIN });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border px-4 py-2 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: "var(--c-ink)", color: "var(--c-ink)", backgroundColor: "var(--c-card)" }}
    >
      {isPending ? "Opening Facebook…" : label}
    </button>
  );
}
