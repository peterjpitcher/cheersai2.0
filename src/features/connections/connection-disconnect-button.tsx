"use client";

import { useTransition } from "react";

import { disconnectProvider } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

interface ConnectionDisconnectButtonProps {
  provider: "facebook" | "instagram";
}

const PLATFORM_NAMES = {
  facebook: "Facebook",
  instagram: "Instagram",
} as const;

export function ConnectionDisconnectButton({ provider }: ConnectionDisconnectButtonProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const platform = PLATFORM_NAMES[provider];

  const handleClick = () => {
    const confirmed = window.confirm(
      `Disconnect ${platform}? CheersAI will delete its access, and scheduled ${platform} posts will fail until you reconnect.`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        const result = await disconnectProvider(provider);
        if (!result.success) {
          throw new Error(result.error ?? "Failed to disconnect provider");
        }
        toast.success(`${platform} disconnected`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error(`Could not disconnect ${platform}`, { description: message });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={`Disconnect ${platform}`}
      className="rounded-full border px-4 py-2 text-sm font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ borderColor: "var(--c-claret)", color: "var(--c-claret)", backgroundColor: "var(--c-card)" }}
    >
      {isPending ? "Disconnecting…" : "Disconnect"}
    </button>
  );
}
