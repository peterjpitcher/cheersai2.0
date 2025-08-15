import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?error=auth_failed`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?error=invalid_request`
      );
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state, "base64").toString());
    const { tenant_id, platform } = stateData;

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/social/callback`;

    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `code=${code}`;

    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error("Failed to get access token:", tokenData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?error=token_failed`
      );
    }

    const { access_token } = tokenData;

    // Get user info
    const userResponse = await fetch(
      `https://graph.facebook.com/v18.0/me?access_token=${access_token}&fields=id,name,email`
    );
    const userData = await userResponse.json();

    // Get Facebook Pages for the user
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${access_token}`
    );
    const pagesData = await pagesResponse.json();

    const supabase = await createClient();

    // Store connection for each page
    if (pagesData.data && pagesData.data.length > 0) {
      for (const page of pagesData.data) {
        // For Instagram, check if this page has an Instagram Business Account
        if (platform === "instagram") {
          const igResponse = await fetch(
            `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${page.access_token}`
          );
          const igData = await igResponse.json();
          
          if (!igData.instagram_business_account) {
            // Skip pages without Instagram Business accounts
            continue;
          }
          
          // Check if Instagram connection already exists
          const { data: existing } = await supabase
            .from("social_connections")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("platform", "instagram")
            .eq("account_id", igData.instagram_business_account.id)
            .single();

          if (existing) {
            // Update existing Instagram connection
            await supabase
              .from("social_connections")
              .update({
                access_token: page.access_token,
                account_name: igData.instagram_business_account.username,
                page_id: page.id,
                page_name: page.name,
                is_active: true,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          } else {
            // Create new Instagram connection
            await supabase
              .from("social_connections")
              .insert({
                tenant_id,
                platform: "instagram",
                account_id: igData.instagram_business_account.id,
                account_name: igData.instagram_business_account.username,
                page_id: page.id,
                page_name: page.name,
                access_token: page.access_token,
                is_active: true,
              });
          }
        } else {
          // Handle Facebook connections
          // Check if connection already exists
          const { data: existing } = await supabase
            .from("social_connections")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("platform", platform)
            .eq("page_id", page.id)
            .single();

          if (existing) {
            // Update existing connection
            await supabase
              .from("social_connections")
              .update({
                access_token: page.access_token,
                account_name: userData.name,
                page_name: page.name,
                is_active: true,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          } else {
            // Create new connection
            await supabase
              .from("social_connections")
              .insert({
                tenant_id,
                platform,
                account_id: userData.id,
                account_name: userData.name,
                page_id: page.id,
                page_name: page.name,
                access_token: page.access_token,
                is_active: true,
              });
          }
        }
      }

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?success=true`
      );
    } else {
      // No pages found
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?error=no_pages`
      );
    }
  } catch (error) {
    console.error("Callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/connections?error=callback_failed`
    );
  }
}