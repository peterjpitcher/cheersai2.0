import { NextResponse } from "next/server";

import { env } from "@/env";
import { sendEmail } from "@/lib/email/resend";
import { createLogger } from "@/lib/logging";
import { noStore, readSignedRequest } from "@/lib/meta/callback-request";
import {
  issuedAtFromPayload,
  latestMetaDataRequest,
  recordMetaDataRequest,
  revokeMetaUserData,
} from "@/lib/meta/data-requests";
import { deletionConfirmationCode, parseMetaSignedRequest } from "@/lib/meta/signed-request";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * Meta data deletion callback (App Settings > Basic > User data deletion).
 *
 * Meta POSTs a signed_request when a person asks for their data to be
 * deleted. We verify it, find every connection that person made (by the
 * app-scoped user id recorded at connection time), delete the stored tokens,
 * record the outcome, and answer with a status URL and confirmation code.
 * Connections made before user ids were recorded cannot be matched; those
 * requests are recorded as no_match and the operator is emailed to follow up.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("meta-data-deletion");
const CONTACT = "peter@orangejelly.co.uk";

function statusUrl(code: string): string {
  const base = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  return `${base}/api/social/delete-data?code=${encodeURIComponent(code)}`;
}

async function alertOperator(subject: string, lines: string[]): Promise<void> {
  const to = env.server.OPERATOR_ALERT_EMAIL;
  if (!to) return;
  try {
    await sendEmail({ to, subject, html: lines.map((line) => `<p>${line}</p>`).join("\n") });
  } catch (error) {
    logger.error("operator alert for data deletion failed", error instanceof Error ? error : undefined);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const appSecret = env.server.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    // Fail closed and loudly: without the secret nothing can be verified.
    logger.error("FACEBOOK_APP_SECRET is not configured", new Error("missing_app_secret"));
    return noStore({ error: "Data deletion callback is not configured." }, 500);
  }

  const payload = parseMetaSignedRequest(await readSignedRequest(request), appSecret);
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
  const issuedAt = issuedAtFromPayload(payload.issued_at);
  const service = createServiceSupabaseClient();

  try {
    const result = await revokeMetaUserData(service, userId, { kind: "deletion", issuedAt });
    const matched = result.connectionsRevoked + result.adAccountsRevoked > 0;
    await recordMetaDataRequest(service, {
      kind: "deletion",
      confirmationCode,
      status: matched ? "completed" : "no_match",
      result,
      issuedAt,
    });
    // The Meta user id is personal data, so only the opaque code is logged.
    logger.info("Meta data deletion request processed", { confirmationCode, ...result });
    await alertOperator(`[Cheers operator] Meta data deletion request ${confirmationCode}`, [
      matched
        ? `Revoked ${result.connectionsRevoked} social connection(s) and ${result.adAccountsRevoked} ads connection(s); their tokens were deleted.`
        : "No stored connection matched this person (it may pre-date user id recording). Check whether any brand's connections belong to them and follow up by hand.",
      `Confirmation code: ${confirmationCode}`,
    ]);
    return noStore({ url: statusUrl(confirmationCode), confirmation_code: confirmationCode });
  } catch (error) {
    logger.error("Meta data deletion request failed", error instanceof Error ? error : undefined, { confirmationCode });
    try {
      await recordMetaDataRequest(service, {
        kind: "deletion",
        confirmationCode,
        status: "failed",
        detail: error instanceof Error ? error.message.slice(0, 200) : "unknown error",
        issuedAt,
      });
    } catch {
      // Already logged above; the operator alert below is the backstop.
    }
    await alertOperator(`[Cheers operator] Meta data deletion FAILED ${confirmationCode}`, [
      "A verified Meta data deletion request could not be completed. Meta will show the person an error; finish it by hand.",
      `Confirmation code: ${confirmationCode}`,
    ]);
    return noStore({ error: "The deletion request could not be completed. Please try again later." }, 500);
  }
}

/**
 * Status page Meta shows to the person. It reports the recorded outcome for
 * the code; an unknown code is a 404, never a claim of completion.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const code = new URL(request.url).searchParams.get("code")?.trim();
  if (!code) {
    return noStore({ error: "Provide the confirmation code from your deletion request, as ?code=..." }, 400);
  }

  let outcome: Awaited<ReturnType<typeof latestMetaDataRequest>>;
  try {
    outcome = await latestMetaDataRequest(createServiceSupabaseClient(), code);
  } catch (error) {
    logger.error("Meta data deletion status lookup failed", error instanceof Error ? error : undefined);
    return noStore({ error: "Status is unavailable right now. Please try again later." }, 503);
  }

  if (!outcome) {
    return noStore({ confirmation_code: code, status: "not_found", detail: "No deletion request was found for this code.", contact: CONTACT }, 404);
  }

  const detail =
    outcome.status === "completed"
      ? "Your connection to Cheers by Orange Jelly has been removed and the access tokens we held for it have been deleted. Posts already published remain on your Facebook Page or Instagram account; you can remove them there."
      : outcome.status === "no_match"
        ? "We found no connection linked to your account, so we hold no data for you. Posts already published remain on your Facebook Page or Instagram account."
        : "We could not complete your request automatically and are completing it by hand. Contact us if you have questions.";

  return noStore({
    confirmation_code: code,
    status: outcome.status,
    completed: outcome.status !== "failed",
    requested_at: outcome.createdAt,
    detail,
    contact: CONTACT,
  });
}
