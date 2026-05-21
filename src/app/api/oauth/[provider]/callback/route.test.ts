import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeOAuthConnectMock, createServiceSupabaseClientMock, updateMock, eqMock } = vi.hoisted(() => ({
  completeOAuthConnectMock: vi.fn(),
  createServiceSupabaseClientMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
}));

vi.mock("@/app/(app)/connections/actions", () => ({
  completeOAuthConnect: completeOAuthConnectMock,
}));

vi.mock("@/env", () => ({
  env: {
    client: {
      NEXT_PUBLIC_SITE_URL: "https://app.test",
    },
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
}));

import { GET } from "@/app/api/oauth/[provider]/callback/route";

describe("GET /api/oauth/[provider]/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock.mockReturnThis();
    updateMock.mockReturnValue({ eq: eqMock });
    createServiceSupabaseClientMock.mockReturnValue({
      from: vi.fn(() => ({
        update: updateMock,
      })),
    });
  });

  it("completes the OAuth exchange before redirecting with success", async () => {
    completeOAuthConnectMock.mockResolvedValueOnce({ success: true });

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/gbp/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "gbp" }) },
    );

    expect(completeOAuthConnectMock).toHaveBeenCalledWith("gbp", "code-1", "state-1");
    expect(response.headers.get("location")).toBe("https://app.test/connections?oauth=success&provider=gbp");
  });

  it("redirects with an error when completion fails", async () => {
    completeOAuthConnectMock.mockResolvedValueOnce({
      success: false,
      error: "No Google Business Profile locations were found.",
    });

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/gbp/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "gbp" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("gbp");
    expect(location.searchParams.get("message")).toBe("No Google Business Profile locations were found.");
  });

  it("does not show success when the provider returns an OAuth error", async () => {
    const response = await GET(
      new NextRequest("https://app.test/api/oauth/gbp/callback?error=access_denied&state=state-1"),
      { params: Promise.resolve({ provider: "gbp" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(completeOAuthConnectMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ error: "access_denied" }));
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("gbp");
  });
});
