import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnv } = vi.hoisted(() => ({
  serverEnv: { GOOGLE_MY_BUSINESS_CLIENT_ID: "", GOOGLE_MY_BUSINESS_CLIENT_SECRET: "" } as Record<string, string>,
}));

vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk/" }, server: serverEnv },
}));

import {
  buildGoogleOAuthUrl,
  exchangeGoogleCode,
  GoogleTokenError,
  googleRedirectUri,
  isGoogleConfigured,
  refreshGoogleAccessToken,
} from "@/lib/connections/google-oauth";

const CLIENT_ID = "344798984846-test.apps.googleusercontent.com";
const CLIENT_SECRET = "client-secret-never-logged";

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function failure(run: () => Promise<unknown>): Promise<GoogleTokenError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof GoogleTokenError) return error;
    throw error;
  }
  throw new Error("expected a GoogleTokenError");
}

beforeEach(() => {
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = CLIENT_ID;
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = CLIENT_SECRET;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isGoogleConfigured", () => {
  it("needs both the client id and the client secret", () => {
    expect(isGoogleConfigured()).toBe(true);
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = "";
    expect(isGoogleConfigured()).toBe(false);
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = CLIENT_SECRET;
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = "";
    expect(isGoogleConfigured()).toBe(false);
  });
});

describe("buildGoogleOAuthUrl", () => {
  it("asks Google for exactly the business scope, offline access and consent, on the registered callback", () => {
    const url = new URL(buildGoogleOAuthUrl("state-123"));

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: "https://cheers.orangejelly.co.uk/api/oauth/gbp/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/business.manage",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "state-123",
    });
    // The client secret never travels in a URL.
    expect(url.toString()).not.toContain(CLIENT_SECRET);
  });

  it("builds the callback from the site address without a doubled slash", () => {
    expect(googleRedirectUri()).toBe("https://cheers.orangejelly.co.uk/api/oauth/gbp/callback");
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the authorization_code grant and returns both tokens, the expiry and the scopes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
    fetchMock.mockResolvedValue(
      json({
        access_token: "ya29.access",
        expires_in: 3599,
        refresh_token: "1//refresh",
        scope: "https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      }),
    );

    const tokens = await exchangeGoogleCode("auth-code-1");

    expect(tokens).toEqual({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresAt: "2026-11-16T10:59:59.000Z",
      scopes: ["https://www.googleapis.com/auth/business.manage"],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code: "auth-code-1",
      redirect_uri: "https://cheers.orangejelly.co.uk/api/oauth/gbp/callback",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a refused code as invalid_grant, without the code or Google's description in the error", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant", error_description: "Bad Request for code auth-code-1" }, 400));

    const error = await failure(() => exchangeGoogleCode("auth-code-1"));

    expect(error.kind).toBe("invalid_grant");
    expect(error.status).toBe(400);
    expect(error.message).not.toContain("auth-code-1");
    expect(error.message).not.toContain("Bad Request");
    expect(error.message).not.toContain(CLIENT_SECRET);
  });

  it("reports any other refusal as rejected", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_client" }, 401));
    expect((await failure(() => exchangeGoogleCode("c"))).kind).toBe("rejected");
  });

  it("treats a success without an access token as rejected", async () => {
    fetchMock.mockResolvedValue(json({ token_type: "Bearer" }));
    expect((await failure(() => exchangeGoogleCode("c"))).kind).toBe("rejected");
  });

  it("leaves the refresh token null when Google sends none", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "ya29.access", expires_in: 3600 }));
    const tokens = await exchangeGoogleCode("c");
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.scopes).toEqual([]);
  });
});

describe("refreshGoogleAccessToken", () => {
  it("posts the refresh_token grant", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "ya29.new", expires_in: 3600, token_type: "Bearer" }));

    const tokens = await refreshGoogleAccessToken("1//refresh");

    expect(tokens.accessToken).toBe("ya29.new");
    expect(tokens.refreshToken).toBeNull();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: "1//refresh",
    });
  });

  it("reports a revoked refresh token as invalid_grant", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));
    expect((await failure(() => refreshGoogleAccessToken("1//refresh"))).kind).toBe("invalid_grant");
  });

  it.each([500, 503, 429])("reports HTTP %i as unavailable", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "server_error" }, status));
    expect((await failure(() => refreshGoogleAccessToken("1//refresh"))).kind).toBe("unavailable");
  });

  it("reports a timeout or network failure as unavailable, without the token in the error", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

    const error = await failure(() => refreshGoogleAccessToken("1//refresh"));

    expect(error.kind).toBe("unavailable");
    expect(error.status).toBeNull();
    expect(error.message).not.toContain("1//refresh");
  });
});
