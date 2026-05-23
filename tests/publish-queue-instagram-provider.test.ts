import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderPublishRequest } from "../supabase/functions/publish-queue/providers/types";

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function request(overrides: Partial<ProviderPublishRequest> = {}): ProviderPublishRequest {
  return {
    payload: {
      body: "Tonight's special",
      media: [
        {
          id: "media-1",
          url: "https://cdn.example.com/story.jpg",
          mediaType: "image",
          mimeType: "image/jpeg",
        },
      ],
      placement: "feed",
    },
    auth: {
      connectionId: "connection-1",
      accessToken: "access-token",
    },
    accountId: "account-1",
    contentId: "content-1",
    attempt: 1,
    connectionMetadata: {
      igBusinessId: "ig-123",
    },
    placement: "feed",
    ...overrides,
  };
}

async function loadProvider() {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: vi.fn((key: string) => {
        if (key === "INSTAGRAM_IMAGE_CONTAINER_PUBLISH_DELAY_MS") return "0";
        if (key === "INSTAGRAM_PUBLISH_RETRY_DELAY_MS") return "0";
        return undefined;
      }),
    },
  });

  return import("../supabase/functions/publish-queue/providers/instagram");
}

describe("publishToInstagram", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes image containers without polling container status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { id: "container-1" }))
      .mockResolvedValueOnce(response(200, { id: "ig-media-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const { publishToInstagram } = await loadProvider();
    const result = await publishToInstagram(request());

    expect(result.externalId).toBe("ig-media-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/ig-123/media");
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph.facebook.com/v24.0/ig-123/media_publish");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("status_code"))).toBe(false);
  });

  it("retries media_publish when an image container is not ready yet", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { id: "container-1" }))
      .mockResolvedValueOnce(response(400, {
        error: {
          message: "Unsupported post request. Object with ID 'container-1' does not exist.",
          type: "GraphMethodException",
          code: 100,
          error_subcode: 33,
          fbtrace_id: "trace-1",
        },
      }))
      .mockResolvedValueOnce(response(200, { id: "ig-media-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const { publishToInstagram } = await loadProvider();
    const result = await publishToInstagram(request());

    expect(result.externalId).toBe("ig-media-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph.facebook.com/v24.0/ig-123/media_publish");
    expect(fetchMock.mock.calls[2][0]).toBe("https://graph.facebook.com/v24.0/ig-123/media_publish");
  });
});
