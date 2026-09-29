// supabase/functions/media-derivatives/caller-auth.ts
//
// Caller check for the media-derivatives edge function.
//
// verify_jwt is off for this function (supabase/config.toml), so the platform passes every
// request through and the function decides who may run it. Only a request carrying
// `Authorization: Bearer <key>`, where <key> is the service-role key Supabase injects into the
// function as SUPABASE_SERVICE_ROLE_KEY, may run it. That is the key the function already uses
// for its own database and storage calls, and the key both callers send:
// scripts/ops/regenerate-story-derivatives.ts (through supabase-js) and
// scripts/ops/invoke-function.ts.
//
// It fails closed: a missing header, another scheme, an empty token, a wrong key and an empty
// expected key are all refused.
//
// No Deno globals or URL imports here, so Vitest can import it
// (tests/supabase/media-derivatives/caller-auth.test.ts).

// Scheme is case-insensitive (RFC 7235); the key itself never contains whitespace.
const BEARER_HEADER = /^Bearer\s+(\S+)$/i;

/**
 * True only when `authorization` is `Bearer <expectedKey>`.
 *
 * Both keys are hashed with SHA-256 and the two digests compared byte by byte with no early
 * exit, so the time taken does not show how much of the key matched or how long it is.
 */
export async function isServiceRoleCaller(
  authorization: string | null,
  expectedKey: string | undefined,
): Promise<boolean> {
  if (!expectedKey || !authorization) {
    return false;
  }

  const match = BEARER_HEADER.exec(authorization.trim());
  if (!match) {
    return false;
  }

  const [provided, expected] = await Promise.all([sha256(match[1]), sha256(expectedKey)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided[index] ^ expected[index];
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}
