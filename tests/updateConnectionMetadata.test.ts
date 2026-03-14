import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const revalidatePathMock = vi.fn();

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

function createSocialSelectQuery() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: "conn-1",
        metadata: { existingKey: "keep-me" },
        status: "needs_action",
        access_token: "access-token",
      },
      error: null,
    })),
  });
  return builder;
}

function createSocialUpdateQuery() {
  let eqCalls = 0;
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: vi.fn(() => {
      eqCalls += 1;
      if (eqCalls >= 2) {
        return Promise.resolve({ error: null });
      }
      return chain;
    }),
  });

  return {
    update: vi.fn((payload: Record<string, unknown>) => {
      capturedUpdatePayload = payload;
      eqCalls = 0;
      return chain;
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

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
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

describe("updateConnectionMetadata", () => {
  beforeAll(() => {
    seedBaseEnv();
  });

  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    revalidatePathMock.mockReset();
    requireAuthContextMock.mockResolvedValue({ accountId: "account-1" });
    capturedUpdatePayload = null;
    capturedNotificationPayload = null;
    fromQueue = [];
    seedBaseEnv();
  });

  it("rejects Google Place IDs for GBP metadata", async () => {
    const { updateConnectionMetadata } = await import("@/app/(app)/connections/actions");

    await expect(updateConnectionMetadata({
      provider: "gbp",
      metadataValue: "locations/ChIJDcbcERJxdkgReaFjdQ7fzfg",
    })).rejects.toThrow(/not a Google Place ID/i);

    expect(requireAuthContextMock).not.toHaveBeenCalled();
  });

  it("normalizes account-qualified GBP location IDs before persisting them", async () => {
    fromQueue.push(
      { table: "social_connections", builder: createSocialSelectQuery() },
      { table: "social_connections", builder: createSocialUpdateQuery() },
      { table: "notifications", builder: createNotificationsQuery() },
    );

    const { updateConnectionMetadata } = await import("@/app/(app)/connections/actions");
    const result = await updateConnectionMetadata({
      provider: "gbp",
      metadataValue: "accounts/555/locations/123456789",
    });

    expect(capturedUpdatePayload).toMatchObject({
      metadata: {
        existingKey: "keep-me",
        locationId: "locations/123456789",
      },
      status: "active",
    });
    expect(capturedNotificationPayload).toMatchObject({
      metadata: {
        provider: "gbp",
        metadataKey: "locationId",
        value: "locations/123456789",
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/connections");
    expect(revalidatePathMock).toHaveBeenCalledWith("/planner");
    expect(result.value).toBe("locations/123456789");
  });
});
