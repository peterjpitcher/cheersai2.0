import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryConnectionsDb } from "../../../tests/helpers/in-memory-connections-db";

const { serverEnv } = vi.hoisted(() => ({
  serverEnv: { GOOGLE_MY_BUSINESS_CLIENT_ID: "client-id", GOOGLE_MY_BUSINESS_CLIENT_SECRET: "client-secret" } as Record<
    string,
    string
  >,
}));

vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" }, server: serverEnv },
}));

import { readGoogleVaultToken, writeGoogleVaultToken } from "@/lib/connections/google-persist";
import { getGoogleAccessToken } from "@/lib/connections/google-token";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const CONNECTION = "33333333-3333-4333-8333-333333333333";
const MINUTE = 60 * 1000;

const fetchMock = vi.fn();
let db: InMemoryConnectionsDb;

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A connected brand whose stored access token expires `expiresInMs` from now. */
async function seedConnection({
  expiresInMs,
  status = "active",
  access = "stored-access",
  refresh = "stored-refresh" as string | null,
}: {
  expiresInMs: number;
  status?: string;
  access?: string | null;
  refresh?: string | null;
}) {
  db.seed("social_connections", [
    {
      id: CONNECTION,
      account_id: ACCOUNT,
      provider: "gbp",
      status,
      platform_account_id: "accounts/111/locations/999",
      metadata: { localPostParent: "accounts/111/locations/999", locationTitle: "The Anchor", placeId: "place-1" },
      token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      // Older than any write in the test, as a real row would be.
      updated_at: "2026-11-01T09:00:00.123456+00:00",
    },
  ]);
  if (access) await writeGoogleVaultToken(db.client(), CONNECTION, "access", access);
  if (refresh) await writeGoogleVaultToken(db.client(), CONNECTION, "refresh", refresh);
}

const row = () => db.rows("social_connections").find((entry) => entry.id === CONNECTION)!;
const stored = (type: "access" | "refresh") => readGoogleVaultToken(db.client(), CONNECTION, type);

function logged(): string {
  return [console.error, console.warn, console.log]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .map(String)
    .join("\n");
}

beforeEach(() => {
  vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = "client-id";
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = "client-secret";
  db = new InMemoryConnectionsDb();
  db.seed("accounts", [{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getGoogleAccessToken", () => {
  it("returns the stored token untouched while it has more than five minutes left", async () => {
    await seedConnection({ expiresInMs: 30 * MINUTE });
    const before = row();

    const result = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(result).toEqual({ ok: true, accessToken: "stored-access", expiresAt: before.token_expires_at, refreshed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row()).toEqual(before);
  });

  it("refreshes an expired token, stores it and records the new expiry", async () => {
    await seedConnection({ expiresInMs: -10 * MINUTE });
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "fresh-access", expires_in: 3600, token_type: "Bearer" }));

    const result = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(result).toMatchObject({ ok: true, accessToken: "fresh-access", refreshed: true });
    expect(await stored("access")).toBe("fresh-access");
    expect(row().token_expires_at).toBe(result.ok ? result.expiresAt : null);
    expect(new Date(String(row().token_expires_at)).getTime()).toBeGreaterThan(Date.now() + 55 * MINUTE);
    expect(row().status).toBe("active");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.fromEntries(init.body as URLSearchParams)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "stored-refresh",
    });
  });

  it("refreshes a token with time left when a refresh is forced, and stores it", async () => {
    await seedConnection({ expiresInMs: 30 * MINUTE });
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "forced-access", expires_in: 3600 }));

    const result = await getGoogleAccessToken(db.client(), ACCOUNT, { forceRefresh: true });

    expect(result).toMatchObject({ ok: true, accessToken: "forced-access", refreshed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await stored("access")).toBe("forced-access");
  });

  it("refreshes a token that is within five minutes of expiry", async () => {
    await seedConnection({ expiresInMs: 4 * MINUTE });
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "fresh-access", expires_in: 3600 }));

    const result = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(result).toMatchObject({ ok: true, accessToken: "fresh-access", refreshed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the old refresh token when Google sends no new one", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "fresh-access", expires_in: 3600 }));

    await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(await stored("refresh")).toBe("stored-refresh");
  });

  it("stores a new refresh token when Google sends one", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock.mockResolvedValue(
      tokenResponse({ access_token: "fresh-access", expires_in: 3600, refresh_token: "rotated-refresh" }),
    );

    await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(await stored("refresh")).toBe("rotated-refresh");
  });

  it("marks the connection needs_action once on invalid_grant and asks for a reconnect", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock.mockResolvedValue(
      tokenResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
    );

    const first = await getGoogleAccessToken(db.client(), ACCOUNT);
    const second = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(first).toEqual({ ok: false, reason: "reconnect_needed" });
    expect(second).toEqual({ ok: false, reason: "reconnect_needed" });
    expect(row().status).toBe("needs_action");
    // Google is asked once; the second call stops at the stored status.
    expect(fetchMock).toHaveBeenCalledOnce();
    const marks = vi.mocked(console.warn).mock.calls.flat().map(String).filter((line) => line.includes("needs to be reconnected"));
    expect(marks).toHaveLength(1);
  });

  it("asks to try again and leaves the connection alone when the token endpoint times out", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    const before = row();
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

    const result = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(result).toEqual({ ok: false, reason: "try_again" });
    expect(row()).toEqual(before);
    expect(await stored("access")).toBe("stored-access");
    expect(await stored("refresh")).toBe("stored-refresh");
  });

  it.each([
    ["a 503", () => tokenResponse({ error: "server_error" }, 503)],
    ["a refusal that is not about the grant", () => tokenResponse({ error: "invalid_client" }, 401)],
  ])("asks to try again on %s without marking the connection", async (_name, respond) => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock.mockResolvedValue(respond());

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "try_again" });
    expect(row().status).toBe("active");
  });

  it("does not let a slower, older refresh overwrite a newer stored token", async () => {
    await seedConnection({ expiresInMs: -MINUTE });

    // The first refresh is held at Google; a second one starts and finishes meanwhile.
    let releaseSlow: (response: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseSlow = resolve; }))
      .mockImplementationOnce(async () => tokenResponse({ access_token: "newer-access", expires_in: 3600 }));

    const slow = getGoogleAccessToken(db.client(), ACCOUNT);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const fast = await getGoogleAccessToken(db.client(), ACCOUNT);
    expect(fast).toMatchObject({ ok: true, accessToken: "newer-access" });
    const afterFast = row();
    expect(afterFast.updated_at).not.toBe("2026-11-01T09:00:00.123456+00:00");

    releaseSlow(tokenResponse({ access_token: "older-access", expires_in: 1800 }));
    const slowResult = await slow;

    // The slower call still gets a working token for its own use...
    expect(slowResult).toMatchObject({ ok: true, accessToken: "older-access", refreshed: true });
    // ...but what is stored is the newer one, with its expiry.
    expect(await stored("access")).toBe("newer-access");
    expect(row().token_expires_at).toBe(afterFast.token_expires_at);
    expect(row().token_expires_at).toBe(fast.ok ? fast.expiresAt : null);
  });

  it("stores exactly one of two refreshes that run at the same moment, with a matching expiry", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock
      .mockImplementationOnce(async () => tokenResponse({ access_token: "access-a", expires_in: 3600 }))
      .mockImplementationOnce(async () => tokenResponse({ access_token: "access-b", expires_in: 1800 }));

    const [a, b] = await Promise.all([getGoogleAccessToken(db.client(), ACCOUNT), getGoogleAccessToken(db.client(), ACCOUNT)]);

    expect(a.ok && b.ok).toBe(true);
    const winner = [a, b].find((result) => result.ok && result.expiresAt === row().token_expires_at);
    expect(winner).toBeDefined();
    expect(await stored("access")).toBe(winner && winner.ok ? winner.accessToken : null);
  });

  it("does not undo a reconnect that landed while Google was refusing the old refresh token", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock.mockImplementationOnce(async () => {
      // The owner reconnects while the refresh is in flight.
      await db.client().from("social_connections").update({ status: "active" }).eq("id", CONNECTION);
      return tokenResponse({ error: "invalid_grant" }, 400);
    });

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "reconnect_needed" });
    expect(row().status).toBe("active");
  });

  it("asks for a reconnect when no refresh token is stored", async () => {
    await seedConnection({ expiresInMs: -MINUTE, refresh: null });

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "reconnect_needed" });
    expect(row().status).toBe("needs_action");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a reconnect, without calling Google, when the connection already needs action", async () => {
    await seedConnection({ expiresInMs: 30 * MINUTE, status: "needs_action" });

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "reconnect_needed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a brand without a Google connection, and never reads another brand's", async () => {
    await seedConnection({ expiresInMs: 30 * MINUTE });

    expect(await getGoogleAccessToken(db.client(), OTHER_ACCOUNT)).toEqual({ ok: false, reason: "not_connected" });
    const lookups = db.queries.filter((query) => query.table === "social_connections");
    expect(lookups.every((query) => query.eq.some(([column, value]) => column === "account_id" && value === OTHER_ACCOUNT))).toBe(true);
  });

  it("asks to try again, without marking the connection, when the OAuth client is not configured", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = "";

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "try_again" });
    expect(row().status).toBe("active");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks to try again when the database cannot be read", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    db.fail("social_connections", "select", 1);

    expect(await getGoogleAccessToken(db.client(), ACCOUNT)).toEqual({ ok: false, reason: "try_again" });
  });

  it("still hands back the new token when it cannot be stored, and refreshes again next time", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    const expiryBefore = row().token_expires_at;
    fetchMock.mockImplementation(async () => tokenResponse({ access_token: "fresh-access", expires_in: 3600 }));
    db.fail("token_vault", "upsert", 1);

    const result = await getGoogleAccessToken(db.client(), ACCOUNT);

    expect(result).toMatchObject({ ok: true, accessToken: "fresh-access" });
    expect(await stored("access")).toBe("stored-access");
    // The stored expiry did not move, so the stale stored token is never trusted.
    expect(row().token_expires_at).toBe(expiryBefore);

    await getGoogleAccessToken(db.client(), ACCOUNT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await stored("access")).toBe("fresh-access");
  });

  it("never writes a token, the refresh token or the client secret to the log", async () => {
    await seedConnection({ expiresInMs: -MINUTE });
    fetchMock
      .mockImplementationOnce(async () => tokenResponse({ access_token: "fresh-access", expires_in: 3600 }))
      .mockImplementationOnce(async () => tokenResponse({ error: "invalid_grant", error_description: "revoked stored-refresh" }, 400));

    await getGoogleAccessToken(db.client(), ACCOUNT);
    await db.client().from("social_connections").update({ token_expires_at: new Date(Date.now() - MINUTE).toISOString() }).eq("id", CONNECTION);
    await getGoogleAccessToken(db.client(), ACCOUNT);

    const output = logged();
    for (const secret of ["fresh-access", "stored-access", "stored-refresh", "client-secret"]) {
      expect(output).not.toContain(secret);
    }
  });
});
