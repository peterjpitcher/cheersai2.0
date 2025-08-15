import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { InstagramClient } from "@/lib/social/instagram";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { pageId, pageAccessToken } = await request.json();

    if (!pageId || !pageAccessToken) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 400 });
    }

    // Get Instagram accounts connected to this Facebook Page
    const client = new InstagramClient(pageAccessToken);
    const instagramAccounts = await client.getConnectedInstagramAccounts(pageId);

    if (instagramAccounts.length === 0) {
      return NextResponse.json(
        { error: "No Instagram Business account connected to this Facebook Page" },
        { status: 400 }
      );
    }

    const instagramAccount = instagramAccounts[0];

    // Store the Instagram connection
    const { data, error } = await supabase
      .from("social_connections")
      .upsert({
        tenant_id: userData.tenant_id,
        platform: "instagram",
        account_id: instagramAccount.id,
        account_name: instagramAccount.username,
        page_id: pageId, // Store the Facebook Page ID
        page_name: instagramAccount.username,
        access_token: pageAccessToken, // Use the Facebook Page access token
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      connection: data,
      account: {
        username: instagramAccount.username,
        followers: instagramAccount.followers_count,
        profile_picture: instagramAccount.profile_picture_url,
      }
    });
  } catch (error: any) {
    console.error("Error connecting Instagram:", error);
    return NextResponse.json(
      { error: error.message || "Failed to connect Instagram account" },
      { status: 500 }
    );
  }
}