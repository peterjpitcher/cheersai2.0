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
    const errorParam = searchParams.get("error");
    const provider = searchParams.get("provider");
    const message = searchParams.get("message");
    const oauthStatus = searchParams.get("oauth");

    if (!provider && !oauthStatus && !errorParam) return;

    if (oauthStatus === "success" && provider) {
      startTransition(async () => {
        toast.success(`Connected ${provider} successfully`);
        router.replace("/connections");
      });
      return;
    }

    if (errorParam === "oauth_failed" || oauthStatus === "error") {
      const title = provider
        ? `Could not connect ${provider}`
        : "Could not finish connection";
      toast.error(title, {
        description: message ?? "The provider authorization was cancelled or failed. Please try again.",
      });
      router.replace("/connections");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  return isPending ? (
    <p className="text-xs text-slate-500">Finalising connection...</p>
  ) : null;
}
