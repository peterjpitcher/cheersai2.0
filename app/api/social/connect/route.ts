import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Facebook App credentials (you'll need to create a Facebook App)
const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

// Instagram Business API credentials (separate Instagram app)
const INSTAGRAM_APP_ID = "1138649858083556"; // Your Instagram Business app
const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { platform } = await request.json();
    
    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    // Use environment variable or fallback to production URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk";
    const redirectUri = `${baseUrl}/api/social/callback`;
    
    // Store state in session for security
    const state = Buffer.from(JSON.stringify({
      tenant_id: userData.tenant_id,
      user_id: user.id,
      platform,
    })).toString("base64");

    let authUrl = "";

    switch (platform) {
      case "facebook":
        // Facebook OAuth URL - Use hardcoded production URL for consistency
        // Facebook requires EXACT redirect URI matching
        const fbRedirectUri = "https://cheersai.orangejelly.co.uk/api/social/callback";
        
        const fbScopes = [
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_posts",
          "public_profile",
        ].join(",");
        
        authUrl = `https://www.facebook.com/v20.0/dialog/oauth?` +
          `client_id=${FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(fbRedirectUri)}&` +
          `state=${state}&` +
          `scope=${fbScopes}`;
        break;

      case "instagram":
      case "instagram_business":
        // For demo mode, redirect to demo page
        if (IS_DEMO_MODE) {
          return NextResponse.json({ 
            authUrl: "/settings/connections/demo?demo=true" 
          });
        }
        
        // Use hardcoded production URL for Instagram - Facebook requires EXACT matching
        const igRedirectUri = "https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business";
        
        // Use the exact scopes from your Instagram app configuration
        const igScopes = [
          "instagram_business_basic",
          "instagram_business_manage_messages", 
          "instagram_business_manage_comments",
          "instagram_business_content_publish",
          "instagram_business_manage_insights"
        ].join(",");
        
        // Use Instagram's OAuth URL with your Instagram app ID
        authUrl = `https://www.instagram.com/oauth/authorize?` +
          `force_reauth=true&` +
          `client_id=${INSTAGRAM_APP_ID}&` +  // Use Instagram app ID
          `redirect_uri=${encodeURIComponent(igRedirectUri)}&` +
          `response_type=code&` +
          `scope=${igScopes}&` +
          `state=${state}`;
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
        return NextResponse.json({ 
          error: "Unsupported platform" 
        }, { status: 400 });
    }

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("Social connect error:", error);
    return NextResponse.json(
      { error: "Failed to initiate connection" },
      { status: 500 }
    );
  }
}