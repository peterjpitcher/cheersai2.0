import { NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase/route";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;
const attemptStore = new Map<string, { count: number; resetAt: number }>();

type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

function getClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first && first.trim().length) {
      return first.trim();
    }
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(request: Request) {
  const key = getClientKey(request);
  const now = Date.now();
  const record = attemptStore.get(key);
  if (!record || record.resetAt < now) {
    attemptStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  record.count += 1;
  attemptStore.set(key, record);
  return record.count > RATE_LIMIT_MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
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
