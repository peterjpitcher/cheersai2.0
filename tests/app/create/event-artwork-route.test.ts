// The import route's trust boundary and result mapping.
//
// It is a publicly callable mutation endpoint, so what it refuses to accept from
// the caller matters as much as what it does with a good request.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const isRateLimited = vi.fn();
const getManagementConnectionConfig = vi.fn();
const getManagementEventDetail = vi.fn();
const importEventArtwork = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  getRateLimitKey: () => "key",
  isRateLimited: (...args: unknown[]) => isRateLimited(...args),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({}),
}));

vi.mock("@/lib/management-app/data", () => ({
  getManagementConnectionConfig: () => getManagementConnectionConfig(),
}));

vi.mock("@/lib/management-app/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/management-app/client")>(
    "@/lib/management-app/client",
  );
  return {
    ...actual,
    getManagementEventDetail: (...args: unknown[]) => getManagementEventDetail(...args),
  };
});

vi.mock("@/lib/management-app/artwork-import", () => ({
  importEventArtwork: (...args: unknown[]) => importEventArtwork(...args),
}));

import { ManagementApiError } from "@/lib/management-app/client";
import { POST, maxDuration, runtime } from "@/app/api/create/event-artwork/route";

function request(body: unknown) {
  return new Request("http://localhost/api/create/event-artwork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", activeAccountId: "acc-1" });
  isRateLimited.mockResolvedValue(false);
  getManagementConnectionConfig.mockResolvedValue({ baseUrl: "https://m.example.com", apiKey: "k" });
  getManagementEventDetail.mockResolvedValue({ id: "evt-1", name: "Karaoke Night" });
  importEventArtwork.mockResolvedValue({
    status: "imported",
    assetId: "asset-1",
    asset: { id: "asset-1" },
    warning: undefined,
    stageMs: {},
    sourceCounts: { offered: 2, fetched: 2, failed: 0 },
    bytesIn: 10,
    bytesOut: 5,
  });
});

describe("route configuration", () => {
  it("runs on Node with its own duration budget", () => {
    // Sharp cannot run on the edge runtime, and the budget is per page segment:
    // set on a Server Action it would raise the limit for every action on
    // /create rather than this one.
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });
});

describe("POST /api/create/event-artwork", () => {
  it("rejects an unauthenticated caller before touching anything", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(request({ eventId: "evt-1" }));

    expect(res.status).toBe(401);
    expect(getManagementConnectionConfig).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user with no active brand", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1", activeAccountId: null });

    const res = await POST(request({ eventId: "evt-1" }));
    expect(res.status).toBe(403);
  });

  it("caps repeated imports per account", async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await POST(request({ eventId: "evt-1" }));
    expect(res.status).toBe(429);
  });

  it("accepts only an event identifier from the caller", async () => {
    // Everything else, including the account and every storage path, is derived
    // server-side. Trusting a client-supplied account or path would let one
    // account write into another's media.
    const res = await POST(
      request({
        eventId: "evt-1",
        accountId: "someone-else",
        storagePath: "../../etc/passwd",
        sourceKey: "ams:event:spoofed",
      }),
    );

    expect(res.status).toBe(200);
    const call = importEventArtwork.mock.calls[0][0];
    expect(call.accountId).toBe("acc-1");
    expect(Object.keys(call).sort()).toEqual([
      "accountId",
      "config",
      "deadlineAt",
      "eventId",
      "eventName",
      "supabase",
    ]);
  });

  it("rejects a request with no event id", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(importEventArtwork).not.toHaveBeenCalled();
  });

  it("uses the management app's own id and name, not the caller's", async () => {
    getManagementEventDetail.mockResolvedValue({ id: "canonical-id", name: "Real Name" });

    await POST(request({ eventId: "slug-form", eventSlug: "slug-form" }));

    const call = importEventArtwork.mock.calls[0][0];
    expect(call.eventId).toBe("canonical-id");
    expect(call.eventName).toBe("Real Name");
  });

  it("sets an internal deadline shorter than the platform limit", async () => {
    // So a slow import gives up and cleans up after itself rather than being
    // killed part-way through writing storage objects.
    const before = Date.now();
    await POST(request({ eventId: "evt-1" }));

    const { deadlineAt } = importEventArtwork.mock.calls[0][0];
    expect(deadlineAt - before).toBeLessThan(maxDuration * 1000);
    expect(deadlineAt - before).toBeGreaterThan(30_000);
  });

  it("passes the import result through", async () => {
    const res = await POST(request({ eventId: "evt-1" }));
    const json = await res.json();

    expect(json).toEqual({ status: "imported", asset: { id: "asset-1" }, warning: null });
  });

  it("reports a vanished event as unavailable rather than a failure", async () => {
    getManagementEventDetail.mockRejectedValue(new ManagementApiError("HTTP_ERROR", "gone", 404));

    const res = await POST(request({ eventId: "evt-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("unavailable");
    expect(importEventArtwork).not.toHaveBeenCalled();
  });

  it("reports a missing connection as unavailable, not as an empty event", async () => {
    // A settings problem must not read as "this event has no artwork", or nobody
    // will ever go and fix it.
    getManagementConnectionConfig.mockRejectedValue(
      new Error("Management app connection is not configured."),
    );

    const json = await (await POST(request({ eventId: "evt-1" }))).json();
    expect(json.status).toBe("unavailable");
  });

  it("reports a rejected API key as unavailable", async () => {
    getManagementConnectionConfig.mockRejectedValue(
      new ManagementApiError("UNAUTHORIZED", "bad key", 401),
    );

    const json = await (await POST(request({ eventId: "evt-1" }))).json();
    expect(json.status).toBe("unavailable");
  });

  it("degrades to failed, never to a 500, on an unexpected error", async () => {
    // The wizard treats a non-200 as a bug. Artwork failing is a warning: the
    // field import already succeeded and the user can carry on.
    importEventArtwork.mockRejectedValue(new Error("kaboom"));

    const res = await POST(request({ eventId: "evt-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("failed");
    expect(json.warning).toContain("Add media in the next step");
  });

  it("never caches a response", async () => {
    const res = await POST(request({ eventId: "evt-1" }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
