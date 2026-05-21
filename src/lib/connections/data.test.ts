import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

function createBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    returns: vi.fn(async () => result),
  });
  return builder;
}

describe("listConnectionSummaries", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
  });

  it("does not show an active connection when publishing token is missing", async () => {
    const socialConnections = createBuilder({
      data: [
        {
          id: "conn-facebook",
          provider: "facebook",
          status: "active",
          display_name: "Cheers Page",
          platform_account_name: null,
          last_synced_at: null,
          token_expires_at: null,
          expires_at: null,
          access_token: null,
          metadata: { pageId: "123" },
        },
      ],
      error: null,
    });
    const tokenVault = createBuilder({ data: [], error: null });
    const from = vi.fn((table: string) => {
      if (table === "social_connections") return socialConnections;
      if (table === "token_vault") return tokenVault;
      throw new Error(`Unexpected table ${table}`);
    });
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase: { from } });

    const { listConnectionSummaries } = await import("./data");
    const summaries = await listConnectionSummaries();
    const facebook = summaries.find((summary) => summary.provider === "facebook");

    expect(facebook).toMatchObject({
      status: "needs_action",
      ready: false,
      hasAccessToken: false,
    });
    expect(facebook?.issues.map((issue) => issue.code)).toContain("token_missing");
  });

  it("treats a token-vault access token as publish-ready", async () => {
    const socialConnections = createBuilder({
      data: [
        {
          id: "conn-facebook",
          provider: "facebook",
          status: "active",
          display_name: "Cheers Page",
          platform_account_name: null,
          last_synced_at: null,
          token_expires_at: null,
          expires_at: null,
          access_token: null,
          metadata: { pageId: "123" },
        },
      ],
      error: null,
    });
    const tokenVault = createBuilder({
      data: [{ social_connection_id: "conn-facebook" }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "social_connections") return socialConnections;
      if (table === "token_vault") return tokenVault;
      throw new Error(`Unexpected table ${table}`);
    });
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1", supabase: { from } });

    const { listConnectionSummaries } = await import("./data");
    const summaries = await listConnectionSummaries();
    const facebook = summaries.find((summary) => summary.provider === "facebook");

    expect(facebook).toMatchObject({
      status: "active",
      ready: true,
      hasAccessToken: true,
    });
  });
});
