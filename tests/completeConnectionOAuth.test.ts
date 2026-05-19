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

// DEPRECATED: v1 completeConnectionOAuth was replaced by v2 completeOAuthConnect
// in plan 03-04. The v2 API stores tokens in token vault instead of plaintext columns.
// See src/app/(app)/connections/actions.test.ts for current test coverage.
describe.skip("completeConnectionOAuth (v1 - DEPRECATED)", () => {
  it("was replaced by completeOAuthConnect in v2", () => {
    expect(true).toBe(true);
  });
});
