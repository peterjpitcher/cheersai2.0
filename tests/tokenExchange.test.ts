import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedPage } from "@/lib/connections/page-selection";

type FetchResponse = Response;
type TokenExchangeModule = typeof import("@/lib/connections/token-exchange");

const ORIGINAL_FETCH = global.fetch;
let exchangeCodeForUserToken: TokenExchangeModule["exchangeCodeForUserToken"];
let fetchManagedPages: TokenExchangeModule["fetchManagedPages"];
let buildPageConnection: TokenExchangeModule["buildPageConnection"];

function jsonResponse(body: unknown, init: number | ResponseInit = 200): FetchResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    status: responseInit.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(responseInit.headers ?? {}),
    },
  });
}

function mockFetchSequence(responses: FetchResponse[]) {
  const queue = [...responses];
  const handler = vi.fn((url: string) => {
    void url;
    const next = queue.shift();
    if (!next) {
      return Promise.reject(new Error("Unexpected fetch invocation"));
    }
    return Promise.resolve(next);
  });
  global.fetch = handler as unknown as typeof fetch;
  return handler;
}

function managedPage(overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id: "123",
    name: "Cheers Page",
    accessToken: "page-token-123",
    tasks: ["CREATE_CONTENT", "MANAGE"],
    instagram: null,
    ...overrides,
  };
}

describe("Meta login helpers", () => {
  beforeAll(async () => {
    process.env.ALERTS_SECRET = process.env.ALERTS_SECRET ?? "test-alert";
    process.env.CRON_SECRET = process.env.CRON_SECRET ?? "test-cron";
    process.env.FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? "fb-secret";
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

    ({ exchangeCodeForUserToken, fetchManagedPages, buildPageConnection } = await import(
      "@/lib/connections/token-exchange"
    ));
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

  describe("exchangeCodeForUserToken", () => {
    it("returns the long-lived user token, its expiry and the Meta user id", async () => {
      mockFetchSequence([
        jsonResponse({ access_token: "short-token", expires_in: 3600 }),
        jsonResponse({ access_token: "long-token", expires_in: 5184000 }),
        jsonResponse({ id: "meta-user-1" }),
      ]);

      const result = await exchangeCodeForUserToken("facebook", "AUTH_CODE");

      expect(result).toEqual({
        userAccessToken: "long-token",
        expiresAt: "2025-03-02T00:00:00.000Z",
        metaUserId: "meta-user-1",
      });
    });

    it("keeps the short-lived token when the upgrade fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetchSequence([
        jsonResponse({ access_token: "short-token", expires_in: 3600 }),
        jsonResponse({ error: { message: "nope" } }, 400),
        jsonResponse({ id: "meta-user-1" }),
      ]);

      const result = await exchangeCodeForUserToken("instagram", "AUTH_CODE");

      expect(result.userAccessToken).toBe("short-token");
      expect(result.expiresAt).toBe("2025-01-01T01:00:00.000Z");
    });

    it("still succeeds when the Meta user id lookup fails", async () => {
      mockFetchSequence([
        jsonResponse({ access_token: "short-token", expires_in: 3600 }),
        jsonResponse({ access_token: "long-token", expires_in: 5184000 }),
        jsonResponse({ error: { message: "nope" } }, { status: 400 }),
      ]);

      const result = await exchangeCodeForUserToken("facebook", "AUTH_CODE");

      expect(result.metaUserId).toBeNull();
    });

    it("throws Meta's error when the code is refused", async () => {
      mockFetchSequence([jsonResponse({ error: { message: "Code expired", type: "OAuthException", code: 100 } }, 400)]);

      await expect(exchangeCodeForUserToken("facebook", "AUTH_CODE")).rejects.toThrow(
        "OAuthException: Code expired (code 100)",
      );
    });
  });

  describe("fetchManagedPages", () => {
    it("asks for tasks and the linked Instagram account, and maps each Page", async () => {
      const fetchMock = mockFetchSequence([
        jsonResponse({
          data: [
            {
              id: "page-1",
              name: "Page One",
              access_token: "page-token-1",
              tasks: ["CREATE_CONTENT"],
              instagram_business_account: { id: "ig-1", username: "pubone" },
            },
            { name: "no id, dropped" },
          ],
        }),
      ]);

      const pages = await fetchManagedPages("user-token");

      const requested = new URL(fetchMock.mock.calls[0][0]);
      expect(requested.pathname).toMatch(/\/me\/accounts$/);
      expect(requested.searchParams.get("fields")).toBe(
        "id,name,access_token,tasks,instagram_business_account{id,username,name}",
      );
      expect(pages).toEqual([
        {
          id: "page-1",
          name: "Page One",
          accessToken: "page-token-1",
          tasks: ["CREATE_CONTENT"],
          instagram: { id: "ig-1", username: "pubone", name: null },
        },
      ]);
    });

    it("follows Meta's paging on the Graph host and stops after four requests", async () => {
      const next = (n: number) => ({ next: `https://graph.facebook.com/v24.0/me/accounts?after=${n}` });
      const fetchMock = mockFetchSequence([
        jsonResponse({ data: [{ id: "1" }], paging: next(1) }),
        jsonResponse({ data: [{ id: "2" }, { id: "1" }], paging: next(2) }),
        jsonResponse({ data: [{ id: "3" }], paging: next(3) }),
        jsonResponse({ data: [{ id: "4" }], paging: next(4) }),
      ]);

      const pages = await fetchManagedPages("user-token");

      expect(pages.map((page) => page.id)).toEqual(["1", "2", "3", "4"]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[1][0]).toBe("https://graph.facebook.com/v24.0/me/accounts?after=1");
    });

    it("ignores a paging link that points anywhere else", async () => {
      const fetchMock = mockFetchSequence([
        jsonResponse({ data: [{ id: "1" }], paging: { next: "https://evil.example/me/accounts?after=1" } }),
      ]);

      const pages = await fetchManagedPages("user-token");

      expect(pages).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws Meta's error, without the token, when the list fails", async () => {
      mockFetchSequence([jsonResponse({ error: { message: "Session expired", code: 190 } }, 400)]);

      const failure = await fetchManagedPages("secret-user-token").catch((error: Error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Session expired (code 190)");
      expect((failure as Error).message).not.toContain("secret-user-token");
    });
  });

  describe("buildPageConnection", () => {
    const auth = { expiresAt: "2025-03-02T00:00:00.000Z", metaUserId: "meta-user-1" };

    it("stores the Facebook Page token and Page id", () => {
      expect(buildPageConnection("facebook", managedPage(), auth)).toEqual({
        accessToken: "page-token-123",
        refreshToken: null,
        expiresAt: "2025-03-02T00:00:00.000Z",
        displayName: "Cheers Page",
        metadata: { pageId: "123" },
        metaUserId: "meta-user-1",
      });
    });

    it("records the linked Instagram account on the Facebook connection, as before", () => {
      const page = managedPage({ instagram: { id: "ig-1", username: "pubone", name: null } });
      expect(buildPageConnection("facebook", page, auth).metadata).toEqual({ pageId: "123", igBusinessId: "ig-1" });
    });

    it("stores the Instagram account through its Page token", () => {
      const page = managedPage({ id: "page-2", instagram: { id: "ig-2", username: "pubtwo", name: null } });

      expect(buildPageConnection("instagram", page, auth)).toEqual({
        accessToken: "page-token-123",
        refreshToken: null,
        expiresAt: "2025-03-02T00:00:00.000Z",
        displayName: "pubtwo",
        metadata: { igBusinessId: "ig-2", pageId: "page-2", instagramUsername: "pubtwo" },
        metaUserId: "meta-user-1",
      });
    });

    it("refuses a Page that came back without a token", () => {
      expect(() => buildPageConnection("facebook", managedPage({ accessToken: null }), auth)).toThrow(
        /missing an access token/,
      );
      const igPage = managedPage({ accessToken: null, instagram: { id: "ig-1", username: null, name: null } });
      expect(() => buildPageConnection("instagram", igPage, auth)).toThrow(/requires a Page access token/);
      expect(() => buildPageConnection("instagram", managedPage(), auth)).toThrow(/No Instagram Business Account/);
    });
  });
});
