import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getPlannerActivityMock } = vi.hoisted(() => ({
  getPlannerActivityMock: vi.fn(),
}));

vi.mock("@/lib/planner/data", () => ({
  getPlannerActivity: getPlannerActivityMock,
}));

import { GET } from "@/app/api/planner/activity/route";

describe("GET /api/planner/activity", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    getPlannerActivityMock.mockReset();
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it("returns 400 when the limit query parameter is invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/planner/activity?limit=0"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "Invalid limit parameter" });
    expect(getPlannerActivityMock).not.toHaveBeenCalled();
  });

  it("returns 401 when auth redirects to login", async () => {
    const redirectError = new Error("NEXT_REDIRECT") as Error & { digest: string };
    redirectError.digest = "NEXT_REDIRECT;replace;/login;307;";
    getPlannerActivityMock.mockRejectedValueOnce(redirectError);

    const response = await GET(new NextRequest("http://localhost/api/planner/activity"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Unauthorized" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns activity when request succeeds", async () => {
    const activity = [{ id: "note-1", message: "Updated", timestamp: new Date().toISOString(), level: "info" }];
    getPlannerActivityMock.mockResolvedValueOnce(activity);

    const response = await GET(new NextRequest("http://localhost/api/planner/activity?limit=5"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ activity });
    expect(getPlannerActivityMock).toHaveBeenCalledWith({ limit: 5, unreadOnly: true });
  });

  it("returns 500 when loading activity fails unexpectedly", async () => {
    getPlannerActivityMock.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(new NextRequest("http://localhost/api/planner/activity"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to load activity", message: "boom" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
