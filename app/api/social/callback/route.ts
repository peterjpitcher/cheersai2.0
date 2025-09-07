import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/server-only";
import { getBaseUrl } from '@/lib/utils/get-app-url';

const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    
    // Use the request URL to determine the base URL if env var is not set
    const baseUrl = getBaseUrl();

    if (error) {
      console.error("OAuth error:", error);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=auth_failed`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_request`
      );
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state, "base64").toString());
    const { tenant_id: stateTenantId, platform } = stateData;
    
    // Get authenticated user and verify tenant (critical for security)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.error("OAuth callback: No authenticated user in session");
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=not_authenticated`
      );
    }
    
    // Derive tenant from database, don't trust state blindly
    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    
    if (profileError || !userProfile?.tenant_id) {
      console.error("OAuth callback: User has no tenant", profileError);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=no_tenant`
      );
    }
    
    // Verify the state tenant matches the user's actual tenant
    if (stateTenantId !== userProfile.tenant_id) {
      console.error("OAuth callback: Tenant mismatch", { 
        stateTenantId, 
        actualTenantId: userProfile.tenant_id 
      });
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_tenant`
      );
    }
    
    // Use the verified tenant_id from the database
    const tenant_id = userProfile.tenant_id;

    // Use environment variable or fallback
    const redirectUri = `${getBaseUrl()}/api/social/callback`;

    // Step 1: Exchange code for SHORT-LIVED access token
    const FB_VERSION = "v23.0";
    const tokenUrl = `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `code=${code}`;

    const tokenResponse = await fetch(tokenUrl);
    const shortTokenData = await tokenResponse.json();

    if (!shortTokenData.access_token) {
      console.error("Failed to get access token:", shortTokenData);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=token_failed`
      );
    }

    // Step 2: Exchange for LONG-LIVED token (~60 days)
    const longTokenUrl = `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `fb_exchange_token=${shortTokenData.access_token}`;

    const longTokenResponse = await fetch(longTokenUrl);
    const longTokenData = await longTokenResponse.json();
    
    const access_token = longTokenData.access_token || shortTokenData.access_token;
    const expires_in = longTokenData.expires_in || shortTokenData.expires_in;

    // Get user info (for debugging, not strictly needed for connections)
    const userResponse = await fetch(
      `https://graph.facebook.com/${FB_VERSION}/me?access_token=${access_token}&fields=id,name,email`
    );
    const userData = await userResponse.json();
    
    console.log("Facebook user connected:", userData.name);

    // Get Facebook Pages for the user (these have their own tokens)
    const pagesResponse = await fetch(
      `https://graph.facebook.com/${FB_VERSION}/me/accounts?access_token=${access_token}&fields=id,name,access_token`
    );
    const pagesData = await pagesResponse.json();
    
    console.log(`Found ${pagesData.data?.length || 0} Facebook pages`);

    // Store connection for each page (supabase client already created above)
    if (pagesData.data && pagesData.data.length > 0) {
      const connections = [];
      
      for (const page of pagesData.data) {
        // Store Facebook page connection if requested
        if (platform === "facebook") {
          connections.push({
            tenant_id,
            platform: "facebook",
            account_id: page.id,
            account_name: page.name,
            access_token: page.access_token,
            page_id: page.id,
            page_name: page.name,
            is_active: true,
            token_expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
          });
        }
        
        // Check for Instagram Business Account connected to this page
        if (platform === "instagram" || platform === "instagram_business") {
          try {
            const igResponse = await fetch(
              `https://graph.facebook.com/${FB_VERSION}/${page.id}?fields=instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${page.access_token}`
            );
            const igData = await igResponse.json();
            
            if (igData.instagram_business_account) {
              console.log(`Found Instagram account: ${igData.instagram_business_account.username}`);
              
              connections.push({
                tenant_id,
                platform: "instagram_business",
                account_id: igData.instagram_business_account.id,
                account_name: igData.instagram_business_account.username || "Instagram Business",
                access_token: page.access_token, // Use PAGE token for Instagram API calls
                page_id: page.id,
                page_name: page.name,
                is_active: true,
                token_expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
                metadata: {
                  profile_picture_url: igData.instagram_business_account.profile_picture_url,
                  followers_count: igData.instagram_business_account.followers_count,
                },
              });
            } else {
              console.log(`No Instagram account connected to page: ${page.name}`);
            }
          } catch (igError) {
            console.error(`Error checking Instagram for page ${page.name}:`, igError);
          }
        }
      }
      
      // Batch upsert all connections using service role to bypass RLS
      if (connections.length > 0) {
        const serviceSupabase = await createServiceRoleClient();
        const { error: dbError } = await serviceSupabase
          .from("social_connections")
          .upsert(connections, {
            onConflict: "tenant_id,platform,account_id",
          });
        
        if (dbError) {
          // Log the actual database error for debugging
          console.error("Failed to store connections - Database error:", {
            error: dbError,
            message: dbError.message,
            details: dbError.details,
            hint: dbError.hint,
            code: dbError.code
          });
          return NextResponse.redirect(
            `${baseUrl}/settings/connections?error=storage_failed&details=${encodeURIComponent(dbError.message || 'Unknown error')}`
          );
        }
      } else if (platform === "instagram" || platform === "instagram_business") {
        // No Instagram accounts found
        console.log("No Instagram Business accounts found. User needs to connect Instagram to their Facebook Page.");
        return NextResponse.redirect(
          `${baseUrl}/settings/connections?error=no_instagram_accounts&message=Please+connect+Instagram+to+your+Facebook+Page+first`
        );
      }

      return NextResponse.redirect(
        `${baseUrl}/settings/connections?success=true`
      );
    } else {
      // No pages found
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=no_pages`
      );
    }
  } catch (error) {
    console.error("Callback error:", error);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk";
    return NextResponse.redirect(
      `${baseUrl}/settings/connections?error=callback_failed`
    );
  }
}
