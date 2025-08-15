import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const error = requestUrl.searchParams.get("error");
  const error_description = requestUrl.searchParams.get("error_description");
  const origin = requestUrl.origin;
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  // Handle errors from Supabase
  if (error) {
    console.error("Auth callback error:", error, error_description);
    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(error_description || error)}`
    );
  }

  try {
    const supabase = await createClient();

    // Handle OAuth code exchange (for OAuth providers and email confirmations)
    if (code) {
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
      
      if (sessionError) {
        console.error("Session exchange error:", sessionError);
        return NextResponse.redirect(
          `${origin}/auth/error?message=${encodeURIComponent(sessionError.message)}`
        );
      }

      // Successfully authenticated, check user status
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // For email confirmations, show success page first
        if (type === "signup") {
          return NextResponse.redirect(`${origin}/auth/confirm`);
        }

        // Check if tenant exists for routing
        const { data: userData } = await supabase
          .from("users")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
        
        if (!userData?.tenant_id) {
          // New user, redirect to onboarding
          return NextResponse.redirect(`${origin}/onboarding`);
        } else {
          // Existing user, redirect to dashboard or next URL
          return NextResponse.redirect(`${origin}${next}`);
        }
      }
    }

    // Handle magic link / OTP verification (older Supabase format)
    if (token_hash && type) {
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as any,
      });

      if (otpError) {
        console.error("OTP verification error:", otpError);
        return NextResponse.redirect(
          `${origin}/auth/error?message=${encodeURIComponent(otpError.message)}`
        );
      }

      // Successfully authenticated
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Check if tenant exists
        const { data: userData } = await supabase
          .from("users")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
        
        if (!userData?.tenant_id) {
          // New user, redirect to onboarding
          return NextResponse.redirect(`${origin}/onboarding`);
        } else {
          // Existing user, redirect to dashboard or next URL
          return NextResponse.redirect(`${origin}${next}`);
        }
      }
    }

    // If we get here, something is missing
    console.error("Missing required parameters in callback");
    return NextResponse.redirect(`${origin}/auth/error?message=Invalid callback parameters`);
    
  } catch (err) {
    console.error("Unexpected error in auth callback:", err);
    return NextResponse.redirect(`${origin}/auth/error?message=An unexpected error occurred`);
  }
}