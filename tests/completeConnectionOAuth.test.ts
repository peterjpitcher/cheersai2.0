import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const exchangeProviderAuthCodeMock = vi.fn();
const revalidatePathMock = vi.fn();
const isSchemaMissingErrorMock = vi.fn();

interface FromQueueEntry {
  table: string;
  builder: Record<string, unknown>;
}

let fromQueue: FromQueueEntry[] = [];
let capturedUpdatePayload: Record<string, unknown> | null = null;
let capturedNotificationPayload: Record<string, unknown> | null = null;
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
}

function createOauthQuery() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: {
        provider: "facebook",
        auth_code: "CODE",
        error: null,
        redirect_to: "/planner",
      },
      error: null,
    })),
  });
  return builder;
}

function createSocialSelectQuery() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: "conn-1",
        metadata: { pageId: "123" },
        display_name: "Old Page",
      },
      error: null,
    })),
  });
  return builder;
}

function createSocialUpdateQuery() {
  const eqMock = vi.fn(async () => ({ error: null }));
  return {
    update: vi.fn((payload: Record<string, unknown>) => {
      capturedUpdatePayload = payload;
      return { eq: eqMock };
    }),
  };
}

function createNotificationsQuery() {
  return {
    insert: vi.fn(async (payload: Record<string, unknown>) => {
      capturedNotificationPayload = payload;
      return { error: null };
    }),
  };
}

function createCleanupQuery() {
  const isMock = vi.fn(async () => ({ error: null }));
  const notMock = vi.fn(async () => ({ error: null }));
  const lteMock = vi.fn(() => ({
    is: isMock,
    not: notMock,
  }));
  const deleteMock = vi.fn(() => ({ lte: lteMock }));
  return {
    delete: deleteMock,
  };
}

let oauthQuery: Record<string, unknown>;
let socialSelectQuery: Record<string, unknown>;

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: (...args: unknown[]) => isSchemaMissingErrorMock(...args),
}));

vi.mock("@/lib/connections/token-exchange", () => ({
  exchangeProviderAuthCode: exchangeProviderAuthCodeMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({
    from: (table: string) => {
      const next = fromQueue.shift();
      if (!next) {
        throw new Error(`Unexpected from call for ${table}`);
      }
      if (next.table !== table) {
        throw new Error(`Expected from(${next.table}) but received from(${table})`);
      }
      return next.builder;
    },
  }),
}));

describe("completeConnectionOAuth", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    exchangeProviderAuthCodeMock.mockReset();
    revalidatePathMock.mockReset();
    isSchemaMissingErrorMock.mockReset();
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1" });
    capturedUpdatePayload = null;
    capturedNotificationPayload = null;
    fromQueue = [];
    seedBaseEnv();
    oauthQuery = createOauthQuery();
    socialSelectQuery = createSocialSelectQuery();
    const socialUpdateQuery = createSocialUpdateQuery();
    const notificationsQuery = createNotificationsQuery();
    const cleanupQueryA = createCleanupQuery();
    const cleanupQueryB = createCleanupQuery();

    fromQueue.push(
      { table: "oauth_states", builder: oauthQuery },
      { table: "social_connections", builder: socialSelectQuery },
      { table: "social_connections", builder: socialUpdateQuery },
      { table: "notifications", builder: notificationsQuery },
      { table: "oauth_states", builder: cleanupQueryA },
      { table: "oauth_states", builder: cleanupQueryB },
    );

    exchangeProviderAuthCodeMock.mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "ref-token",
      expiresAt: "2025-01-01T00:00:00.000Z",
      displayName: "Fresh Page",
      metadata: { pageId: "123", instagramUsername: "pub" },
    });

    isSchemaMissingErrorMock.mockReturnValue(false);
  });

  it("updates connection and returns redirect path", async () => {
    const { completeConnectionOAuth } = await import("@/app/(app)/connections/actions");

    const stateValue = "123e4567-e89b-12d3-a456-426614174000";
    const result = await completeConnectionOAuth({ state: stateValue });

    expect(requireAuthContextMock).toHaveBeenCalled();
    expect(exchangeProviderAuthCodeMock).toHaveBeenCalledWith("facebook", "CODE", {
      existingMetadata: { pageId: "123" },
    });
    expect(capturedUpdatePayload).toMatchObject({
      access_token: "new-token",
      refresh_token: "ref-token",
      status: "active",
      display_name: "Fresh Page",
      metadata: { pageId: "123", instagramUsername: "pub" },
    });
    expect(capturedNotificationPayload).toMatchObject({
      account_id: expect.any(String),
      category: "connection_reconnected",
      metadata: { provider: "facebook", state: stateValue },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/connections");
    expect(revalidatePathMock).toHaveBeenCalledWith("/planner");
    expect(result).toEqual({ ok: true, provider: "facebook", redirectTo: "/planner" });
    expect(fromQueue).toHaveLength(0);
  });
});
