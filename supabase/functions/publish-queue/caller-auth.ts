// supabase/functions/publish-queue/caller-auth.ts
//
// Caller check for publish-queue (tasks/SPEC-supabase-new-api-keys.md, steps 1 and 2).
//
// verify_jwt is on for this function (supabase/config.toml), but the platform check accepts any
// JWT signed with the project's JWT secret: the public anon key that ships in every browser
// bundle, and any signed-in user's session token. So the function checks for itself that the
// caller holds one of the project's service keys. The allowed keys are:
//
// - every value in SUPABASE_SECRET_KEYS, the JSON object of named secret keys (`{"default": ...}`)
//   the platform injects once the project has new API keys. A value that is not a JSON object of
//   non-empty strings adds no key at all;
// - SUPABASE_SECRET_KEY, the single secret key a locally served function gets;
// - SUPABASE_SERVICE_ROLE_KEY, the legacy service-role key, until step 10 of the spec.
//
// Every secret key already has full access to the project, so accepting any of them grants
// nothing new (spec decision 5). The key may arrive on the `apikey` header or as the token in
// `Authorization: Bearer`. Both legitimate callers (the publish-scheduler cron bridge and
// tournament publishing) call through supabase-js from the service client, which sends the
// service-role key on both headers.
//
// It fails closed: no allowed key configured, no credential, another scheme and a wrong key are
// all refused. Nothing here logs, returns or throws any part of a key or token.
//
// No Deno globals or URL imports here, so Vitest can import it
// (tests/publish-queue-caller-auth.test.ts); index.ts passes in its environment reader.

/**
 * Step 1 of the spec is report-only: index.ts logs every verdict and a refused caller carries on
 * exactly as before, so publishing cannot break while the logs are checked.
 *
 * STEP 2 IS THIS ONE LINE: set it to true. index.ts then answers a refused caller with an empty
 * 401 before the method check, before the body is read and before the database is touched.
 */
export const CALLER_CHECK_ENFORCED = false;

export type CallerKeyKind = "legacy_service_role" | "secret_key";

/** Which headers carried something comparable, or matched: never the values themselves. */
export type CallerHeaders = "apikey" | "authorization" | "both" | "none";

export type CallerReason = "matched" | "no_allowed_keys" | "no_credentials" | "no_match";

export interface CallerVerdict {
  accepted: boolean;
  reason: CallerReason;
  /** The kind of key the caller presented; a secret key wins if both headers matched different kinds. */
  keyKind: CallerKeyKind | "none";
  /** The header or headers whose credential matched an allowed key. */
  matchedHeader: CallerHeaders;
  /** The header or headers that carried a credential to compare (an `apikey` value or a Bearer token). */
  presented: CallerHeaders;
  /** Whether the legacy service-role key is configured, and how many secret keys (counts only). */
  legacyServiceRoleKeyConfigured: boolean;
  secretKeysConfigured: number;
  /** SUPABASE_SECRET_KEYS was set but was not a JSON object of non-empty strings, so it added no key. */
  secretKeysMalformed: boolean;
}

export type ReadEnv = (name: string) => string | undefined;

interface AllowedKey {
  kind: CallerKeyKind;
  value: string;
}

interface AllowedKeys {
  keys: AllowedKey[];
  secretKeysMalformed: boolean;
}

// The scheme is case-insensitive (RFC 7235); a key never contains whitespace.
const BEARER_HEADER = /^Bearer\s+(\S+)$/i;

/** The keys a caller may present, read fresh from the environment on each call. */
export function readAllowedKeys(readEnv: ReadEnv): AllowedKeys {
  const keys: AllowedKey[] = [];
  let secretKeysMalformed = false;

  const named = readEnv("SUPABASE_SECRET_KEYS");
  if (named !== undefined && named.trim() !== "") {
    const values = parseNamedKeys(named);
    if (values === null) {
      secretKeysMalformed = true;
    } else {
      for (const value of values) {
        keys.push({ kind: "secret_key", value });
      }
    }
  }

  const single = readEnv("SUPABASE_SECRET_KEY")?.trim();
  if (single) {
    keys.push({ kind: "secret_key", value: single });
  }

  const legacy = readEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) {
    keys.push({ kind: "legacy_service_role", value: legacy });
  }

  return { keys, secretKeysMalformed };
}

/** The values of a JSON object of named keys, or null when it is anything else. */
function parseNamedKeys(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const values: string[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }
    values.push(value.trim());
  }
  return values;
}

/**
 * Checks the `apikey` header and the `Authorization: Bearer` token against every allowed key.
 *
 * Each credential and each allowed key is hashed with SHA-256, and every credential is compared
 * with every allowed key over all 32 digest bytes with no early exit, so the time taken does not
 * show how much of a key matched, how long it is, or which allowed key it was.
 */
export async function checkCaller(headers: Headers, readEnv: ReadEnv): Promise<CallerVerdict> {
  const { keys, secretKeysMalformed } = readAllowedKeys(readEnv);
  const apikey = headers.get("apikey")?.trim() || undefined;
  const bearer = BEARER_HEADER.exec(headers.get("authorization")?.trim() ?? "")?.[1];

  const base = {
    presented: whichHeaders(Boolean(apikey), Boolean(bearer)),
    legacyServiceRoleKeyConfigured: keys.some((key) => key.kind === "legacy_service_role"),
    secretKeysConfigured: keys.filter((key) => key.kind === "secret_key").length,
    secretKeysMalformed,
  };

  if (keys.length === 0) {
    return { ...base, accepted: false, reason: "no_allowed_keys", keyKind: "none", matchedHeader: "none" };
  }
  if (!apikey && !bearer) {
    return { ...base, accepted: false, reason: "no_credentials", keyKind: "none", matchedHeader: "none" };
  }

  const allowed = await Promise.all(keys.map(async (key) => ({ kind: key.kind, digest: await sha256(key.value) })));
  const [apikeyKind, bearerKind] = await Promise.all([matchKind(apikey, allowed), matchKind(bearer, allowed)]);

  const matchedHeader = whichHeaders(apikeyKind !== undefined, bearerKind !== undefined);
  if (matchedHeader === "none") {
    return { ...base, accepted: false, reason: "no_match", keyKind: "none", matchedHeader };
  }
  const keyKind: CallerKeyKind =
    apikeyKind === "secret_key" || bearerKind === "secret_key" ? "secret_key" : "legacy_service_role";
  return { ...base, accepted: true, reason: "matched", keyKind, matchedHeader };
}

async function matchKind(
  credential: string | undefined,
  allowed: { kind: CallerKeyKind; digest: Uint8Array }[],
): Promise<CallerKeyKind | undefined> {
  if (!credential) {
    return undefined;
  }
  const digest = await sha256(credential);
  let secret = 0;
  let legacy = 0;
  for (const key of allowed) {
    const equal = digestsEqual(digest, key.digest);
    if (key.kind === "secret_key") {
      secret |= equal;
    } else {
      legacy |= equal;
    }
  }
  if (secret) return "secret_key";
  if (legacy) return "legacy_service_role";
  return undefined;
}

/** 1 when the digests are equal, else 0, after looking at every byte. */
function digestsEqual(a: Uint8Array, b: Uint8Array): number {
  let difference = a.length ^ b.length;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ (b[index] ?? 0);
  }
  return difference === 0 ? 1 : 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function whichHeaders(apikey: boolean, authorization: boolean): CallerHeaders {
  if (apikey && authorization) return "both";
  if (apikey) return "apikey";
  if (authorization) return "authorization";
  return "none";
}

type Log = Pick<Console, "info" | "warn" | "error">;

export const CALLER_ACCEPTED_LOG = "[publish-queue] caller accepted";
export const CALLER_REFUSED_LOG = "[publish-queue] caller refused";

/**
 * One log line per request, on a single line so each request is one log row:
 * `[publish-queue] caller accepted {...}` (info) or `[publish-queue] caller refused {...}`
 * (warning; error when no allowed key is configured at all). The JSON holds labels and counts
 * only, for example:
 *
 * [publish-queue] caller accepted {"reason":"matched","keyKind":"legacy_service_role","matchedHeader":"both","presented":"both","method":"POST","enforced":false,"legacyServiceRoleKeyConfigured":true,"secretKeysConfigured":0}
 */
export function logCallerVerdict(
  verdict: CallerVerdict,
  context: { method: string; enforced: boolean },
  log: Log = console,
): void {
  const details = JSON.stringify({
    reason: verdict.reason,
    keyKind: verdict.keyKind,
    matchedHeader: verdict.matchedHeader,
    presented: verdict.presented,
    method: context.method.slice(0, 16),
    enforced: context.enforced,
    legacyServiceRoleKeyConfigured: verdict.legacyServiceRoleKeyConfigured,
    secretKeysConfigured: verdict.secretKeysConfigured,
  });

  if (verdict.secretKeysMalformed) {
    log.error("[publish-queue] SUPABASE_SECRET_KEYS is not a JSON object of named keys; it added no key");
  }
  if (verdict.accepted) {
    log.info(`${CALLER_ACCEPTED_LOG} ${details}`);
  } else if (verdict.reason === "no_allowed_keys") {
    log.error(`${CALLER_REFUSED_LOG} ${details}`);
  } else {
    log.warn(`${CALLER_REFUSED_LOG} ${details}`);
  }
}
