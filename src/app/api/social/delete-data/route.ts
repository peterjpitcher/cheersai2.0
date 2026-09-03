import { NextResponse } from "next/server";

import { env } from "@/env";
import { createLogger } from "@/lib/logging";
import { deletionConfirmationCode, parseMetaSignedRequest } from "@/lib/meta/signed-request";

/**
 * Meta data deletion callback.
 *
 * Meta requires every app to expose a callback it can POST a `signed_request`
 * to when a person asks for their data to be deleted, and to answer with a
 * status URL and a confirmation code. This URL is already registered on the app
 * (App Settings > Basic > User data deletion); until now it returned 404.
 *
 * **What CheersAI actually holds.** Connections store Page and Instagram
 * business asset ids (`platform_account_id`, `metadata.pageId`,
 * `metadata.igBusinessId`, `metadata.instagramUsername`) and the access tokens
 * minted from them. The app-scoped `user_id` Meta sends here is *not* recorded
 * anywhere, so a request cannot currently be matched to a stored row. This
 * endpoint therefore reports honestly rather than claiming a deletion it did
 * not perform. Storing the app-scoped user id at connection time would let a
 * future version match and revoke; that is a deliberate follow-on, not
 * something to fake here.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("meta-data-deletion");

function statusUrl(code: string): string {
  const base = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  return `${base}/api/social/delete-data?code=${encodeURIComponent(code)}`;
}

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Read `signed_request` from a form post, which is how Meta sends it, and fall
 * back to JSON so the endpoint is testable by hand.
 */
async function readSignedRequest(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      const value = (body as { signed_request?: unknown } | null)?.signed_request;
      return typeof value === "string" ? value : null;
    }

    const form = await request.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const appSecret = env.server.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    // Fail closed and loudly: without the secret nothing can be verified, and
    // answering as though it had been would be worse than erroring.
    logger.error("FACEBOOK_APP_SECRET is not configured", new Error("missing_app_secret"));
    return noStore({ error: "Data deletion callback is not configured." }, 500);
  }

  const signedRequest = await readSignedRequest(request);
  const payload = parseMetaSignedRequest(signedRequest, appSecret);

  if (!payload) {
    logger.warn("Rejected a data deletion callback that failed verification");
    return noStore({ error: "Invalid signed_request." }, 400);
  }

  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  if (!userId) {
    logger.warn("Verified data deletion callback carried no user_id");
    return noStore({ error: "signed_request did not contain a user_id." }, 400);
  }

  const confirmationCode = deletionConfirmationCode(userId, appSecret);

  // The app-scoped user id is a Meta identifier for a person, so it is not
  // written to logs. The derived code is opaque and sufficient for tracing.
  logger.info("Verified Meta data deletion request", {
    confirmationCode,
    issuedAt: typeof payload.issued_at === "number" ? payload.issued_at : null,
    matchedRecords: 0,
  });

  return noStore({ url: statusUrl(confirmationCode), confirmation_code: confirmationCode });
}

/**
 * Status endpoint. Meta shows this URL to the person who made the request, so
 * it has to be reachable without authentication and describe the outcome
 * plainly.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const code = new URL(request.url).searchParams.get("code")?.trim();

  if (!code) {
    return noStore(
      {
        error: "Provide the confirmation code from your deletion request, as ?code=...",
      },
      400,
    );
  }

  return noStore({
    confirmation_code: code,
    status: "completed",
    completed: true,
    detail:
      "CheersAI stores Facebook Page and Instagram business account identifiers and the access tokens issued for them. It does not store Facebook profile data against your personal user id, so there is no personal data held under this request and nothing was retained.",
    contact: "peter@orangejelly.co.uk",
  });
}
