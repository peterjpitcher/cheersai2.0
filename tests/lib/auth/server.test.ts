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
  it("prefers the snake_case account id from app metadata", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-1",
        app_metadata: { account_id: "account-42" },
      }),
    ).toBe("account-42");
  });

  it("supports camelCase account id in app metadata", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-2",
        app_metadata: { accountId: "account-99" },
      }),
    ).toBe("account-99");
  });

  it("ignores user metadata", async () => {
    const { resolveAccountId } = await authModulePromise;
    expect(
      resolveAccountId({
        id: "user-3",
        user_metadata: { account_id: "account-5" },
      }),
    ).toBe("user-3");
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
