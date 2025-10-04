"use client";

import { useTransition } from "react";

import { startConnectionOAuth } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

interface ConnectionOAuthButtonProps {
  provider: "facebook" | "instagram" | "gbp";
  status: "active" | "expiring" | "needs_action";
}

const PROVIDER_LABELS = {
  facebook: "Reconnect",
  instagram: "Reconnect",
  gbp: "Reconnect",
} as const;

const REFRESH_LABELS = {
  facebook: "Refresh tokens",
  instagram: "Refresh tokens",
  gbp: "Refresh tokens",
} as const;

export function ConnectionOAuthButton({ provider, status }: ConnectionOAuthButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await startConnectionOAuth({ provider });
        if (!result?.url) {
          throw new Error("Missing redirect URL");
        }
        toast.success("Redirecting to provider…");
        window.location.href = result.url;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Could not start OAuth flow", { description: message });
      }
    });
  };

  const label = status === "needs_action" ? PROVIDER_LABELS[provider] : REFRESH_LABELS[provider];

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Redirecting…" : label}
    </button>
  );
}
