import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Facebook App credentials (you'll need to create a Facebook App)
const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

// Instagram Business API credentials
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || "1138649858083556";
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

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/social/callback`;
    
    // Store state in session for security
    const state = Buffer.from(JSON.stringify({
      tenant_id: userData.tenant_id,
      user_id: user.id,
      platform,
    })).toString("base64");

    let authUrl = "";

    switch (platform) {
      case "facebook":
        // Facebook OAuth URL
        const fbScopes = [
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_posts",
          "public_profile",
        ].join(",");
        
        authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
          `client_id=${FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(redirectUri)}&` +
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
        
        // Instagram Business API uses its own OAuth flow
        const igScopes = [
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_insights",
          "pages_show_list",
          "pages_read_engagement",
          "business_management",
        ].join(",");
        
        // Use Instagram Business Login redirect
        const igRedirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/instagram-business`;
        
        authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
          `client_id=${INSTAGRAM_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(igRedirectUri)}&` +
          `state=${state}&` +
          `scope=${igScopes}&` +
          `response_type=code`;
        break;

      case "google_my_business":
        // Google OAuth would go here
        return NextResponse.json({ 
          error: "Google My Business integration coming soon" 
        }, { status: 400 });

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