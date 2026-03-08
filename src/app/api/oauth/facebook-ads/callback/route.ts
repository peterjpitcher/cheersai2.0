import { NextRequest, NextResponse } from "next/server";

import { env } from "@/env";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
const REDIRECT_URI = `${SITE_URL}/api/oauth/facebook-ads/callback`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam =
    url.searchParams.get("error") ?? url.searchParams.get("error_message");

  if (!state) {
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=missing_state`);
  }

  const supabase = createServiceSupabaseClient();

  // Validate the state token
  const { data: oauthState, error: stateError } = await supabase
    .from("oauth_states")
    .select("account_id, used_at")
    .eq("state", state)
    .eq("provider", "facebook")
    .maybeSingle<{ account_id: string | null; used_at: string | null }>();

  if (stateError || !oauthState) {
    console.error("[facebook-ads-callback] state lookup failed", stateError);
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=invalid_state`);
  }

  if (oauthState.used_at) {
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=state_already_used`);
  }

  // Mark state as used
  await supabase
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state);

  if (errorParam || !code) {
    const reason = errorParam ?? "no_code";
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=${encodeURIComponent(reason)}`);
  }

  if (!oauthState.account_id) {
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=missing_account`);
  }

  const accountId = oauthState.account_id;

  try {
    const graphBase = getMetaGraphApiBase();

    // Exchange code for short-lived token
    const shortParams = new URLSearchParams({
      client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
      client_secret: env.server.FACEBOOK_APP_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    });

    const shortResponse = await fetch(
      `${graphBase}/oauth/access_token?${shortParams.toString()}`,
    );
    const shortJson = (await safeJson(shortResponse)) as Record<string, unknown> | null;

    if (!shortResponse.ok) {
      const reason = resolveGraphError(shortJson);
      console.error("[facebook-ads-callback] short-lived token exchange failed", reason);
      return NextResponse.redirect(
        `${SITE_URL}/connections?ads_error=${encodeURIComponent(reason)}`,
      );
    }

    const shortToken =
      typeof shortJson?.access_token === "string" ? shortJson.access_token : null;
    if (!shortToken) {
      return NextResponse.redirect(`${SITE_URL}/connections?ads_error=token_missing`);
    }

    // Exchange for long-lived (60-day) token
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
      client_secret: env.server.FACEBOOK_APP_SECRET,
      fb_exchange_token: shortToken,
    });

    const longResponse = await fetch(
      `${graphBase}/oauth/access_token?${longParams.toString()}`,
    );
    const longJson = (await safeJson(longResponse)) as Record<string, unknown> | null;

    let accessToken = shortToken;
    let tokenExpiresAt: string | null = null;

    if (longResponse.ok && typeof longJson?.access_token === "string") {
      accessToken = longJson.access_token;
      const expiresIn = Number(longJson?.expires_in ?? 0);
      if (Number.isFinite(expiresIn) && expiresIn > 0) {
        tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      }
    } else {
      console.warn(
        "[facebook-ads-callback] long-lived token exchange failed, using short-lived token",
        resolveGraphError(longJson),
      );
      const shortExpiresIn = Number(shortJson?.expires_in ?? 0);
      if (Number.isFinite(shortExpiresIn) && shortExpiresIn > 0) {
        tokenExpiresAt = new Date(Date.now() + shortExpiresIn * 1000).toISOString();
      }
    }

    // Upsert into meta_ad_accounts — setup_complete stays false until account is selected
    const { error: upsertError } = await supabase
      .from("meta_ad_accounts")
      .upsert(
        {
          account_id: accountId,
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          setup_complete: false,
          meta_account_id: "",
        },
        { onConflict: "account_id" },
      );

    if (upsertError) {
      console.error("[facebook-ads-callback] upsert failed", upsertError);
      return NextResponse.redirect(`${SITE_URL}/connections?ads_error=db_error`);
    }

    return NextResponse.redirect(`${SITE_URL}/connections?ads_step=select_account`);
  } catch (error) {
    console.error("[facebook-ads-callback] unexpected error", error);
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=unexpected_error`);
  }
}

export const dynamic = "force-dynamic";

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveGraphError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } })
      .error;
    const message = err?.message ?? "Unknown Graph API error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook token exchange failed";
}
