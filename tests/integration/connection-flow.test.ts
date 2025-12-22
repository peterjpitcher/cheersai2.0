import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemorySupabase } from "../helpers/mock-supabase";

// Mocks
const mockDb = new InMemorySupabase();

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => mockDb.getClient(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: "acc-123" }),
}));

vi.mock("@/lib/connections/token-exchange", () => ({
  exchangeProviderAuthCode: vi.fn().mockResolvedValue({
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    displayName: "Test Page",
    metadata: { pageId: "page-123" },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Connection OAuth Flow (Integration)", () => {
  beforeEach(() => {
    mockDb.store = {
      social_connections: [],
      oauth_states: [],
      notifications: [],
      accounts: [],
    };
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  });

  it("successfully links a facebook account and updates state", async () => {
    const { completeConnectionOAuth } = await import("@/app/(app)/connections/actions");

    // Setup initial state
    mockDb.seed("oauth_states", [{
      provider: "facebook",
      state: "123e4567-e89b-12d3-a456-426614174000",
      auth_code: "auth-code-123",
      redirect_to: "/planner",
      created_at: new Date().toISOString(),
    }]);

    mockDb.seed("social_connections", [{
      id: "conn-1",
      account_id: "acc-123",
      provider: "facebook",
      status: "needs_action",
    }]);

    // Execute
    const result = await completeConnectionOAuth({ state: "123e4567-e89b-12d3-a456-426614174000" });

    // Assert
    expect(result).toEqual({ ok: true, provider: "facebook", redirectTo: "/planner" });

    // Verify DB state (Connections updated)
    const connection = mockDb.store.social_connections.find(c => c.id === "conn-1");
    expect(connection).toMatchObject({
      status: "active",
      access_token: "new-access-token",
      display_name: "Test Page",
    });

    // Verify DB state (Notification created)
    const notification = mockDb.store.notifications[0];
    expect(notification).toMatchObject({
      category: "connection_reconnected",
      account_id: "acc-123",
    });
  });
});
