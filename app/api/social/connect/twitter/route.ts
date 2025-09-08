import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from '@/lib/utils/get-app-url';
import crypto from "crypto";

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || "";

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.redirect("/");
    }

    // Get user's tenant ID for state parameter
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.redirect("/settings/connections?error=no_tenant");
    }

    // Get redirect URL from query params
    const searchParams = request.nextUrl.searchParams;
    const redirectParam = searchParams.get("redirect") || "/settings/connections";

    // Create state parameter for OAuth callback
    // Generate code verifier and challenge for PKCE
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // Store code verifier in session (we'll need it for token exchange)
    // For now, we'll include it in the state (in production, use secure session storage)
    // Random state string for CSRF protection
    const csrfState = crypto.randomBytes(16).toString("hex");

    // Build state payload expected by callback (camelCase keys)
    const enhancedState = Buffer.from(
      JSON.stringify({
        tenantId: userData.tenant_id,
        platform: "twitter",
        redirect: redirectParam,
        codeVerifier: codeVerifier,
        state: csrfState,
      })
    ).toString("base64");

    // Use environment variable or fallback
    const redirectUri = `${getBaseUrl()}/api/auth/twitter/callback`;

    // Twitter OAuth 2.0 scopes
    const scopes = [
      "tweet.read",
      "tweet.write",
      "users.read",
      "offline.access",
    ].join(" ");

    // Build Twitter OAuth 2.0 URL
    const twitterOAuthUrl = new URL("https://twitter.com/i/oauth2/authorize");
    twitterOAuthUrl.searchParams.set("response_type", "code");
    twitterOAuthUrl.searchParams.set("client_id", TWITTER_CLIENT_ID);
    twitterOAuthUrl.searchParams.set("redirect_uri", redirectUri);
    twitterOAuthUrl.searchParams.set("scope", scopes);
    twitterOAuthUrl.searchParams.set("state", enhancedState);
    twitterOAuthUrl.searchParams.set("code_challenge", codeChallenge);
    twitterOAuthUrl.searchParams.set("code_challenge_method", "S256");

    // Redirect to Twitter OAuth
    return NextResponse.redirect(twitterOAuthUrl.toString());
  } catch (error) {
    console.error("Twitter OAuth initiation error:", error);
    return NextResponse.redirect("/settings/connections?error=oauth_init_failed");
  }
}
