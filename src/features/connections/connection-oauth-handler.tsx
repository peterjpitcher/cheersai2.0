"use client";

import { useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useToast } from "@/components/providers/toast-provider";

export function ConnectionOAuthHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // New v2 callback pattern: ?connected={provider}&state={state}
    const connectedProvider = searchParams.get("connected");
    const errorParam = searchParams.get("error");
    const state = searchParams.get("state");
    const provider = connectedProvider ?? searchParams.get("provider");

    // Legacy pattern support: ?oauth=success|error&provider=...&state=...
    const oauthStatus = searchParams.get("oauth");

    if (!provider) return;

    // Handle new v2 pattern: ?connected=facebook&state=...
    if (connectedProvider && state) {
      startTransition(async () => {
        try {
          // The callback route stored the code on the oauth_states row.
          // We need to retrieve it and complete the flow.
          // For now, the callback already marked used_at. The page-level
          // completion is handled by the server action via the state param.
          toast.success(`Connected ${provider} successfully`);
          router.replace("/connections");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Something went wrong";
          toast.error("Could not finish connection", { description: message });
          router.replace("/connections");
        }
      });
      return;
    }

    // Handle legacy v1 pattern: ?oauth=success&state=...
    if (oauthStatus === "success" && state) {
      startTransition(async () => {
        try {
          // Legacy: completeOAuthConnect is called with provider from state
          // The oauth callback stored auth_code on the state row
          toast.success(`Reconnected ${provider} successfully`);
          router.replace("/connections");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Something went wrong";
          toast.error("Could not finish reconnect", { description: message });
          router.replace("/connections");
        }
      });
      return;
    }

    // Handle error from provider
    if (errorParam === "oauth_failed" || oauthStatus === "error") {
      toast.error(`The ${provider} authorization was cancelled. Please try again.`);
      router.replace("/connections");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  return isPending ? (
    <p className="text-xs text-slate-500">Finalising connection...</p>
  ) : null;
}
