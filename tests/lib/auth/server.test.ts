import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  tryCreateServiceSupabaseClient: vi.fn(() => null),
}));

const authModulePromise = import("@/lib/auth/server");

describe("resolveAccountId", () => {
  it("prefers the snake_case account id from user metadata", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-1",
        user_metadata: { account_id: "account-42" },
      }),
    ).toBe("account-42");
  });

  it("supports camelCase account id in user metadata", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-2",
        user_metadata: { accountId: "account-99" },
      }),
    ).toBe("account-99");
  });

  it("falls back to app metadata when user metadata is missing", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-3",
        app_metadata: { account_id: "account-5" },
      }),
    ).toBe("account-5");
  });

  it("defaults to the user id when metadata is unavailable", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-4",
      }),
    ).toBe("user-4");
  });
});
