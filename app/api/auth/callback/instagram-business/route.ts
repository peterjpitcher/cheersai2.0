import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  
  // Get parameters from Instagram
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Handle errors
  if (error) {
    console.error("Instagram Business Login error:", error, errorDescription);
    return NextResponse.redirect(
      new URL(`/settings/connections?error=${encodeURIComponent(errorDescription || error)}`, baseUrl)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=No authorization code received", baseUrl)
    );
  }

  try {
    // Exchange code for access token using Instagram App credentials
    const INSTAGRAM_APP_ID = "1138649858083556";
    const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || "";
    
    if (!INSTAGRAM_APP_SECRET) {
      console.error("Instagram app secret not configured in environment variables");
      throw new Error("Instagram app configuration error - missing app secret");
    }
    
    // Use hardcoded production URL - must match exactly what's in Instagram app settings
    const igCallbackUrl = "https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business";
    
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${INSTAGRAM_APP_ID}` +
      `&client_secret=${INSTAGRAM_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(igCallbackUrl)}` +
      `&code=${code}`;

    const tokenResponseActual = await fetch(tokenUrl);
    const tokenData = await tokenResponseActual.json();

    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message || "Failed to get access token");
    }

    // Get user's Instagram Business accounts
    const accountsResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${tokenData.access_token}`
    );
    const accountsData = await accountsResponse.json();

    if (!accountsData.data || accountsData.data.length === 0) {
      throw new Error("No Instagram Business accounts found. Please ensure your Instagram account is converted to a Business account and connected to a Facebook Page.");
    }

    // Get Instagram Business Account IDs for each Facebook Page
    const instagramAccounts = [];
    
    for (const page of accountsData.data) {
      // Get Instagram Business Account connected to this page
      const igResponse = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      );
      const igData = await igResponse.json();
      
      if (igData.instagram_business_account) {
        // Get Instagram account details
        const igDetailsResponse = await fetch(
          `https://graph.facebook.com/v18.0/${igData.instagram_business_account.id}?fields=username,profile_picture_url,followers_count,media_count&access_token=${page.access_token}`
        );
        const igDetails = await igDetailsResponse.json();
        
        instagramAccounts.push({
          id: igData.instagram_business_account.id,
          username: igDetails.username,
          profile_picture_url: igDetails.profile_picture_url,
          followers_count: igDetails.followers_count,
          media_count: igDetails.media_count,
          page_name: page.name,
          page_id: page.id,
          page_access_token: page.access_token,
        });
      }
    }

    if (instagramAccounts.length === 0) {
      throw new Error("No Instagram Business accounts found connected to your Facebook Pages.");
    }

    // Store the connection in database
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(
        new URL("/auth/login", baseUrl)
      );
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      throw new Error("No tenant found for user");
    }

    // Store each Instagram Business account
    for (const account of instagramAccounts) {
      const { error: connectionError } = await supabase
        .from("social_connections")
        .upsert({
          tenant_id: userData.tenant_id,
          platform: "instagram_business",
          account_name: account.username,
          page_name: account.page_name,
          platform_user_id: account.id,
          platform_page_id: account.page_id,
          access_token: account.page_access_token, // Use page token for Instagram Business API
          refresh_token: null, // Instagram doesn't use refresh tokens
          token_expires_at: null, // Page tokens don't expire if user maintains page admin role
          is_active: true,
          metadata: {
            profile_picture_url: account.profile_picture_url,
            followers_count: account.followers_count,
            media_count: account.media_count,
          },
        }, {
          onConflict: "tenant_id,platform,platform_user_id",
        });

      if (connectionError) {
        console.error("Error storing Instagram connection:", connectionError);
      }
    }

    // Redirect to success page
    return NextResponse.redirect(
      new URL(`/settings/connections?success=Instagram Business accounts connected successfully`, baseUrl)
    );

  } catch (error) {
    console.error("Instagram Business Login error:", error);
    return NextResponse.redirect(
      new URL(`/settings/connections?error=${encodeURIComponent(error instanceof Error ? error.message : "Connection failed")}`, baseUrl)
    );
  }
}