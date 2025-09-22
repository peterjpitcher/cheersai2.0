import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/server-only";
import crypto from "crypto";
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const secret = process.env.INSTAGRAM_APP_SECRET
    if (!secret) {
      reqLogger.error('Missing INSTAGRAM_APP_SECRET for data deletion', {
        area: 'social',
        op: 'instagram.delete-data',
        status: 'fail',
      })
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 }
      )
    }

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
      secret
    );

    if (!data || !data.user_id) {
      return NextResponse.json(
        { error: "Invalid signed request" },
        { status: 400 }
      );
    }

    const instagramUserId = data.user_id;
    reqLogger.info('Instagram data deletion requested', {
      area: 'social',
      op: 'instagram.delete-data',
      status: 'pending',
      platformUserId: instagramUserId,
    })

    // Delete user data from our database
    const supabase = await createServiceRoleClient();
    
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
    reqLogger.info('Instagram data deletion completed', {
      area: 'social',
      op: 'instagram.delete-data',
      status: 'ok',
      platformUserId: instagramUserId,
      meta: { deletionId },
    })

    return NextResponse.json({
      url: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.cheersai.uk'}/data-deletion-confirm?id=${deletionId}`,
      confirmation_code: deletionId,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Instagram data deletion error', {
      area: 'social',
      op: 'instagram.delete-data',
      status: 'fail',
      error: err,
    })
    logger.error('Instagram data deletion error', {
      area: 'social',
      op: 'instagram.delete-data',
      status: 'fail',
      error: err,
    })
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
    logger.warn('Invalid signature on Instagram data deletion request', {
      area: 'social',
      op: 'instagram.delete-data',
      status: 'fail',
    })
    return null;
  }

  return data;
}
