import { NextResponse } from "next/server";

import { env } from "@/env";
import { createLogger } from "@/lib/logging";
import { noStore, readSignedRequest } from "@/lib/meta/callback-request";
import { issuedAtFromPayload, recordMetaDataRequest, revokeMetaUserData } from "@/lib/meta/data-requests";
import { deletionConfirmationCode, parseMetaSignedRequest } from "@/lib/meta/signed-request";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * Meta deauthorise callback (Facebook Login settings > Deauthorize callback URL).
 *
 * Meta POSTs a signed_request when a person removes the app from their
 * Facebook account. Their tokens stop working anyway; we delete what we hold
 * and mark the connections as needing a reconnect so the brand sees it
 * straight away rather than at the next failed post. Connections made after
 * Meta issued the request are left alone (see revokeMetaUserData).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("meta-deauthorise");

export async function POST(request: Request): Promise<NextResponse> {
  const appSecret = env.server.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    logger.error("FACEBOOK_APP_SECRET is not configured", new Error("missing_app_secret"));
    return noStore({ error: "Deauthorise callback is not configured." }, 500);
  }

  const payload = parseMetaSignedRequest(await readSignedRequest(request), appSecret);
  if (!payload) {
    logger.warn("Rejected a deauthorise callback that failed verification");
    return noStore({ error: "Invalid signed_request." }, 400);
  }
  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  if (!userId) return noStore({ error: "signed_request did not contain a user_id." }, 400);

  const confirmationCode = deletionConfirmationCode(userId, appSecret);
  const issuedAt = issuedAtFromPayload(payload.issued_at);
  const service = createServiceSupabaseClient();

  try {
    const result = await revokeMetaUserData(service, userId, { kind: "deauthorise", issuedAt });
    await recordMetaDataRequest(service, {
      kind: "deauthorise",
      confirmationCode,
      status: result.connectionsRevoked + result.adAccountsRevoked > 0 ? "completed" : "no_match",
      result,
      issuedAt,
    });
    logger.info("Meta deauthorise processed", { confirmationCode, ...result });
    return noStore({ success: true });
  } catch (error) {
    logger.error("Meta deauthorise failed", error instanceof Error ? error : undefined, { confirmationCode });
    // 500 so Meta retries; the tokens are already useless to us either way.
    return noStore({ error: "Deauthorise could not be processed." }, 500);
  }
}
