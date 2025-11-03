import { NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase/route";

type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
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
    const status = error.status && error.status >= 400 ? error.status : 503;
    return NextResponse.json({ error: error.message || "Unable to sign in." }, { status });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
