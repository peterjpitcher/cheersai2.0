import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryConnectionsDb } from "../../../../../../tests/helpers/in-memory-connections-db";

const { completeOAuthConnectMock, createServiceSupabaseClientMock } = vi.hoisted(() => ({
  completeOAuthConnectMock: vi.fn(),
  createServiceSupabaseClientMock: vi.fn(),
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

describe("GET /api/oauth/[provider]/callback", () => {
  let db: InMemoryConnectionsDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new InMemoryConnectionsDb();
    db.seed("accounts", [{ id: ACCOUNT }]);
    db.seed("oauth_states", [
      { state: "state-1", provider: "facebook", account_id: ACCOUNT },
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
});
