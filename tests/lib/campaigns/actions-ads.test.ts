import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();

interface FromQueueEntry {
  table: string;
  builder: Record<string, unknown>;
}

let fromQueue: FromQueueEntry[] = [];

function seedBaseEnv() {
  const defaults: Record<string, string> = {
    ALERTS_SECRET: "test-alert",
    CRON_SECRET: "test-cron",
    FACEBOOK_APP_SECRET: "fb-secret",
    GOOGLE_MY_BUSINESS_CLIENT_ID: "google-client",
    GOOGLE_MY_BUSINESS_CLIENT_SECRET: "google-secret",
    INSTAGRAM_APP_ID: "ig-app",
    INSTAGRAM_APP_SECRET: "ig-secret",
    INSTAGRAM_VERIFY_TOKEN: "verify",
    OPENAI_API_KEY: "openai",
    RESEND_API_KEY: "resend",
    RESEND_FROM: "notifications@test",
    SUPABASE_SERVICE_ROLE_KEY: "supabase",
    NEXT_PUBLIC_FACEBOOK_APP_ID: "fb-app",
    NEXT_PUBLIC_SITE_URL: "https://example.com",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.local",
  };

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
    }
  });
}

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({
    from: (table: string) => {
      const next = fromQueue.shift();
      if (!next) {
        throw new Error(`Unexpected from("${table}") call — queue is empty`);
      }
      if (next.table !== table) {
        throw new Error(`Expected from("${next.table}") but received from("${table}")`);
      }
      return next.builder;
    },
  }),
}));

vi.mock("@/lib/meta/graph", () => ({
  getMetaGraphApiBase: () => "https://graph.facebook.com/v24.0",
}));

describe("selectAdAccount", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    fromQueue = [];
    requireAuthContextMock.mockResolvedValue({ accountId: "account-uuid-1" });
  });

  it("should return error when no ads token exists", async () => {
    // Queue: meta_ad_accounts returns no row
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    });

    fromQueue.push({ table: "meta_ad_accounts", builder: selectBuilder });

    const { selectAdAccount } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await selectAdAccount("act_123456789");

    expect(result).toEqual({ error: "No ads token found." });
    expect(fromQueue).toHaveLength(0);
  });

  it("should return success when token exists and fetch succeeds", async () => {
    // Queue: meta_ad_accounts returns a token
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { access_token: "valid-token-abc" },
        error: null,
      })),
    });

    // Queue: meta_ad_accounts upsert
    const upsertBuilder: Record<string, unknown> = {};
    Object.assign(upsertBuilder, {
      upsert: vi.fn(async () => ({ error: null })),
    });

    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: upsertBuilder },
    );

    // Mock fetch for the Graph API account details call
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "act_123456789",
          currency: "GBP",
          timezone_name: "Europe/London",
        }),
        { status: 200 },
      ),
    );

    const { selectAdAccount } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await selectAdAccount("act_123456789");

    expect(result).toEqual({ success: true });
    expect(fromQueue).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it("should return error when db upsert fails", async () => {
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { access_token: "valid-token" },
        error: null,
      })),
    });

    const upsertBuilder: Record<string, unknown> = {};
    Object.assign(upsertBuilder, {
      upsert: vi.fn(async () => ({
        error: { message: "DB constraint violation" },
      })),
    });

    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: upsertBuilder },
    );

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "act_123", currency: "USD", timezone_name: "America/New_York" }),
        { status: 200 },
      ),
    );

    const { selectAdAccount } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await selectAdAccount("act_123");

    expect(result).toEqual({ error: "DB constraint violation" });

    fetchSpy.mockRestore();
  });
});
