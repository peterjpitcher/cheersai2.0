import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryConnectionsDb } from "../../../../../../tests/helpers/in-memory-connections-db";

const { completeOAuthConnectMock, completeGoogleConnectMock, createServiceSupabaseClientMock } = vi.hoisted(() => ({
  completeOAuthConnectMock: vi.fn(),
  completeGoogleConnectMock: vi.fn(),
  createServiceSupabaseClientMock: vi.fn(),
}));

vi.mock("@/app/(app)/connections/google-actions", () => ({
  completeGoogleConnect: completeGoogleConnectMock,
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

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const CHOICE_REFERENCE = "C".repeat(43);

/**
 * Next's redirect() throws; its digest carries the path and the status code.
 * Next's route handler wrapper turns that throw into the redirect response.
 */
async function redirectOf(run: () => Promise<unknown>): Promise<{ path: string; status: number }> {
  try {
    await run();
  } catch (error) {
    const parts = ((error as { digest?: string }).digest ?? "").split(";");
    if (parts[0] === "NEXT_REDIRECT") return { path: parts[2], status: Number(parts[3]) };
    throw error;
  }
  throw new Error("expected a redirect, but the route returned a response");
}

describe("GET /api/oauth/[provider]/callback", () => {
  let db: InMemoryConnectionsDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new InMemoryConnectionsDb();
    db.seed("accounts", [{ id: ACCOUNT }]);
    db.seed("oauth_states", [
      { state: "state-1", provider: "facebook", account_id: ACCOUNT },
      { state: "google-state", provider: "gbp", account_id: ACCOUNT },
      // A pending Page choice: same table, carries an encrypted payload.
      {
        state: CHOICE_REFERENCE,
        provider: "facebook",
        account_id: ACCOUNT,
        redirect_to: "/connections/choose-page",
        auth_code: '{"ciphertext":"c","iv":"i","tag":"t","keyVersion":1}',
      },
    ]);
    createServiceSupabaseClientMock.mockImplementation(() => db.client());
  });

  const stateRow = (state: string) => db.rows("oauth_states").find((row) => row.state === state);

  it("completes the OAuth exchange before redirecting with success", async () => {
    completeOAuthConnectMock.mockResolvedValueOnce({ success: true });

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/facebook/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    expect(completeOAuthConnectMock).toHaveBeenCalledWith("facebook", "code-1", "state-1");
    expect(response.headers.get("location")).toBe("https://app.test/connections?oauth=success&provider=facebook");
  });

  it("sends the owner to the Page chooser with only the choice reference in the address", async () => {
    const reference = "A".repeat(43);
    completeOAuthConnectMock.mockResolvedValueOnce({ success: true, pageChoice: reference });

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/facebook/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/connections/choose-page");
    expect([...location.searchParams.keys()]).toEqual(["choice"]);
    expect(location.searchParams.get("choice")).toBe(reference);
  });

  it("redirects with an error when completion fails", async () => {
    completeOAuthConnectMock.mockResolvedValueOnce({
      success: false,
      error: "No Facebook pages were found.",
    });

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/facebook/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("facebook");
    expect(location.searchParams.get("message")).toBe("No Facebook pages were found.");
  });

  it.each([
    ["signed out", "/auth/login"],
    ["signed in with no brand", "/no-access"],
  ])("sends an owner who is %s to %s, not to /connections with NEXT_REDIRECT", async (_state, path) => {
    // requireOwnerContext() inside the connect step redirects by throwing, as it does live.
    completeOAuthConnectMock.mockImplementationOnce(async () => redirect(path));

    const outcome = await redirectOf(() =>
      GET(
        new NextRequest("https://app.test/api/oauth/facebook/callback?code=code-1&state=state-1"),
        { params: Promise.resolve({ provider: "facebook" }) },
      ),
    );

    expect(outcome).toEqual({ path, status: 307 });
  });

  it("redirects to /connections with plain words, and logs the detail, when the connect step throws a real error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    completeOAuthConnectMock.mockRejectedValueOnce(new Error("OAuthException: Invalid verification code format (code 100)"));

    const response = await GET(
      new NextRequest("https://app.test/api/oauth/facebook/callback?code=code-1&state=state-1"),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("facebook");
    expect(location.searchParams.get("message")).toBe("We could not finish connecting. Please click Connect again.");
    const logged = consoleError.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("OAuth callback failed");
    expect(logged).toContain("Invalid verification code format");
    consoleError.mockRestore();
  });

  it("does not show success when the provider returns an OAuth error, and marks the state failed", async () => {
    const response = await GET(
      new NextRequest("https://app.test/api/oauth/facebook/callback?error=access_denied&state=state-1"),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(completeOAuthConnectMock).not.toHaveBeenCalled();
    expect(stateRow("state-1")).toMatchObject({ error: "access_denied" });
    expect(stateRow("state-1")?.used_at).not.toBeNull();
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("facebook");
    expect(location.searchParams.get("message")).toBe(
      "The Facebook sign-in was cancelled or did not finish. Please click Connect again.",
    );
  });

  it("sends a callback without a state back to /connections with plain words, not a JSON error", async () => {
    const response = await GET(
      new NextRequest("https://app.test/api/oauth/instagram/callback?code=code-1"),
      { params: Promise.resolve({ provider: "instagram" }) },
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(completeOAuthConnectMock).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("oauth")).toBe("error");
    expect(location.searchParams.get("provider")).toBe("instagram");
    expect(location.searchParams.get("message")).toBe(
      "This connection link has expired or was already used. Please click Connect again.",
    );
  });

  it("does not use up a pending Page choice named in an error callback", async () => {
    const before = stateRow(CHOICE_REFERENCE);

    await GET(
      new NextRequest(`https://app.test/api/oauth/facebook/callback?error=access_denied&state=${CHOICE_REFERENCE}`),
      { params: Promise.resolve({ provider: "facebook" }) },
    );

    expect(stateRow(CHOICE_REFERENCE)).toEqual(before);
    expect(stateRow(CHOICE_REFERENCE)).toMatchObject({ used_at: null, error: null });
  });
  describe("Google (provider gbp)", () => {
    const callback = (query: string) =>
      GET(new NextRequest(`https://app.test/api/oauth/gbp/callback?${query}`), {
        params: Promise.resolve({ provider: "gbp" }),
      });

    it("always goes on to the location picker, with only the choice reference in the address", async () => {
      const reference = "G".repeat(43);
      completeGoogleConnectMock.mockResolvedValueOnce({ success: true, locationChoice: reference });

      const response = await callback("code=code-1&state=google-state");

      expect(completeGoogleConnectMock).toHaveBeenCalledWith("code-1", "google-state");
      expect(completeOAuthConnectMock).not.toHaveBeenCalled();
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin).toBe("https://app.test");
      expect(location.pathname).toBe("/connections/choose-location");
      expect([...location.searchParams.keys()]).toEqual(["choice"]);
      expect(location.searchParams.get("choice")).toBe(reference);
    });

    it("never reports success without a location choice", async () => {
      completeGoogleConnectMock.mockResolvedValueOnce({ success: true });

      const response = await callback("code=code-1&state=google-state");

      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/connections");
      expect(location.searchParams.get("oauth")).toBe("error");
    });

    it("sends the owner back to Connections with the plain message when Google refuses the listing", async () => {
      const message =
        "Google has not approved API access for this app yet, so your profile could not be listed. Nothing was saved.";
      completeGoogleConnectMock.mockResolvedValueOnce({ success: false, error: message });

      const response = await callback("code=code-1&state=google-state");

      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/connections");
      expect(location.searchParams.get("oauth")).toBe("error");
      expect(location.searchParams.get("provider")).toBe("gbp");
      expect(location.searchParams.get("message")).toBe(message);
    });

    it("says the Google sign-in was cancelled, and marks the state failed, when the owner cancels", async () => {
      const response = await callback("error=access_denied&state=google-state");

      const location = new URL(response.headers.get("location") ?? "");
      expect(completeGoogleConnectMock).not.toHaveBeenCalled();
      expect(stateRow("google-state")).toMatchObject({ error: "access_denied" });
      expect(stateRow("google-state")?.used_at).not.toBeNull();
      expect(location.searchParams.get("message")).toBe(
        "The Google sign-in was cancelled or did not finish. Nothing was saved. Please click Connect again.",
      );
    });

    it("redirects with plain words, and never the thrown text, when the connect step throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      completeGoogleConnectMock.mockRejectedValueOnce(new Error("connect ECONNRESET 10.0.0.1"));

      const response = await callback("code=code-1&state=google-state");

      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/connections");
      expect(location.searchParams.get("message")).toBe("We could not finish connecting. Please click Connect again.");
      consoleError.mockRestore();
    });

    it("sends a signed-out owner to sign in", async () => {
      completeGoogleConnectMock.mockImplementationOnce(async () => redirect("/auth/login"));

      const outcome = await redirectOf(() => callback("code=code-1&state=google-state"));

      expect(outcome).toEqual({ path: "/auth/login", status: 307 });
    });
  });
});
