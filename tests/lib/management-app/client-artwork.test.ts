// Reading the scoped artwork endpoint. The point of these is the mapping from
// HTTP status to outcome: the whole feature can fail silently if "no artwork"
// and "not permitted" collapse into the same answer.

import { afterEach, describe, expect, it, vi } from "vitest";

import { getManagementEventArtwork } from "@/lib/management-app/client";

const config = { baseUrl: "https://management.example.com", apiKey: "test-key" };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

const fullPayload = {
  success: true,
  data: {
    eventId: "evt-1",
    slug: "karaoke",
    kitUpdatedAt: "2026-08-24T18:16:46.387Z",
    variants: {
      square: {
        url: "https://cdn/square.png",
        mimeType: "image/png",
        sizeBytes: 1974635,
        updatedAt: "2026-08-24T10:00:00.000Z",
        inherited: false,
      },
      story: {
        url: "https://cdn/story.png",
        mimeType: "image/png",
        sizeBytes: 2049388,
        updatedAt: "2026-08-24T18:16:46.387Z",
        inherited: false,
      },
      landscape: null,
    },
  },
};

describe("getManagementEventArtwork", () => {
  it("maps a full payload", async () => {
    respond(200, fullPayload);

    const result = await getManagementEventArtwork(config, "evt-1");

    expect(result).toMatchObject({
      status: "ok",
      eventId: "evt-1",
      kitUpdatedAt: "2026-08-24T18:16:46.387Z",
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.variants.square?.url).toBe("https://cdn/square.png");
    expect(result.variants.landscape).toBeNull();
  });

  it("calls the artwork path, not the detail path", async () => {
    respond(200, fullPayload);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await getManagementEventArtwork(config, "evt 1");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://management.example.com/api/events/evt%201/artwork",
    );
  });

  it("reports a missing scope as unavailable, never as an empty result", async () => {
    // If this returned an empty variant set, a key provisioned without the scope
    // would be reported to the user as "this event has no artwork" and nobody
    // would ever chase it.
    respond(403, { success: false, error: { code: "FORBIDDEN", message: "no" } });

    expect(await getManagementEventArtwork(config, "evt-1")).toEqual({
      status: "unavailable",
      reason: "forbidden",
    });
  });

  it("reports a 404 as an unsupported management app", async () => {
    // The caller has already resolved the event through the detail endpoint, so
    // a 404 here means the route does not exist rather than the event.
    respond(404, { success: false, error: { code: "NOT_FOUND", message: "no route" } });

    expect(await getManagementEventArtwork(config, "evt-1")).toEqual({
      status: "unavailable",
      reason: "unsupported",
    });
  });

  it("treats a server fault as an error, which is retryable, not as unavailable", async () => {
    respond(500, { success: false, error: { code: "INTERNAL", message: "boom" } });

    const result = await getManagementEventArtwork(config, "evt-1");
    expect(result.status).toBe("error");
  });

  it("rejects a payload with no variants object rather than reading it as empty", async () => {
    respond(200, { success: true, data: { eventId: "evt-1" } });

    const result = await getManagementEventArtwork(config, "evt-1");
    expect(result.status).toBe("error");
  });

  it("treats an explicit all-null variant set as a valid empty kit", async () => {
    respond(200, {
      success: true,
      data: { eventId: "evt-1", slug: null, kitUpdatedAt: null, variants: { square: null, story: null, landscape: null } },
    });

    const result = await getManagementEventArtwork(config, "evt-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.variants).toEqual({ square: null, story: null, landscape: null });
  });

  it("drops a variant with no url instead of trusting a half-built object", async () => {
    respond(200, {
      success: true,
      data: {
        eventId: "evt-1",
        variants: { square: { mimeType: "image/png" }, story: null, landscape: null },
      },
    });

    const result = await getManagementEventArtwork(config, "evt-1");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.variants.square).toBeNull();
  });

  it("ignores unknown fields so the contract can grow", async () => {
    respond(200, {
      success: true,
      data: {
        eventId: "evt-1",
        somethingNew: { nested: true },
        variants: {
          square: { url: "https://cdn/s.png", futureField: 1 },
          story: null,
          landscape: null,
        },
      },
    });

    const result = await getManagementEventArtwork(config, "evt-1");
    expect(result.status).toBe("ok");
  });

  it("refuses an empty event id without making a request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await getManagementEventArtwork(config, "  ")).status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
