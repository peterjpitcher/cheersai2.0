import { NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { getRateLimitKey, isRateLimited } from "@/lib/auth/rate-limit";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;
type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  const rateKey = getRateLimitKey(request, "login");
  if (await isRateLimited({ key: rateKey, maxAttempts: RATE_LIMIT_MAX_ATTEMPTS, windowMs: RATE_LIMIT_WINDOW_MS })) {
    return NextResponse.json({ error: "Too many attempts. Please wait and try again." }, { status: 429 });
  }

  let payload: LoginPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[auth] signInWithPassword failed", { email, message: error.message, status: error.status });
    return NextResponse.json({ error: "Unable to sign in." }, { status: 401 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
