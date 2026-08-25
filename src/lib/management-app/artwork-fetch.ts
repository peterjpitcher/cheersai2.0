/**
 * Downloading event artwork from the management app.
 *
 * These URLs arrive in an API response from another system, so they are input,
 * not configuration. Left unchecked they would let a caller (or a compromised
 * management app) point this server at anything reachable from inside the
 * network. The controls here are deliberately blunt:
 *
 *   - the set of origins is owned by this server, never learned from the
 *     response, because learning it from the value being validated proves
 *     nothing;
 *   - redirects are a hard failure, since an allowed origin that answers 302 is
 *     otherwise a free pass past the origin check;
 *   - no credentials of any kind travel with the request, so nothing leaks to a
 *     host that turns out not to be ours;
 *   - the byte cap is enforced while reading, because Content-Length is a claim
 *     by the server, not a fact.
 *
 * Out of scope, stated rather than implied: DNS rebinding. The allowlist points
 * at Supabase-managed hostnames that no user of this app can influence, so an
 * attacker would need to control Supabase's DNS, at which point the artwork
 * pipeline is not the interesting problem.
 */

import { env } from "@/env";

export const ARTWORK_MAX_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export type ArtworkFetchRejection =
  | "not_a_url"
  | "not_https"
  | "userinfo_in_url"
  | "non_default_port"
  | "origin_not_allowed";

export class ArtworkFetchError extends Error {
  readonly kind:
    | ArtworkFetchRejection
    | "redirected"
    | "http_error"
    | "too_large"
    | "timeout"
    | "network";

  constructor(kind: ArtworkFetchError["kind"], message: string) {
    super(message);
    this.name = "ArtworkFetchError";
    this.kind = kind;
  }
}

let cachedOriginsSource: string | null = null;
let cachedOrigins: Set<string> = new Set();

/** Parsed once per distinct env value; the env is read fresh so tests can vary it. */
export function allowedArtworkOrigins(): Set<string> {
  const source = env.server.MANAGEMENT_ARTWORK_ORIGINS ?? "";

  if (source !== cachedOriginsSource) {
    cachedOrigins = new Set(
      source
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          try {
            return new URL(entry).origin;
          } catch {
            console.error("[artwork] ignoring unparseable allowed origin", { entry });
            return "";
          }
        })
        .filter(Boolean),
    );
    cachedOriginsSource = source;
  }

  return cachedOrigins;
}

/**
 * Validate a candidate artwork URL. Returns the parsed URL or the reason it was
 * refused, rather than throwing, so a caller can record which variant it lost
 * and carry on with the rest.
 */
export function checkArtworkUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: ArtworkFetchRejection } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "not_https" };
  }

  // https://user:pass@allowed.host@evil.host/ parses differently across
  // libraries and proxies. Refusing userinfo outright removes the ambiguity.
  if (url.username || url.password) {
    return { ok: false, reason: "userinfo_in_url" };
  }

  // url.port is "" for the scheme default. Anything else is a request to reach
  // a service that is not the public storage endpoint.
  if (url.port !== "") {
    return { ok: false, reason: "non_default_port" };
  }

  if (!allowedArtworkOrigins().has(url.origin)) {
    return { ok: false, reason: "origin_not_allowed" };
  }

  return { ok: true, url };
}

export interface FetchedArtwork {
  bytes: Uint8Array;
  contentType: string | null;
}

/**
 * Download one artwork file.
 *
 * @throws ArtworkFetchError for every failure mode, so the caller can classify
 * without inspecting messages.
 */
export async function fetchArtworkFile(raw: string): Promise<FetchedArtwork> {
  const checked = checkArtworkUrl(raw);
  if (!checked.ok) {
    throw new ArtworkFetchError(checked.reason, `Artwork URL refused: ${checked.reason}.`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(checked.url, {
      method: "GET",
      // A redirect from an allowed origin to anywhere else would defeat the
      // whole check, and there is no legitimate reason for public storage to
      // issue one.
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      // Explicitly no API key, cookie or authorization header. The management
      // API key authenticates the API, never the storage host.
      headers: { Accept: "image/*" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ArtworkFetchError(
        "http_error",
        `Artwork host returned ${response.status}.`,
      );
    }

    const bytes = await readCapped(response, ARTWORK_MAX_BYTES);

    return { bytes, contentType: response.headers.get("content-type") };
  } catch (error) {
    if (error instanceof ArtworkFetchError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new ArtworkFetchError("timeout", "Artwork download timed out.");
    }

    // fetch rejects a disallowed redirect with a plain TypeError, so it is
    // separated here rather than lumped in with a connection failure.
    if (error instanceof Error && /redirect/i.test(error.message)) {
      throw new ArtworkFetchError("redirected", "Artwork host attempted a redirect.");
    }

    throw new ArtworkFetchError("network", "Artwork download failed.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the body, stopping the moment the cap is passed.
 *
 * Content-Length is not consulted: it is optional, and a hostile or broken
 * server can understate it. Counting what actually arrives is the only figure
 * that bounds memory.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;

  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new ArtworkFetchError("too_large", `Artwork exceeds ${maxBytes} bytes.`);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ArtworkFetchError("too_large", `Artwork exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}
