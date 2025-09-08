import { NextRequest, NextResponse } from "next/server";

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const INSTAGRAM_APP_ID = "1138649858083556";
  const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || "554404bd201993ac8f7d055f33d4a530";
  
  // Test if we can get app info from Facebook Graph API
  const testUrl = `https://graph.facebook.com/v20.0/${INSTAGRAM_APP_ID}?` +
    `access_token=${INSTAGRAM_APP_ID}|${INSTAGRAM_APP_SECRET}`;
  
  let appInfo = null;
  let appError = null;
  
  try {
    const response = await fetch(testUrl);
    const data = await response.json();
    if (data.error) {
      appError = data.error;
    } else {
      appInfo = data;
    }
  } catch (error) {
    appError = error?.toString();
  }
  
  // Check the OAuth URL we're generating
  const igRedirectUri = "https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business";
  
  const igScopes = [
    "instagram_business_basic",
    "instagram_business_manage_messages", 
    "instagram_business_manage_comments",
    "instagram_business_content_publish",
    "instagram_business_manage_insights"
  ].join(",");
  
  const authUrl = `https://www.instagram.com/oauth/authorize?` +
    `force_reauth=true&` +
    `client_id=${INSTAGRAM_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(igRedirectUri)}&` +
    `response_type=code&` +
    `scope=${igScopes}`;

  return NextResponse.json({
    instagram_app: {
      app_id: INSTAGRAM_APP_ID,
      app_secret_configured: !!process.env.INSTAGRAM_APP_SECRET,
      app_secret_first_5: INSTAGRAM_APP_SECRET.substring(0, 5) + "...",
    },
    app_validation: {
      app_info: appInfo,
      app_error: appError,
      test_url: testUrl
    },
    oauth_config: {
      redirect_uri: igRedirectUri,
      scopes: igScopes.split(','),
      full_auth_url: authUrl
    },
    environment: {
      INSTAGRAM_APP_SECRET_ENV: !!process.env.INSTAGRAM_APP_SECRET,
      NODE_ENV: process.env.NODE_ENV
    },
    instructions: [
      "1. Check if app_validation shows an error - this indicates credential issues",
      "2. Verify the Instagram app secret in Vercel matches what's in your Instagram app settings",
      "3. The app secret should be exactly 32 characters",
      "4. Make sure the Instagram app is in Live mode, not Development mode"
    ]
  });
}
