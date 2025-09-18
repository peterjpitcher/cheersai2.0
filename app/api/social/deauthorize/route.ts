import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from '@/lib/utils/get-app-url';
import crypto from "crypto";
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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
    reqLogger.info('Instagram deauthorization received', {
      area: 'social',
      op: 'instagram.deauthorize',
      status: 'pending',
      platformUserId: instagramUserId,
    })

    // Remove the Instagram connection from our database
    const supabase = await createClient();
    
    // Find and delete the social connection
    const { error } = await supabase
      .from("social_connections")
      .delete()
      .eq("platform_user_id", instagramUserId)
      .eq("platform", "instagram");

    if (error) {
      reqLogger.error('Failed to remove Instagram connection', {
        area: 'social',
        op: 'instagram.deauthorize',
        status: 'fail',
        platformUserId: instagramUserId,
        error,
      })
    }

    // Log the deauthorization event
    await supabase.from("audit_logs").insert({
      event_type: "instagram_deauthorization",
      platform_user_id: instagramUserId,
      created_at: new Date().toISOString(),
    });

    // Return confirmation URL as required by Instagram
    reqLogger.info('Instagram deauthorization completed', {
      area: 'social',
      op: 'instagram.deauthorize',
      status: 'ok',
      platformUserId: instagramUserId,
    })

    return NextResponse.json({
      url: `${getBaseUrl()}/auth/deauthorized?platform=instagram`,
      confirmation_code: crypto.randomBytes(16).toString("hex"),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Instagram deauthorization error', {
      area: 'social',
      op: 'instagram.deauthorize',
      status: 'fail',
      error: err,
    })
    logger.error('Instagram deauthorization error', {
      area: 'social',
      op: 'instagram.deauthorize',
      status: 'fail',
      error: err,
    })
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
    logger.warn('Invalid signature on Instagram deauthorization request', {
      area: 'social',
      op: 'instagram.deauthorize',
      status: 'fail',
    })
    return null;
  }

  return data;
}
