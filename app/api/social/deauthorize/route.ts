import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from '@/lib/utils/get-app-url';
import crypto from "crypto";

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
    console.log(`Deauthorization request for Instagram user: ${instagramUserId}`);

    // Remove the Instagram connection from our database
    const supabase = await createClient();
    
    // Find and delete the social connection
    const { error } = await supabase
      .from("social_connections")
      .delete()
      .eq("platform_user_id", instagramUserId)
      .eq("platform", "instagram");

    if (error) {
      console.error("Error removing Instagram connection:", error);
    }

    // Log the deauthorization event
    await supabase.from("audit_logs").insert({
      event_type: "instagram_deauthorization",
      platform_user_id: instagramUserId,
      created_at: new Date().toISOString(),
    });

    // Return confirmation URL as required by Instagram
    return NextResponse.json({
      url: `${getBaseUrl()}/auth/deauthorized?platform=instagram`,
      confirmation_code: crypto.randomBytes(16).toString("hex"),
    });
  } catch (error) {
    console.error("Instagram deauthorization error:", error);
    return NextResponse.json(
      { error: "Deauthorization failed" },
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
    console.error("Invalid signature on Instagram deauthorization request");
    return null;
  }

  return data;
}
