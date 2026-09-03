import crypto from "node:crypto";

/**
 * Meta signed_request parsing and verification.
 *
 * Meta sends a `signed_request` to callbacks such as the data deletion
 * endpoint. It is `base64url(signature).base64url(payload)`, where the
 * signature is HMAC-SHA256 of the *encoded* payload string, keyed with the app
 * secret. Verifying it is what proves the request really came from Meta, so
 * everything here fails closed.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

export interface MetaSignedRequestPayload {
  /** App-scoped user id. Not the page id, and not a profile id we store. */
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

/**
 * Verify and decode a signed_request.
 *
 * Returns `null` for anything that does not verify: malformed input, an
 * unexpected algorithm, or a signature mismatch. Callers must treat `null` as
 * "reject", never as "empty".
 */
export function parseMetaSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string,
): MetaSignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null;

  const parts = signedRequest.split(".");
  if (parts.length !== 2) return null;

  const [encodedSignature, encodedPayload] = parts;
  if (!encodedSignature || !encodedPayload) return null;

  let payload: MetaSignedRequestPayload;
  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    payload = parsed as MetaSignedRequestPayload;
  } catch {
    return null;
  }

  // Only HMAC-SHA256 is accepted. Trusting the caller's algorithm field would
  // let a forged request pick a weaker one, or none.
  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return null;
  }

  let provided: Buffer;
  try {
    provided = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }

  // The signature covers the encoded payload exactly as received, not the
  // re-serialised JSON.
  const expected = crypto.createHmac("sha256", appSecret).update(encodedPayload).digest();

  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  return payload;
}

/**
 * Opaque, stable reference for a deletion request.
 *
 * Derived rather than random so the status endpoint can recognise a code
 * without storing anything, and keyed with the app secret so it cannot be
 * produced or reversed by a third party. It contains no personal data.
 */
export function deletionConfirmationCode(userId: string, appSecret: string): string {
  return crypto
    .createHmac("sha256", appSecret)
    .update(`meta-data-deletion:${userId}`)
    .digest("hex")
    .slice(0, 24);
}
