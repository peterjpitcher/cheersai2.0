import { unstable_rethrow } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";

import { completeOAuthConnect } from "@/app/(app)/connections/actions";
import { CONNECT_MESSAGES } from "@/lib/connections/messages";
import { PAGE_CHOICE_PATH } from "@/lib/connections/page-choice";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { env } from "@/env";

const SUPPORTED_PROVIDERS = new Set(["facebook", "instagram"]);

const logger = createLogger("oauth");

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

  const base = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

  if (!state) {
    // Nothing to look up: send the owner back with plain words, not a JSON body.
    logger.warn("OAuth callback without a state", { provider, providerError: errorParam ?? null });
    return redirectToConnections(base, { oauth: "error", provider, message: CONNECT_MESSAGES.expiredLink });
  }

  if (errorParam || !code) {
    const reason = errorParam ?? errorDescription ?? "missing_code";
    await markOAuthStateFailed(state, provider, reason);
    logger.warn("OAuth callback without a code", { provider, reason });
    return redirectToConnections(base, {
      oauth: "error",
      provider,
      message: CONNECT_MESSAGES.cancelled,
    });
  }

  try {
    const result = await completeOAuthConnect(provider, code, state);
    if (!result.success) {
      // completeOAuthConnect returns plain words and logs the detail itself.
      return redirectToConnections(base, {
        oauth: "error",
        provider,
        message: result.error ?? CONNECT_MESSAGES.finishFailed,
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
    // A signed-out owner is sent to sign in (requireOwnerContext redirects by
    // throwing), not to /connections with "NEXT_REDIRECT" as the message.
    unstable_rethrow(error);
    logger.error("OAuth callback failed", toLoggableError(error), { provider });
    return redirectToConnections(base, {
      oauth: "error",
      provider,
      message: CONNECT_MESSAGES.finishFailed,
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
    logger.error("failed to mark OAuth state as failed", toLoggableError(error), { provider });
  }
}

function redirectToConnections(base: string, params: Record<string, string>) {
  const redirectUrl = new URL("/connections", base);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return NextResponse.redirect(redirectUrl);
}
