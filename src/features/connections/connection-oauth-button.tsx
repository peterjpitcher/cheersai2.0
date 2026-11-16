"use client";

import { useTransition } from "react";

import { initiateOAuthConnect } from "@/app/(app)/connections/actions";
import { initiateGoogleConnect } from "@/app/(app)/connections/google-actions";
import { useToast } from "@/components/providers/toast-provider";

interface ConnectionOAuthButtonProps {
  provider: "facebook" | "instagram" | "gbp";
  status: "active" | "expiring" | "needs_action";
  /** False when nothing is stored yet (never connected, or disconnected). */
  hasAccessToken: boolean;
}

const ACTION_LABELS = {
  active: "Update connection",
  expiring: "Renew access",
  needs_action: "Reconnect",
} as const;

const TRY_AGAIN = "Please try again.";

export function ConnectionOAuthButton({ provider, status, hasAccessToken }: ConnectionOAuthButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  // Facebook and Instagram both sign in through Facebook; Google has its own sign-in.
  const failedTitle = provider === "gbp" ? "Could not open Google" : "Could not open Facebook";

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = provider === "gbp" ? await initiateGoogleConnect() : await initiateOAuthConnect(provider);
        if (!result?.success || !result?.redirectUrl) {
          toast.error(failedTitle, { description: result?.error ?? TRY_AGAIN });
          return;
        }
        toast.success("Redirecting to provider…");
        window.location.href = result.redirectUrl;
      } catch {
        // A thrown server action reaches the browser as technical text: never show it.
        toast.error(failedTitle, { description: TRY_AGAIN });
      }
    });
  };

  // "Reconnect" only makes sense for a stored connection that needs fixing; a
  // venue connecting for the first time (or after disconnecting) sees "Connect".
  const label = hasAccessToken ? ACTION_LABELS[status] : "Connect";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`${label} for ${provider === "gbp" ? "Google" : provider}`}
      className="rounded-full border px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: "var(--c-ink)", backgroundColor: "var(--c-ink)" }}
    >
      {isPending ? "Redirecting…" : label}
    </button>
  );
}
