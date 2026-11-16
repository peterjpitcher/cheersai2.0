import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

const { serverEnv, serviceFrom } = vi.hoisted(() => ({
  serverEnv: { GOOGLE_MY_BUSINESS_CLIENT_ID: "id", GOOGLE_MY_BUSINESS_CLIENT_SECRET: "secret" } as Record<string, string>,
  serviceFrom: { current: null as null | ((table: string) => unknown) },
}));
vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" }, server: serverEnv },
}));
vi.mock("@/lib/supabase/service", () => ({
  tryCreateServiceSupabaseClient: () => ({ from: (table: string) => serviceFrom.current?.(table) }),
}));

import { listConnectionDiagnostics } from "@/lib/connections/diagnostics";
import { getGoogleConnectionSummary } from "@/lib/connections/google-data";
import { getConnectionHealthSummaries } from "@/lib/connections/health";
import { evaluateConnectionMetadata } from "@/lib/connections/metadata";
import { deriveConnectionReadiness } from "@/lib/connections/readiness";

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const METADATA = { localPostParent: "accounts/1/locations/2", locationTitle: "The Anchor", placeId: "place-1" };

/** A query builder that resolves to `result` however the chain ends. */
function builder(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) chain[method] = vi.fn(() => chain);
  chain.returns = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function context(googlePosts: boolean | undefined, tables: Record<string, unknown>) {
  const from = vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
    return builder(tables[table]);
  });
  serviceFrom.current = from;
  return {
    accountId: "account-1",
    supabase: { from },
    ...(googlePosts === undefined
      ? {}
      : { features: { paidAds: false, tournaments: false, managementImport: false, googlePosts } }),
  };
}

describe("deriveConnectionReadiness for Google", () => {
  const base = { provider: "gbp" as const, storedStatus: "active", metadataComplete: true, hasAccessToken: true };

  it("is ready and active with an expired access token and a stored refresh token", () => {
    const readiness = deriveConnectionReadiness({ ...base, hasRefreshToken: true, expiresAt: ago(HOUR) });
    expect(readiness).toEqual({ status: "active", ready: true, issues: [] });
  });

  it("never warns that the hourly access token is about to expire", () => {
    for (const expiresAt of [ahead(10 * 60 * 1000), ahead(HOUR), null]) {
      expect(deriveConnectionReadiness({ ...base, hasRefreshToken: true, expiresAt })).toEqual({
        status: "active",
        ready: true,
        issues: [],
      });
    }
  });

  it("needs a reconnect without a refresh token", () => {
    const readiness = deriveConnectionReadiness({ ...base, hasRefreshToken: false, expiresAt: ahead(HOUR) });
    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe("needs_action");
    expect(readiness.issues).toEqual([
      { code: "refresh_token_missing", severity: "error", message: "Google needs to be reconnected." },
    ]);
  });

  it("is not ready when the stored status needs action, whatever tokens are held", () => {
    const readiness = deriveConnectionReadiness({ ...base, storedStatus: "needs_action", hasRefreshToken: true, expiresAt: ahead(HOUR) });
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toEqual(["connection_status"]);
  });

  it("still treats an expired Facebook token as expired, refresh flag or not", () => {
    const readiness = deriveConnectionReadiness({
      provider: "facebook",
      storedStatus: "active",
      metadataComplete: true,
      hasAccessToken: true,
      hasRefreshToken: true,
      expiresAt: ago(HOUR),
    });
    expect(readiness.issues.map((issue) => issue.code)).toEqual(["token_expired"]);
  });
});

describe("evaluateConnectionMetadata for Google", () => {
  it("needs the local posts parent", () => {
    expect(evaluateConnectionMetadata("gbp", METADATA)).toEqual({ complete: true, missingKeys: [] });
    expect(evaluateConnectionMetadata("gbp", { locationTitle: "The Anchor" })).toEqual({
      complete: false,
      missingKeys: ["localPostParent"],
    });
  });
});

describe("getGoogleConnectionSummary", () => {
  beforeEach(() => {
    requireAuthContextMock.mockReset();
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = "id";
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = "secret";
  });

  const row = { id: "g-1", status: "active", platform_account_name: "The Anchor", token_expires_at: ago(HOUR), metadata: METADATA };

  it("is null, without reading the database, for a brand without the switch", async () => {
    const ctx = context(false, {});
    requireAuthContextMock.mockResolvedValue(ctx);

    expect(await getGoogleConnectionSummary()).toBeNull();
    expect(ctx.supabase.from).not.toHaveBeenCalled();
  });

  it("is null when the brand has no feature switches at all", async () => {
    requireAuthContextMock.mockResolvedValue(context(undefined, {}));
    expect(await getGoogleConnectionSummary()).toBeNull();
  });

  it("is ready with an expired access token and a stored refresh token", async () => {
    requireAuthContextMock.mockResolvedValue(
      context(true, {
        social_connections: { data: row, error: null },
        token_vault: { data: [{ token_type: "access" }, { token_type: "refresh" }], error: null },
      }),
    );

    expect(await getGoogleConnectionSummary()).toEqual({
      configured: true,
      connected: true,
      status: "active",
      ready: true,
      locationTitle: "The Anchor",
      hasAccessToken: true,
      hasRefreshToken: true,
      issues: [],
    });
  });

  it("needs action after a disconnect, when no tokens are stored", async () => {
    requireAuthContextMock.mockResolvedValue(
      context(true, {
        social_connections: { data: { ...row, status: "needs_action" }, error: null },
        token_vault: { data: [], error: null },
      }),
    );

    const summary = await getGoogleConnectionSummary();
    expect(summary).toMatchObject({ connected: true, status: "needs_action", ready: false, hasAccessToken: false, hasRefreshToken: false });
  });

  it("says nothing is connected for a brand that has never connected", async () => {
    requireAuthContextMock.mockResolvedValue(context(true, { social_connections: { data: null, error: null } }));

    expect(await getGoogleConnectionSummary()).toMatchObject({ connected: false, ready: false, locationTitle: null });
  });

  it("reports the OAuth client as not set up when either half is missing", async () => {
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = "";
    requireAuthContextMock.mockResolvedValue(context(true, { social_connections: { data: null, error: null } }));

    expect(await getGoogleConnectionSummary()).toMatchObject({ configured: false });
  });
});

describe("a stored Google row is hidden from a brand without the switch", () => {
  const rows = [
    { id: "fb-1", provider: "facebook", platform_account_name: "Page", status: "active", token_expires_at: null, expires_at: null, last_synced_at: null },
    { id: "g-1", provider: "gbp", platform_account_name: "The Anchor", status: "active", token_expires_at: ago(HOUR), expires_at: null, last_synced_at: null },
  ];

  it("leaves Google out of the sidebar health for a brand without the switch", async () => {
    for (const ctx of [context(false, { social_connections: { data: rows, error: null } }), context(undefined, { social_connections: { data: rows, error: null } })]) {
      requireAuthContextMock.mockResolvedValue(ctx);
      expect((await getConnectionHealthSummaries()).map((summary) => summary.provider)).toEqual(["facebook"]);
    }
  });

  it("shows Google as healthy, with an expired access token, for a brand with the switch", async () => {
    requireAuthContextMock.mockResolvedValue(
      context(true, {
        social_connections: { data: rows, error: null },
        token_vault: { data: [{ social_connection_id: "g-1" }], error: null },
      }),
    );

    const summaries = await getConnectionHealthSummaries();
    expect(summaries.map((summary) => [summary.provider, summary.health])).toEqual([
      ["facebook", "green"],
      ["gbp", "green"],
    ]);
  });

  it("shows Google as unhealthy when no refresh token is stored", async () => {
    requireAuthContextMock.mockResolvedValue(
      context(true, { social_connections: { data: rows, error: null }, token_vault: { data: [], error: null } }),
    );

    expect((await getConnectionHealthSummaries()).find((summary) => summary.provider === "gbp")?.health).toBe("red");
  });

  it("leaves Google out of the diagnostics table for a brand without the switch", async () => {
    const diagnosticRows = rows.map((entry) => ({
      provider: entry.provider,
      status: entry.status,
      display_name: null,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      last_synced_at: null,
      updated_at: null,
      metadata: null,
    }));

    requireAuthContextMock.mockResolvedValue(context(false, { social_connections: { data: diagnosticRows, error: null } }));
    expect((await listConnectionDiagnostics()).map((item) => item.provider)).toEqual(["facebook"]);

    requireAuthContextMock.mockResolvedValue(context(true, { social_connections: { data: diagnosticRows, error: null } }));
    expect((await listConnectionDiagnostics()).map((item) => item.provider)).toEqual(["facebook", "gbp"]);
  });
});
