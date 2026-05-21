"use client";

import { useTransition } from "react";

import { initiateOAuthConnect } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

interface ConnectionOAuthButtonProps {
  provider: "facebook" | "instagram" | "gbp";
  status: "active" | "expiring" | "needs_action";
}

const ACTION_LABELS = {
  active: "Update connection",
  expiring: "Renew access",
  needs_action: "Reconnect",
} as const;

export function ConnectionOAuthButton({ provider, status }: ConnectionOAuthButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await initiateOAuthConnect(provider);
        if (!result?.success || !result?.redirectUrl) {
          throw new Error(result?.error ?? "Missing redirect URL");
        }
        toast.success("Redirecting to provider…");
        window.location.href = result.redirectUrl;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not start OAuth flow", { description: message });
      }
    });
  };

  const label = ACTION_LABELS[status];

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`${label} for ${provider}`}
      className="rounded-full border px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: "var(--c-ink)", backgroundColor: "var(--c-ink)" }}
    >
      {isPending ? "Redirecting…" : label}
    </button>
  );
}
