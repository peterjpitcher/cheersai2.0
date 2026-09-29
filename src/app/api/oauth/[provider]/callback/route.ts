import { NextRequest, NextResponse } from "next/server";

import { completeOAuthConnect } from "@/app/(app)/connections/actions";
import { PAGE_CHOICE_PATH } from "@/lib/connections/page-choice";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { env } from "@/env";

const SUPPORTED_PROVIDERS = new Set(["facebook", "instagram"]);

/**
 * OAuth callback route.
 * Receives the auth code and state from the provider, completes the token
 * exchange, stores tokens, and redirects to /connections with success/error
 * status, or to the Page chooser when the owner has to pick a Page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error") ?? url.searchParams.get("error_message");
  const errorDescription = url.searchParams.get("error_description");

  if (!state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  const base = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

  if (errorParam || !code) {
    const reason = errorParam ?? errorDescription ?? "missing_code";
    await markOAuthStateFailed(state, provider, reason);
    return redirectToConnections(base, {
      oauth: "error",
      provider,
      message: resolveProviderErrorMessage(reason),
    });
  }

  try {
    const result = await completeOAuthConnect(provider, code, state);
    if (!result.success) {
      return redirectToConnections(base, {
        oauth: "error",
        provider,
        message: result.error ?? "Could not finish the OAuth connection.",
      });
    }
    if (result.pageChoice) {
      // Several Pages and no stored match: the owner chooses. Only the random
      // reference travels in the URL; the tokens stay encrypted on the server.
      const chooserUrl = new URL(PAGE_CHOICE_PATH, base);
      chooserUrl.searchParams.set("choice", result.pageChoice);
      return NextResponse.redirect(chooserUrl);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finish the OAuth connection.";
    return redirectToConnections(base, {
      oauth: "error",
      provider,
      message,
    });
  }

  return redirectToConnections(base, { oauth: "success", provider });
}

export const dynamic = "force-dynamic";

async function markOAuthStateFailed(state: string, provider: string, reason: string) {
  const supabase = createServiceSupabaseClient();
  // Login states only: a pending Page choice carries an encrypted auth_code, and
  // a crafted error callback naming its reference must not use it up.
  const { error } = await supabase
    .from("oauth_states")
    .update({
      used_at: new Date().toISOString(),
      error: reason,
    })
    .eq("state", state)
    .eq("provider", provider)
    .is("auth_code", null);

  if (error) {
    console.error("[oauth] failed to mark OAuth state as failed", error);
  }
}

function redirectToConnections(base: string, params: Record<string, string>) {
  const redirectUrl = new URL("/connections", base);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return NextResponse.redirect(redirectUrl);
}

function resolveProviderErrorMessage(reason: string) {
  if (reason === "missing_code") {
    return "The provider did not return an authorization code. Please try reconnecting.";
  }
  return "The provider authorization was cancelled or failed. Please try reconnecting.";
}
