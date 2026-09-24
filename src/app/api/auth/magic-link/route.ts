import { NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { getRateLimitKey, isRateLimited } from "@/lib/auth/rate-limit";
import { isUnknownUserOtpError } from "@/lib/auth/otp-errors";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
type MagicLinkPayload = {
  email?: unknown;
  redirectTo?: unknown;
};

export async function POST(request: Request) {
  const rateKey = getRateLimitKey(request, "magic-link");
  if (await isRateLimited({ key: rateKey, maxAttempts: RATE_LIMIT_MAX_ATTEMPTS, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

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
  // Never create a login from a magic-link request (see src/lib/auth/actions.ts).
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo ?? undefined,
      shouldCreateUser: false,
    },
  });

  if (error && isUnknownUserOtpError(error)) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  if (error) {
    console.error("[auth] signInWithOtp failed", { email, message: error.message, status: error.status });
    return NextResponse.json({ error: "Unable to send magic link." }, { status: 400 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
