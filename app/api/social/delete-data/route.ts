import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    
    // Parse the signed request from Instagram
    const signedRequest = new URLSearchParams(body).get("signed_request");
    
    if (!signedRequest) {
      return NextResponse.json(
        { error: "No signed request provided" },
        { status: 400 }
      );
    }

    // Verify and decode the signed request
    const data = parseSignedRequest(
      signedRequest,
      process.env.INSTAGRAM_APP_SECRET!
    );

    if (!data || !data.user_id) {
      return NextResponse.json(
        { error: "Invalid signed request" },
        { status: 400 }
      );
    }

    const instagramUserId = data.user_id;
    console.log(`Data deletion request for Instagram user: ${instagramUserId}`);

    // Delete user data from our database
    const supabase = await createClient();
    
    // Delete social connections
    await supabase
      .from("social_connections")
      .delete()
      .eq("platform_user_id", instagramUserId)
      .eq("platform", "instagram");

    // Delete any cached Instagram data
    await supabase
      .from("social_media_cache")
      .delete()
      .eq("platform_user_id", instagramUserId);

    // Delete published posts from this Instagram account
    await supabase
      .from("publishing_queue")
      .delete()
      .eq("platform", "instagram")
      .eq("platform_account_id", instagramUserId);

    // Log the deletion request
    const deletionId = crypto.randomBytes(16).toString("hex");
    await supabase.from("data_deletion_logs").insert({
      deletion_id: deletionId,
      platform: "instagram",
      platform_user_id: instagramUserId,
      status: "completed",
      created_at: new Date().toISOString(),
    });

    // Return confirmation as required by Instagram
    return NextResponse.json({
      url: `https://cheersai.orangejelly.co.uk/data-deletion-confirm?id=${deletionId}`,
      confirmation_code: deletionId,
    });
  } catch (error) {
    console.error("Instagram data deletion error:", error);
    return NextResponse.json(
      { error: "Data deletion failed" },
      { status: 500 }
    );
  }
}

function parseSignedRequest(signedRequest: string, secret: string) {
  const [encodedSig, payload] = signedRequest.split(".", 2);

  if (!encodedSig || !payload) {
    return null;
  }

  // Decode the payload
  const data = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf-8")
  );

  // Verify the signature
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  if (encodedSig !== expectedSig) {
    console.error("Invalid signature on Instagram data deletion request");
    return null;
  }

  return data;
}
