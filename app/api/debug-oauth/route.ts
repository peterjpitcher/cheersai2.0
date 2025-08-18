import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
  
  // What we're actually using in production
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const actualRedirectUri = `${baseUrl}/api/social/callback`;
  
  // What Facebook expects (should be hardcoded)
  const expectedRedirectUri = `https://cheersai.orangejelly.co.uk/api/social/callback`;
  
  const fbScopes = [
    "pages_show_list",
    "pages_read_engagement", 
    "pages_manage_posts",
    "public_profile",
  ].join(",");
  
  const authUrl = `https://www.facebook.com/v20.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(actualRedirectUri)}&` +
    `scope=${fbScopes}`;

  return NextResponse.json({
    app_id: FACEBOOK_APP_ID,
    environment: {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "NOT SET",
      actual_host: request.nextUrl.host,
      protocol: request.nextUrl.protocol
    },
    redirect_uris: {
      actual_in_production: actualRedirectUri,
      expected_by_facebook: expectedRedirectUri,
      match: actualRedirectUri === expectedRedirectUri
    },
    full_oauth_url: authUrl,
    required_facebook_settings: {
      "Valid OAuth Redirect URIs": [
        "https://cheersai.orangejelly.co.uk/api/social/callback",
        "https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business"
      ],
      "App Domains": ["cheersai.orangejelly.co.uk"],
      "Site URL": "https://cheersai.orangejelly.co.uk",
      "Client OAuth Login": "ON",
      "Web OAuth Login": "ON"
    },
    instructions: [
      "1. Go to https://developers.facebook.com/apps/" + FACEBOOK_APP_ID + "/fb-login/settings/",
      "2. Add ALL URIs from 'Valid OAuth Redirect URIs' above",
      "3. Make sure 'Client OAuth Login' and 'Web OAuth Login' are both ON",
      "4. Go to Settings > Basic and add 'cheersai.orangejelly.co.uk' to App Domains",
      "5. Save all changes"
    ]
  });
}