import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from '@/lib/utils/get-app-url';

const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.redirect("/auth/login");
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

    // Get redirect URL and platform from query params
    const searchParams = request.nextUrl.searchParams;
    const redirectParam = searchParams.get("redirect") || "/settings/connections";
    const requestedPlatform = (searchParams.get("platform") || "facebook").toLowerCase();
    const platform = requestedPlatform === "instagram" ? "instagram" : "facebook";

    // Create state parameter for OAuth callback
    const state = Buffer.from(
      JSON.stringify({
        tenant_id: userData.tenant_id,
        platform,
        redirect: redirectParam,
      })
    ).toString("base64");

    // Use environment variable or fallback
    const redirectUri = `${getBaseUrl()}/api/social/callback`;

    // Facebook OAuth permissions needed
    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights",
      "business_management",
    ].join(",");

    // Build Facebook OAuth URL
    const facebookOAuthUrl = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    facebookOAuthUrl.searchParams.set("client_id", FACEBOOK_APP_ID);
    facebookOAuthUrl.searchParams.set("redirect_uri", redirectUri);
    facebookOAuthUrl.searchParams.set("state", state);
    facebookOAuthUrl.searchParams.set("scope", scopes);
    facebookOAuthUrl.searchParams.set("response_type", "code");

    // Redirect to Facebook OAuth
    return NextResponse.redirect(facebookOAuthUrl.toString());
  } catch (error) {
    console.error("Facebook OAuth initiation error:", error);
    return NextResponse.redirect("/settings/connections?error=oauth_init_failed");
  }
}
