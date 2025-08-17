import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
  
  const redirectUri = `${APP_URL}/api/social/callback`;
  
  const fbScopes = [
    "pages_show_list",
    "pages_read_engagement", 
    "pages_manage_posts",
    "public_profile",
  ].join(",");
  
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=${fbScopes}`;

  return NextResponse.json({
    app_id: FACEBOOK_APP_ID,
    app_url: APP_URL,
    redirect_uri: redirectUri,
    redirect_uri_encoded: encodeURIComponent(redirectUri),
    full_oauth_url: authUrl,
    instructions: [
      "1. Copy the redirect_uri above",
      "2. Go to Facebook App Dashboard > Facebook Login > Settings",
      "3. Add this EXACT URI to 'Valid OAuth Redirect URIs'",
      "4. Also go to Settings > Basic and add domain to 'App Domains'",
      "5. Make sure 'Client OAuth Login' and 'Web OAuth Login' are ON"
    ]
  });
}