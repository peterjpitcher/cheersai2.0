import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { socialConnectRequestSchema } from "@/lib/validation/schemas";
import { withAuthValidation, errorResponse } from "@/lib/validation/middleware";

// Facebook App credentials - used for both Facebook and Instagram
const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

// Graph API version
const FB_VERSION = "v23.0";

export async function POST(request: NextRequest) {
  return withAuthValidation(request, socialConnectRequestSchema, async (validatedData, auth) => {
    try {
      const supabase = await createClient();
      const { user, tenantId } = auth;
      const { platform } = validatedData;
      
      // Use environment variable or fallback to production URL
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk";
      const redirectUri = `${baseUrl}/api/social/callback`;
      
      // Store state in session for security
      const state = Buffer.from(JSON.stringify({
        tenant_id: tenantId,
        user_id: user.id,
        platform,
      })).toString("base64");

    let authUrl = "";

    switch (platform) {
      case "facebook":
      case "instagram":
      case "instagram_business":
        // Both Facebook and Instagram use the same Facebook OAuth flow
        // Instagram Business accounts are accessed through Facebook Pages
        
        // Use environment variable or fallback to production URL
        const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk"}/api/social/callback`;
        
        // Scopes for both Facebook and Instagram access
        const scopes = [
          // Facebook permissions
          "email",
          "public_profile",
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_posts",
          // Instagram permissions (via Facebook)
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_comments",
          "instagram_manage_insights",
        ].join(",");
        
        authUrl = `https://www.facebook.com/${FB_VERSION}/dialog/oauth?` +
          `client_id=${FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(redirectUri)}&` +
          `response_type=code&` +
          `state=${state}&` +
          `scope=${scopes}`;
        break;

      case "twitter":
        // Redirect to Twitter connect endpoint which will handle OAuth 2.0
        const twitterConnectResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/auth/twitter/connect`, {
          headers: {
            cookie: request.headers.get('cookie') || '',
          },
        });
        
        if (!twitterConnectResponse.ok) {
          return NextResponse.json({ 
            error: "Failed to initiate Twitter/X connection" 
          }, { status: 500 });
        }
        
        const { authUrl: twitterAuthUrl } = await twitterConnectResponse.json();
        authUrl = twitterAuthUrl;
        break;

      case "google_my_business":
        // Redirect to GMB connect endpoint which will handle OAuth
        const gmbConnectResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/connect`, {
          headers: {
            cookie: request.headers.get('cookie') || '',
          },
        });
        
        if (!gmbConnectResponse.ok) {
          return NextResponse.json({ 
            error: "Failed to initiate Google My Business connection" 
          }, { status: 500 });
        }
        
        const { authUrl: gmbAuthUrl } = await gmbConnectResponse.json();
        authUrl = gmbAuthUrl;
        break;

      default:
        return errorResponse("Unsupported platform", 400);
    }

      return NextResponse.json({ authUrl });
    } catch (error) {
      console.error("Social connect error:", error);
      return errorResponse("Failed to initiate connection", 500);
    }
  });
}