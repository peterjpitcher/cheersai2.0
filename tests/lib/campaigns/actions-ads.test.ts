import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const revalidatePathMock = vi.hoisted(() => vi.fn());
const adTokenMocks = vi.hoisted(() => ({
  getMetaAdAccountTokens: vi.fn(),
  storeMetaAdAccountToken: vi.fn(),
}));

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

vi.mock("@/lib/meta/ad-account-tokens", () => adTokenMocks);

function useStoredTokens(accessToken: string | null, conversionsApiToken: string | null = null) {
  adTokenMocks.getMetaAdAccountTokens.mockReset();
  adTokenMocks.getMetaAdAccountTokens.mockResolvedValue({ accessToken, conversionsApiToken });
  adTokenMocks.storeMetaAdAccountToken.mockReset();
  adTokenMocks.storeMetaAdAccountToken.mockResolvedValue(undefined);
}

vi.mock("@/lib/meta/graph", () => ({
  getMetaGraphApiBase: () => "https://graph.facebook.com/v24.0",
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

describe("selectAdAccount", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
    fromQueue = [];
    useStoredTokens(null);
    requireAuthContextMock.mockResolvedValue({ accountId: "account-uuid-1", features: { paidAds: true, tournaments: true, managementImport: true }, role: "owner" });
  });

  it("should return error when no ads token exists", async () => {
    useStoredTokens(null);

    const { selectAdAccount } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await selectAdAccount("act_123456789");

    expect(result).toEqual({ error: "No ads token found." });
    expect(fromQueue).toHaveLength(0);
  });

  it("should return success when token exists and fetch succeeds", async () => {
    useStoredTokens("valid-token-abc");

    // Queue: meta_ad_accounts upsert
    const upsertBuilder: Record<string, unknown> = {};
    Object.assign(upsertBuilder, {
      upsert: vi.fn(async () => ({ error: null })),
    });

    fromQueue.push({ table: "meta_ad_accounts", builder: upsertBuilder });

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
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/act_123456789?fields=id%2Ccurrency%2Ctimezone_name&access_token=valid-token-abc",
    );
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      {
        account_id: "account-uuid-1",
        meta_account_id: "act_123456789",
        currency: "GBP",
        timezone: "Europe/London",
        setup_complete: true,
      },
      { onConflict: "account_id" },
    );
    expect(adTokenMocks.getMetaAdAccountTokens).toHaveBeenCalledWith(expect.anything(), "account-uuid-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/connections");
    expect(revalidatePathMock).toHaveBeenCalledWith("/campaigns");
    expect(fromQueue).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it("fails with the token store's error instead of acting on a missing token", async () => {
    adTokenMocks.getMetaAdAccountTokens.mockReset();
    adTokenMocks.getMetaAdAccountTokens.mockRejectedValue(new Error("token could not be decrypted"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { selectAdAccount } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await selectAdAccount("act_123456789");

    expect(result).toEqual({ error: "token could not be decrypted" });
    expect(fromQueue).toHaveLength(0);
  });

  it("normalises numeric Meta account IDs before saving", async () => {
    useStoredTokens("valid-token-abc");

    const upsertBuilder: Record<string, unknown> = {};
    Object.assign(upsertBuilder, {
      upsert: vi.fn(async () => ({ error: null })),
    });

    fromQueue.push({ table: "meta_ad_accounts", builder: upsertBuilder });

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
    const result = await selectAdAccount("123456789");

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/act_123456789?fields=id%2Ccurrency%2Ctimezone_name&access_token=valid-token-abc",
    );
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ meta_account_id: "act_123456789" }),
      { onConflict: "account_id" },
    );
    expect(fromQueue).toHaveLength(0);

    fetchSpy.mockRestore();
  });

  it("should return error when db upsert fails", async () => {
    useStoredTokens("valid-token");

    const upsertBuilder: Record<string, unknown> = {};
    Object.assign(upsertBuilder, {
      upsert: vi.fn(async () => ({
        error: { message: "DB constraint violation" },
      })),
    });

    fromQueue.push({ table: "meta_ad_accounts", builder: upsertBuilder });

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

describe("getAdAccountSetupStatus", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
    fromQueue = [];
    useStoredTokens(null);
    requireAuthContextMock.mockResolvedValue({ accountId: "account-uuid-1", features: { paidAds: true, tournaments: true, managementImport: true }, role: "owner" });
  });

  it("logs database errors instead of silently reporting disconnected status", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const selectBuilder: Record<string, unknown> = {};
    const dbError = {
      message: "column meta_ad_accounts.conversions_api_access_token does not exist",
      code: "42703",
    };

    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: null,
        error: dbError,
      })),
    });

    fromQueue.push({ table: "meta_ad_accounts", builder: selectBuilder });

    const { getAdAccountSetupStatus } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await getAdAccountSetupStatus();

    expect(result.connected).toBe(false);
    expect(result.setupComplete).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ads] failed to load Meta Ads setup status",
      {
        accountId: "account-uuid-1",
        error: dbError,
      },
    );
    expect(fromQueue).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });

  it("reports connected and CAPI configured from the encrypted token store", async () => {
    useStoredTokens("access-token", "capi-token");
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: {
          setup_complete: true,
          token_expires_at: null,
          meta_pixel_id: "123456789012345",
          conversion_event_name: "Purchase",
          conversion_optimisation_enabled: true,
        },
        error: null,
      })),
    });
    fromQueue.push({ table: "meta_ad_accounts", builder: selectBuilder });

    const { getAdAccountSetupStatus } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await getAdAccountSetupStatus();

    expect(selectBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining("access_token"));
    expect(result.connected).toBe(true);
    expect(result.setupComplete).toBe(true);
    expect(result.conversionsApiConfigured).toBe(true);
  });

  it("shows disconnected when the stored token cannot be read", async () => {
    adTokenMocks.getMetaAdAccountTokens.mockReset();
    adTokenMocks.getMetaAdAccountTokens.mockRejectedValue(new Error("token could not be decrypted"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { setup_complete: true, token_expires_at: null, meta_pixel_id: null, conversion_event_name: null, conversion_optimisation_enabled: null },
        error: null,
      })),
    });
    fromQueue.push({ table: "meta_ad_accounts", builder: selectBuilder });

    const { getAdAccountSetupStatus } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await getAdAccountSetupStatus();

    expect(result.connected).toBe(false);
    expect(result.conversionsApiConfigured).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ads] failed to load Meta Ads tokens for setup status",
      { accountId: "account-uuid-1", error: "token could not be decrypted" },
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("updateAdAccountConversionSettings", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
    fromQueue = [];
    useStoredTokens(null);
    requireAuthContextMock.mockResolvedValue({ accountId: "account-uuid-1", features: { paidAds: true, tournaments: true, managementImport: true }, role: "owner" });
  });

  it("allows the legacy seed pixel ID when it is entered explicitly", async () => {
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { setup_complete: true },
        error: null,
      })),
    });

    const updateEq = vi.fn(async () => ({ error: null }));
    const updateBuilder: Record<string, unknown> = {};
    Object.assign(updateBuilder, {
      update: vi.fn(() => ({ eq: updateEq })),
    });

    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: updateBuilder },
    );

    const { updateAdAccountConversionSettings } = await import(
      "@/app/(app)/connections/actions-ads"
    );

    const result = await updateAdAccountConversionSettings({
      metaPixelId: "757659911002159",
    });

    expect(result).toEqual({ success: true });
    expect(updateBuilder.update).toHaveBeenCalledWith({
      meta_pixel_id: "757659911002159",
      conversion_event_name: "Purchase",
      conversion_optimisation_enabled: true,
    });
    expect(fromQueue).toHaveLength(0);
  });

  it("saves a real pixel as Purchase optimisation", async () => {
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { setup_complete: true },
        error: null,
      })),
    });

    const updateEq = vi.fn(async () => ({ error: null }));
    const updateBuilder: Record<string, unknown> = {};
    Object.assign(updateBuilder, {
      update: vi.fn(() => ({ eq: updateEq })),
    });

    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: updateBuilder },
    );

    const { updateAdAccountConversionSettings } = await import(
      "@/app/(app)/connections/actions-ads"
    );

    const result = await updateAdAccountConversionSettings({
      metaPixelId: "123456789012345",
    });

    expect(result).toEqual({ success: true });
    expect(updateBuilder.update).toHaveBeenCalledWith({
      meta_pixel_id: "123456789012345",
      conversion_event_name: "Purchase",
      conversion_optimisation_enabled: true,
    });
    expect(fromQueue).toHaveLength(0);
  });

  it("saves a Meta CAPI token when supplied", async () => {
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({
        data: { setup_complete: true },
        error: null,
      })),
    });

    const updateEq = vi.fn(async () => ({ error: null }));
    const updateBuilder: Record<string, unknown> = {};
    Object.assign(updateBuilder, {
      update: vi.fn(() => ({ eq: updateEq })),
    });

    const actionUpdateBuilder: Record<string, unknown> = {};
    const actionQuery: Record<string, unknown> = {};
    const contains = vi.fn(async () => ({ error: null }));
    const actionEq = vi.fn(() => actionQuery);
    Object.assign(actionQuery, { eq: actionEq, contains });
    Object.assign(actionUpdateBuilder, {
      update: vi.fn(() => actionQuery),
    });

    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: updateBuilder },
      { table: "meta_optimisation_actions", builder: actionUpdateBuilder },
    );

    const { updateAdAccountConversionSettings } = await import(
      "@/app/(app)/connections/actions-ads"
    );

    const result = await updateAdAccountConversionSettings({
      metaPixelId: "123456789012345",
      conversionsApiAccessToken: "capi-token-1234567890",
    });

    expect(result).toEqual({ success: true });
    expect(updateBuilder.update).toHaveBeenCalledWith({
      meta_pixel_id: "123456789012345",
      conversion_event_name: "Purchase",
      conversion_optimisation_enabled: true,
    });
    expect(adTokenMocks.storeMetaAdAccountToken).toHaveBeenCalledWith(
      expect.anything(),
      "account-uuid-1",
      "conversions_api",
      "capi-token-1234567890",
    );
    expect(actionUpdateBuilder.update).toHaveBeenCalledWith({
      status: "skipped",
      error: "Superseded by updated Meta CAPI configuration.",
    });
    expect(actionEq).toHaveBeenNthCalledWith(1, "account_id", "account-uuid-1");
    expect(actionEq).toHaveBeenNthCalledWith(2, "status", "planned");
    expect(actionEq).toHaveBeenNthCalledWith(3, "action_type", "tracking_issue");
    expect(contains).toHaveBeenCalledWith("recommendation_payload", {
      category: "missing_capi_token",
    });
    expect(fromQueue).toHaveLength(0);
  });

  it("reports a failed CAPI token save and does not skip recommendations", async () => {
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      select: vi.fn(() => selectBuilder),
      eq: vi.fn(() => selectBuilder),
      maybeSingle: vi.fn(async () => ({ data: { setup_complete: true }, error: null })),
    });
    const updateBuilder: Record<string, unknown> = {};
    Object.assign(updateBuilder, {
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    });
    fromQueue.push(
      { table: "meta_ad_accounts", builder: selectBuilder },
      { table: "meta_ad_accounts", builder: updateBuilder },
    );
    adTokenMocks.storeMetaAdAccountToken.mockRejectedValue(new Error("Failed to store Meta Ads token: boom"));

    const { updateAdAccountConversionSettings } = await import(
      "@/app/(app)/connections/actions-ads"
    );
    const result = await updateAdAccountConversionSettings({
      metaPixelId: "123456789012345",
      conversionsApiAccessToken: "capi-token-1234567890",
    });

    expect(result).toEqual({ error: "Failed to store Meta Ads token: boom" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(fromQueue).toHaveLength(0);
  });
});
