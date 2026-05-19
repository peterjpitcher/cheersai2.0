import { NextRequest, NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { env } from "@/env";

const SUPPORTED_PROVIDERS = new Set(["facebook", "instagram", "gbp"]);

/**
 * OAuth callback route.
 * Receives the auth code and state from the provider, stores the code
 * in oauth_states for the server action to complete the flow.
 * Redirects to /connections with success/error status.
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

  const supabase = createServiceSupabaseClient();
  const usedAt = new Date().toISOString();

  // Store the auth code (or error) on the oauth_states row.
  // The server action (completeOAuthConnect) will validate and complete the flow.
  const updates = {
    used_at: usedAt,
    auth_code: code ?? null,
    error: errorParam ?? errorDescription ?? null,
  };

  const { error } = await supabase
    .from("oauth_states")
    .update(updates)
    .eq("state", state)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

  if (errorParam) {
    const redirectTo = `${base}/connections?error=oauth_failed&provider=${provider}`;
    return NextResponse.redirect(redirectTo);
  }

  const redirectTo = `${base}/connections?connected=${provider}&state=${state}`;
  return NextResponse.redirect(redirectTo);
}

export const dynamic = "force-dynamic";
