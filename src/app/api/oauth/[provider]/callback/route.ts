import { NextRequest, NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { env } from "@/env";

const SUPPORTED_PROVIDERS = new Set(["facebook", "instagram", "gbp"]);

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
  const redirectTo = `${base}/connections?provider=${provider}&oauth=${errorParam ? "error" : "success"}&state=${state}`;

  return NextResponse.redirect(redirectTo);
}

export const dynamic = "force-dynamic";
