import { NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase/route";

type MagicLinkPayload = {
  email?: unknown;
  redirectTo?: unknown;
};

export async function POST(request: Request) {
  let payload: MagicLinkPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const redirectTo = typeof payload.redirectTo === "string" && payload.redirectTo.length ? payload.redirectTo : null;

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo ?? undefined,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Unable to send magic link." }, { status: 400 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
