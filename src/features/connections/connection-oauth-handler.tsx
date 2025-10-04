"use client";

import { useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { completeConnectionOAuth } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

export function ConnectionOAuthHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const status = searchParams.get("oauth");
    const state = searchParams.get("state");
    const provider = searchParams.get("provider");

    if (!status || !provider) {
      return;
    }

    if (status === "success" && state) {
      startTransition(async () => {
        try {
          const result = await completeConnectionOAuth({ state });
          toast.success(`Reconnected ${provider} successfully`);
          const destination = typeof result?.redirectTo === "string" ? result.redirectTo : "/connections";
          router.replace(destination);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Something went wrong";
          toast.error("Could not finish reconnect", { description: message });
          router.replace("/connections");
        }
      });
    } else if (status === "error") {
      toast.error(`The ${provider} authorization was cancelled. Please try again.`);
      router.replace("/connections");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  return isPending ? (
    <p className="text-xs text-slate-500">Finalising connection…</p>
  ) : null;
}
