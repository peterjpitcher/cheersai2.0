import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ensureOwnerAccountMock = vi.fn();
const isSchemaMissingErrorMock = vi.fn();
const returnsMock = vi.fn();

function seedBaseEnv(overrides: Record<string, string | undefined> = {}) {
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
    const override = overrides[key];
    if (typeof override === "string") {
      process.env[key] = override;
    } else if (!process.env[key]) {
      process.env[key] = defaultValue;
    }
  });

  if (overrides.ENABLE_CONNECTION_DIAGNOSTICS !== undefined) {
    process.env.ENABLE_CONNECTION_DIAGNOSTICS = overrides.ENABLE_CONNECTION_DIAGNOSTICS;
  }
}

const queryBuilder: Record<string, unknown> = {};

Object.assign(queryBuilder, {
  select: vi.fn(() => queryBuilder),
  eq: vi.fn(() => queryBuilder),
  order: vi.fn(() => queryBuilder),
  returns: (...args: unknown[]) => returnsMock(...args),
});

const fromMock = vi.fn(() => queryBuilder);

vi.mock("@/lib/supabase/owner", () => ({
  ensureOwnerAccount: ensureOwnerAccountMock,
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: (...args: unknown[]) => isSchemaMissingErrorMock(...args),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({
    from: fromMock,
  }),
}));

describe("listConnectionDiagnostics", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    ensureOwnerAccountMock.mockReset();
    isSchemaMissingErrorMock.mockReset();
    returnsMock.mockReset();
    (queryBuilder.select as Mock).mockClear();
    (queryBuilder.eq as Mock).mockClear();
    (queryBuilder.order as Mock).mockClear();
    fromMock.mockClear();
  });

  it("masks secrets and normalises status", async () => {
    const nowIso = new Date().toISOString();
    returnsMock.mockResolvedValue({
      data: [
        {
          provider: "facebook",
          status: "unknown",
          display_name: "Cheers Page",
          access_token: "abcd1234efgh5678",
          refresh_token: "short",
          expires_at: nowIso,
          last_synced_at: null,
          updated_at: nowIso,
          metadata: { pageId: "123" },
        },
      ],
      error: null,
    });
    isSchemaMissingErrorMock.mockReturnValue(false);

    const { listConnectionDiagnostics } = await import("@/lib/connections/diagnostics");
    const result = await listConnectionDiagnostics();

    expect(result).toEqual([
      {
        provider: "facebook",
        status: "needs_action",
        displayName: "Cheers Page",
        accessTokenPreview: "abcd…5678",
        refreshTokenPreview: "sh…rt",
        expiresAt: nowIso,
        lastSyncedAt: null,
        updatedAt: nowIso,
        metadata: { pageId: "123" },
      },
    ]);
    expect(ensureOwnerAccountMock).toHaveBeenCalled();
  });

  it("returns an empty array when schema missing", async () => {
    returnsMock.mockResolvedValue({ data: null, error: { message: "missing" } });
    isSchemaMissingErrorMock.mockReturnValue(true);

    const { listConnectionDiagnostics } = await import("@/lib/connections/diagnostics");
    const result = await listConnectionDiagnostics();

    expect(result).toEqual([]);
  });
});

describe("featureFlags.connectionDiagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true when flag is truthy", async () => {
    seedBaseEnv({ ENABLE_CONNECTION_DIAGNOSTICS: "true" });
    const { featureFlags } = await import("@/env");
    expect(featureFlags.connectionDiagnostics).toBe(true);
  });

  it("returns false when flag is absent", async () => {
    seedBaseEnv({ ENABLE_CONNECTION_DIAGNOSTICS: "" });
    const { featureFlags } = await import("@/env");
    expect(featureFlags.connectionDiagnostics).toBe(false);
  });
});
