/**
 * Google OAuth for the Google connection: the consent URL, the code exchange
 * and the refresh grant. Server only. Endpoints and field names follow
 * https://developers.google.com/identity/protocols/oauth2/web-server (read 16
 * November 2026).
 *
 * Nothing here logs or throws a token, a code or the client secret: errors
 * carry the HTTP status and Google's short error code only.
 */

import { env } from "@/env";
import { GOOGLE_PROVIDER, GOOGLE_SCOPE } from "@/lib/connections/google-messages";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Bounds every call to Google, so a hung endpoint cannot hold a request open. */
export const GOOGLE_HTTP_TIMEOUT_MS = 10_000;

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

/** Both halves of the OAuth client are present in the environment. */
export function isGoogleConfigured(): boolean {
  return Boolean(env.server.GOOGLE_MY_BUSINESS_CLIENT_ID && env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET);
}

/** The callback registered with Google: /api/oauth/gbp/callback on this site. */
export function googleRedirectUri(): string {
  return `${SITE_URL}/api/oauth/${GOOGLE_PROVIDER}/callback`;
}

/**
 * The consent URL. `access_type=offline` with `prompt=consent` makes Google
 * return a refresh token every time; `include_granted_scopes=false` keeps the
 * grant to the one scope asked for.
 */
export function buildGoogleOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * - invalid_grant: the code or refresh token is no longer good (used, expired or revoked)
 * - rejected: Google refused for another reason (for example a wrong client secret)
 * - unavailable: timeout, network failure, 429 or 5xx: worth trying again
 */
export type GoogleTokenFailure = "invalid_grant" | "rejected" | "unavailable";

export class GoogleTokenError extends Error {
  constructor(
    public readonly kind: GoogleTokenFailure,
    public readonly status: number | null,
    /** Google's short error code (for example invalid_grant); never its description. */
    public readonly oauthError: string | null,
  ) {
    super(`Google token endpoint: ${kind} (HTTP ${status ?? "none"}, ${oauthError ?? "no error code"})`);
    this.name = "GoogleTokenError";
  }
}

export interface GoogleTokens {
  /** Never log it. */
  accessToken: string;
  /** Null when Google sent none (it omits it on a refresh). Never log it. */
  refreshToken: string | null;
  /** ISO time the access token stops working. */
  expiresAt: string;
  /** The scopes Google granted; empty when it did not say. */
  scopes: string[];
}

/** Swaps the authorisation code for an access token and a refresh token. */
export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  return requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: googleRedirectUri(),
  });
}

/** Swaps a refresh token for a new access token. Google usually sends no new refresh token. */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function requestTokens(grant: Record<string, string>): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
    client_secret: env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
    ...grant,
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network failure. The thrown value is dropped: it can name the URL but nothing secret.
    throw new GoogleTokenError("unavailable", null, null);
  }

  const json = await readJson(response);

  if (!response.ok) {
    const oauthError = shortCode(json?.error);
    if (response.status >= 500 || response.status === 429) {
      throw new GoogleTokenError("unavailable", response.status, oauthError);
    }
    throw new GoogleTokenError(oauthError === "invalid_grant" ? "invalid_grant" : "rejected", response.status, oauthError);
  }

  const accessToken = readString(json?.access_token);
  if (!accessToken) {
    throw new GoogleTokenError("rejected", response.status, "missing_access_token");
  }

  // A missing or odd expires_in is treated as "already expired", so the next use refreshes.
  const expiresIn = Number(json?.expires_in);
  const lifetimeMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0;
  const scope = readString(json?.scope);

  return {
    accessToken,
    refreshToken: readString(json?.refresh_token),
    expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Google's `error` value when it looks like a short code; anything else is dropped. */
function shortCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : null;
}
