import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type FetchResponse = Response;

const ORIGINAL_FETCH = global.fetch;
let exchangeProviderAuthCode: typeof import("@/lib/connections/token-exchange")["exchangeProviderAuthCode"];

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function mockFetchSequence(responses: FetchResponse[]) {
  const queue = [...responses];
  const handler = vi.fn(() => {
    const next = queue.shift();
    if (!next) {
      return Promise.reject(new Error("Unexpected fetch invocation"));
    }
    return Promise.resolve(next);
  });
  global.fetch = handler as unknown as typeof fetch;
  return handler;
}

describe("exchangeProviderAuthCode", () => {
  beforeAll(async () => {
    process.env.ALERTS_SECRET = process.env.ALERTS_SECRET ?? "test-alert";
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? "test-cron";
    process.env.FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? "fb-secret";
    process.env.GOOGLE_MY_BUSINESS_CLIENT_ID =
      process.env.GOOGLE_MY_BUSINESS_CLIENT_ID ?? "google-client";
    process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET =
      process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET ?? "google-secret";
    process.env.INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID ?? "ig-app";
    process.env.INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? "ig-secret";
    process.env.INSTAGRAM_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN ?? "verify";
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "openai";
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "resend";
    process.env.RESEND_FROM = process.env.RESEND_FROM ?? "notifications@test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase";
    process.env.NEXT_PUBLIC_FACEBOOK_APP_ID =
      process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ?? "fb-app";
    process.env.NEXT_PUBLIC_SITE_URL =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://supabase.local";

    ({ exchangeProviderAuthCode } = await import("@/lib/connections/token-exchange"));
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns Facebook page metadata when reconnecting", async () => {
    mockFetchSequence([
      jsonResponse({ access_token: "short-token", expires_in: 3600 }),
      jsonResponse({ access_token: "long-token", expires_in: 5184000 }),
      jsonResponse({
        data: [
          {
            id: "123",
            name: "Cheers Page",
            access_token: "page-token-123",
          },
        ],
      }),
    ]);

    const result = await exchangeProviderAuthCode("facebook", "AUTH_CODE", {
      existingMetadata: { pageId: "123" },
    });

    expect(result.accessToken).toBe("page-token-123");
    expect(result.metadata).toEqual({ pageId: "123" });
    expect(result.displayName).toBe("Cheers Page");
    expect(result.expiresAt).toBe("2025-03-02T00:00:00.000Z");
  });

  it("prefers matching Instagram Business account metadata", async () => {
    mockFetchSequence([
      jsonResponse({ access_token: "short-token", expires_in: 3600 }),
      jsonResponse({ access_token: "long-token", expires_in: 5184000 }),
      jsonResponse({
        data: [
          {
            id: "page-1",
            name: "Page One",
            access_token: "page-token-1",
            instagram_business_account: { id: "ig-1", username: "pubone" },
          },
          {
            id: "page-2",
            name: "Page Two",
            access_token: "page-token-2",
            instagram_business_account: { id: "ig-2", username: "pubtwo" },
          },
        ],
      }),
    ]);

    const result = await exchangeProviderAuthCode("instagram", "AUTH_CODE", {
      existingMetadata: { igBusinessId: "ig-2" },
    });

    expect(result.accessToken).toBe("page-token-2");
    expect(result.metadata).toEqual({
      igBusinessId: "ig-2",
      pageId: "page-2",
      instagramUsername: "pubtwo",
    });
    expect(result.displayName).toBe("pubtwo");
    expect(result.expiresAt).toBe("2025-03-02T00:00:00.000Z");
  });

  it("retrieves Google Business Profile location metadata", async () => {
    mockFetchSequence([
      jsonResponse({
        access_token: "google-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }),
      jsonResponse({
        accounts: [
          { name: "accounts/123", accountName: "Cheers Org" },
        ],
      }),
      jsonResponse({
        locations: [
          { name: "locations/abc", title: "Cheers Tavern" },
        ],
      }),
    ]);

    const result = await exchangeProviderAuthCode("gbp", "AUTH_CODE");

    expect(result.accessToken).toBe("google-token");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.expiresAt).toBe("2025-01-01T01:00:00.000Z");
    expect(result.metadata).toEqual({ locationId: "locations/abc" });
    expect(result.displayName).toBe("Cheers Tavern");
  });

  it("throws when no Facebook pages are available", async () => {
    mockFetchSequence([
      jsonResponse({ access_token: "short-token", expires_in: 3600 }),
      jsonResponse({ access_token: "long-token", expires_in: 5184000 }),
      jsonResponse({ data: [] }),
    ]);

    await expect(exchangeProviderAuthCode("facebook", "AUTH_CODE")).rejects.toThrow(
      /No Facebook Pages found/i,
    );
  });
});
