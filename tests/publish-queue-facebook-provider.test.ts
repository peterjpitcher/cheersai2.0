import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderPublishRequest } from "../supabase/functions/publish-queue/providers/types";

/**
 * Regression cover for the Page access token leak: the story publish path used
 * to put the token in the request query string and then log the full URL, which
 * wrote live Page tokens into Supabase function logs.
 */
const PAGE_TOKEN = "EAAtestpagetokenmustneverbelogged";
const SIGNED_MEDIA_URL = "https://storage.example.com/media/story.jpg?token=signed-media-token";

function mediaResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null),
    },
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  } as unknown as Response;
}

function graphResponse(status: number, body: unknown, traceId = "trace-1"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "x-fb-trace-id" ? traceId : null),
    },
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function storyRequest(overrides: Partial<ProviderPublishRequest> = {}): ProviderPublishRequest {
  return {
    payload: {
      body: "Tonight's special",
      media: [
        {
          id: "media-1",
          url: SIGNED_MEDIA_URL,
          mediaType: "image",
          mimeType: "image/jpeg",
        },
      ],
      placement: "story",
    },
    auth: {
      connectionId: "connection-1",
      accessToken: PAGE_TOKEN,
    },
    accountId: "account-1",
    contentId: "content-1",
    attempt: 1,
    connectionMetadata: {
      pageId: "page-123",
    },
    placement: "story",
    ...overrides,
  };
}

async function loadProvider() {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: vi.fn(() => undefined),
    },
  });

  return import("../supabase/functions/publish-queue/providers/facebook");
}

/** Flatten every argument of every call into searchable strings. */
function serialiseCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) =>
    call
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg)))
      .join(" "),
  );
}

function storyFetchMock() {
  return vi
    .fn()
    .mockResolvedValueOnce(mediaResponse())
    .mockResolvedValueOnce(graphResponse(200, { id: "photo-1" }))
    .mockResolvedValueOnce(graphResponse(200, { success: true, post_id: "story-1" }));
}

describe("publishToFacebook story placement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never writes the access token into console output", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", storyFetchMock());

    const { publishToFacebook } = await loadProvider();
    await publishToFacebook(storyRequest());

    const logged = [
      ...serialiseCalls(infoSpy),
      ...serialiseCalls(logSpy),
      ...serialiseCalls(warnSpy),
      ...serialiseCalls(errorSpy),
    ];

    // The story path is expected to log, so prove the assertion is not vacuous.
    expect(logged.length).toBeGreaterThan(0);
    for (const entry of logged) {
      expect(entry).not.toContain("access_token");
      expect(entry).not.toContain(PAGE_TOKEN);
    }
  });

  it("sends the access token in the request body, not the query string", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = storyFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { publishToFacebook } = await loadProvider();
    await publishToFacebook(storyRequest());

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [publishUrl, publishInit] = fetchMock.mock.calls[2] as [string, RequestInit];

    expect(uploadUrl).toBe("https://graph.facebook.com/v24.0/page-123/photos");
    expect(publishUrl).toBe("https://graph.facebook.com/v24.0/page-123/photo_stories");
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("access_token");
    }

    // The token must still be sent, just relocated into the multipart body.
    expect((uploadInit.body as FormData).get("access_token")).toBe(PAGE_TOKEN);
    expect((publishInit.body as FormData).get("access_token")).toBe(PAGE_TOKEN);
    expect((publishInit.body as FormData).get("photo_id")).toBe("photo-1");
  });

  it("keeps the access token out of Graph API error messages", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(mediaResponse())
        .mockResolvedValueOnce(
          graphResponse(500, { error: { message: "An unknown error has occurred.", code: 1 } }),
        ),
    );

    const { publishToFacebook } = await loadProvider();
    const error = await publishToFacebook(storyRequest()).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    const serialised = `${(error as Error).message} ${JSON.stringify(error)}`;
    expect(serialised).not.toContain("access_token");
    expect(serialised).not.toContain(PAGE_TOKEN);
  });
});
