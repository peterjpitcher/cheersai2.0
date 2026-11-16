import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryConnectionsDb } from "../../../../tests/helpers/in-memory-connections-db";

// ---------------------------------------------------------------------------
// Mocks. Google is never called: fetch is stubbed. The OAuth helpers, the
// listing, the pending choice, the save and the token vault encryption are real.
// ---------------------------------------------------------------------------

const { serverEnv, mockFrom, mockRequireAuthContext } = vi.hoisted(() => ({
  serverEnv: { GOOGLE_MY_BUSINESS_CLIENT_ID: "", GOOGLE_MY_BUSINESS_CLIENT_SECRET: "" } as Record<string, string>,
  mockFrom: vi.fn(),
  mockRequireAuthContext: vi.fn(),
}));

vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" }, server: serverEnv },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { chooseGoogleLocation, completeGoogleConnect, initiateGoogleConnect } from "./google-actions";
import { readGoogleLocationChoice } from "@/lib/connections/google-choice";
import { GOOGLE_LOCATION_CHOICE_PATH } from "@/lib/connections/google-messages";
import { readGoogleVaultToken, writeGoogleVaultToken } from "@/lib/connections/google-persist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCESS_TOKEN = "ya29.google-access-never-shown";
const REFRESH_TOKEN = "1//google-refresh-never-shown";
const AUTH_CODE = "4/0-auth-code-never-logged";
const CLIENT_SECRET = "client-secret-never-logged";
const SCOPE = "https://www.googleapis.com/auth/business.manage";
const ANCHOR = "accounts/111/locations/999";

const MESSAGES = {
  notAvailable: "Google posting is not switched on for this brand.",
  notSetUp: "Google posting is not set up.",
  notApproved: "Google has not approved API access for this app yet, so your profile could not be listed. Nothing was saved.",
  expiredLink: "This connection link has expired or was already used. Please click Connect again.",
};

type Role = "owner" | "member";

function features(googlePosts: boolean) {
  return { paidAds: false, tournaments: false, managementImport: false, googlePosts };
}

function authContext({
  googlePosts = true,
  role = "owner" as Role,
  userId = USER_ID,
  accountId = ACCOUNT,
  brands,
}: {
  googlePosts?: boolean;
  role?: Role;
  userId?: string;
  accountId?: string;
  brands?: Array<{ accountId: string; role: Role; googlePosts: boolean }>;
} = {}) {
  const list = brands ?? [{ accountId, role, googlePosts }];
  return {
    accountId,
    activeAccountId: accountId,
    user: { id: userId },
    supabase: { from: mockFrom },
    brands: list.map((brand) => ({
      accountId: brand.accountId,
      role: brand.role,
      name: "The Anchor",
      timezone: "Europe/London",
      features: features(brand.googlePosts),
    })),
    isSuperAdmin: false,
    role,
    features: features(list.find((brand) => brand.accountId === accountId)?.googlePosts ?? false),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function googleError(status: number, googleStatus: string, message: string, reason?: string): Response {
  return json(
    {
      error: {
        code: status,
        message,
        status: googleStatus,
        details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [],
      },
    },
    status,
  );
}

const TOKEN_OK = () =>
  json({ access_token: ACCESS_TOKEN, expires_in: 3599, refresh_token: REFRESH_TOKEN, scope: SCOPE, token_type: "Bearer" });
const ACCOUNTS_OK = () => json({ accounts: [{ name: "accounts/111", accountName: "Peter Pitcher", type: "PERSONAL" }] });
const LOCATIONS_OK = () =>
  json({
    locations: [
      {
        name: "locations/999",
        title: "The Anchor",
        storefrontAddress: { addressLines: ["Horton Road"], locality: "Stanwell Moor", postalCode: "TW19 6AQ" },
        metadata: { placeId: "ChIJ-anchor" },
      },
    ],
  });

interface GoogleReplies {
  token?: () => Response | Promise<Response>;
  accounts?: () => Response | Promise<Response>;
  locations?: (url: URL) => Response | Promise<Response>;
}

const fetchMock = vi.fn();

/** Routes the three Google endpoints; anything else fails the test. */
function google({ token = TOKEN_OK, accounts = ACCOUNTS_OK, locations = LOCATIONS_OK }: GoogleReplies = {}) {
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "oauth2.googleapis.com") return token();
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com") return accounts();
    if (url.hostname === "mybusinessbusinessinformation.googleapis.com") return locations(url);
    throw new Error(`unexpected request to ${url.hostname}`);
  });
}

let db: InMemoryConnectionsDb;

function seedState(overrides: Record<string, unknown> = {}) {
  db.seed("oauth_states", [
    {
      state: "valid-state",
      provider: "gbp",
      account_id: ACCOUNT,
      created_by: USER_ID,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      ...overrides,
    },
  ]);
}

const stateRow = (state: string) => db.rows("oauth_states").find((entry) => entry.state === state);
const choiceRows = () => db.rows("oauth_states").filter((entry) => entry.redirect_to === GOOGLE_LOCATION_CHOICE_PATH);
const googleRow = (accountId = ACCOUNT) =>
  db.rows("social_connections").find((entry) => entry.provider === "gbp" && entry.account_id === accountId);

/** Nothing about Google is stored anywhere: no connection, no token, no pending choice. */
function expectNothingSaved() {
  expect(db.rows("social_connections")).toEqual([]);
  expect(db.rows("token_vault")).toEqual([]);
  expect(choiceRows()).toEqual([]);
  expect(db.rows("oauth_states").every((entry) => entry.auth_code === null)).toBe(true);
}

/** Runs the callback to the picker and returns the choice reference. */
async function reachPicker(replies: GoogleReplies = {}): Promise<string> {
  seedState();
  google(replies);
  const result = await completeGoogleConnect(AUTH_CODE, "valid-state");
  expect(result.success).toBe(true);
  return result.locationChoice as string;
}

function logged(): string {
  return [console.error, console.warn, console.log]
    .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
    .map(String)
    .join("\n");
}

function expectNoSecretsLogged() {
  const output = logged();
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, AUTH_CODE, CLIENT_SECRET]) {
    expect(output).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_ID = "client-id.apps.googleusercontent.com";
  serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = CLIENT_SECRET;
  db = new InMemoryConnectionsDb();
  db.seed("accounts", [{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
  mockFrom.mockImplementation((table: string) => db.client().from(table));
  mockRequireAuthContext.mockResolvedValue(authContext());
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    throw new Error("Google must not be called in this test");
  });
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

describe("initiateGoogleConnect", () => {
  it("stores a state bound to the brand and the owner, and returns Google's consent URL", async () => {
    const result = await initiateGoogleConnect();

    expect(result.success).toBe(true);
    const [row] = db.rows("oauth_states");
    expect(row).toMatchObject({ provider: "gbp", account_id: ACCOUNT, created_by: USER_ID, auth_code: null, redirect_to: null });
    const expiresIn = new Date(String(row.expires_at)).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(10 * 60 * 1000);

    const url = new URL(result.redirectUrl as string);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe(row.state);
    expect(url.searchParams.get("scope")).toBe(SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://cheers.orangejelly.co.uk/api/oauth/gbp/callback");
    expect(url.searchParams.get("client_id")).toBe("client-id.apps.googleusercontent.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses, storing nothing, for a brand without the switch", async () => {
    mockRequireAuthContext.mockResolvedValue(authContext({ googlePosts: false }));

    expect(await initiateGoogleConnect()).toEqual({ success: false, error: MESSAGES.notAvailable });
    expect(db.rows("oauth_states")).toEqual([]);
  });

  it.each(["GOOGLE_MY_BUSINESS_CLIENT_ID", "GOOGLE_MY_BUSINESS_CLIENT_SECRET"])(
    "refuses with the plain message when %s is missing",
    async (key) => {
      serverEnv[key] = "";

      expect(await initiateGoogleConnect()).toEqual({ success: false, error: MESSAGES.notSetUp });
      expect(db.rows("oauth_states")).toEqual([]);
    },
  );

  it("refuses members before touching the database", async () => {
    mockRequireAuthContext.mockResolvedValue(authContext({ role: "member" }));
    mockFrom.mockClear();

    await expect(initiateGoogleConnect()).rejects.toThrow("Only an owner of this brand can do that.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns a plain message when the state cannot be stored", async () => {
    db.fail("oauth_states", "insert", 1);

    expect(await initiateGoogleConnect()).toEqual({
      success: false,
      error: "We could not start the connection. Please try again.",
    });
  });
});

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

describe("completeGoogleConnect", () => {
  it("lists the locations and hands off to the picker, connecting nothing", async () => {
    const reference = await reachPicker();

    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Nothing is connected, even though there is exactly one location.
    expect(db.rows("social_connections")).toEqual([]);
    expect(db.rows("token_vault")).toEqual([]);
    expect(stateRow("valid-state")?.used_at).not.toBeNull();

    const [pending] = choiceRows();
    expect(pending).toMatchObject({ provider: "gbp", account_id: ACCOUNT, created_by: USER_ID, used_at: null });
    // The tokens wait encrypted: neither appears in the stored row.
    expect(String(pending.auth_code)).not.toContain(ACCESS_TOKEN);
    expect(String(pending.auth_code)).not.toContain(REFRESH_TOKEN);

    const read = await readGoogleLocationChoice(db.client(), { token: reference, userId: USER_ID, ownedAccountIds: [ACCOUNT] });
    expect(read.ok && read.choice.payload).toMatchObject({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      incomplete: false,
      currentLocationId: null,
      locations: [
        {
          id: ANCHOR,
          title: "The Anchor",
          address: "Horton Road, Stanwell Moor, TW19 6AQ",
          accountName: "Peter Pitcher",
          placeId: "ChIJ-anchor",
        },
      ],
    });
    expectNoSecretsLogged();
  });

  it("sends the code exchange with the registered callback address", async () => {
    await reachPicker();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(init.body as URLSearchParams)).toMatchObject({
      grant_type: "authorization_code",
      code: AUTH_CODE,
      redirect_uri: "https://cheers.orangejelly.co.uk/api/oauth/gbp/callback",
    });
  });

  it("refuses, without calling Google, when the brand's switch is off, and uses the state up", async () => {
    seedState();
    mockRequireAuthContext.mockResolvedValue(authContext({ googlePosts: false }));

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.notAvailable });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateRow("valid-state")?.used_at).not.toBeNull();
    expectNothingSaved();
  });

  it("checks the switch of the brand that started the flow, not the brand selected now", async () => {
    seedState();
    // Started for ACCOUNT (Google off); the owner has since switched to a brand with Google on.
    mockRequireAuthContext.mockResolvedValue(
      authContext({
        accountId: OTHER_ACCOUNT,
        brands: [
          { accountId: ACCOUNT, role: "owner", googlePosts: false },
          { accountId: OTHER_ACCOUNT, role: "owner", googlePosts: true },
        ],
      }),
    );

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.notAvailable });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("lets an owner of the starting brand finish, even after switching to a brand where they are only a member", async () => {
    seedState();
    google();
    // Started for ACCOUNT, which they own; the brand selected now is one they only belong to.
    mockRequireAuthContext.mockResolvedValue(
      authContext({
        accountId: OTHER_ACCOUNT,
        role: "member",
        brands: [
          { accountId: ACCOUNT, role: "owner", googlePosts: true },
          { accountId: OTHER_ACCOUNT, role: "member", googlePosts: false },
        ],
      }),
    );

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(true);
    // The pending choice belongs to the brand that started the flow.
    expect(choiceRows()).toHaveLength(1);
    expect(choiceRows()[0]?.account_id).toBe(ACCOUNT);
  });

  it("refuses a member of the starting brand who owns only the brand selected now", async () => {
    seedState();
    mockRequireAuthContext.mockResolvedValue(
      authContext({
        accountId: OTHER_ACCOUNT,
        role: "owner",
        brands: [
          { accountId: ACCOUNT, role: "member", googlePosts: true },
          { accountId: OTHER_ACCOUNT, role: "owner", googlePosts: true },
        ],
      }),
    );

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("refuses when the OAuth client is not configured", async () => {
    seedState();
    serverEnv.GOOGLE_MY_BUSINESS_CLIENT_SECRET = "";

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.notSetUp });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("saves nothing when Google refuses the account list at the quota wall (429)", async () => {
    seedState();
    google({
      accounts: () =>
        googleError(
          429,
          "RESOURCE_EXHAUSTED",
          "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' for consumer 'project_number:344798984846'.",
          "RATE_LIMIT_EXCEEDED",
        ),
    });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result).toEqual({ success: false, error: MESSAGES.notApproved });
    expectNothingSaved();
    // The owner never sees Google's own wording; the log keeps a short summary.
    expect(result.error).not.toContain("Quota exceeded");
    expect(logged()).toContain("RESOURCE_EXHAUSTED");
    expect(logged()).not.toContain("Quota exceeded");
    expectNoSecretsLogged();
  });

  it("saves nothing when the location list is refused at the quota wall (429)", async () => {
    seedState();
    google({ locations: () => googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded", "RATE_LIMIT_EXCEEDED") });

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.notApproved });
    expectNothingSaved();
  });

  it("saves nothing on a 403 about a switched-off API, with the not-approved message", async () => {
    seedState();
    google({
      accounts: () =>
        googleError(403, "PERMISSION_DENIED", "API has not been used in project 344798984846 before or it is disabled.", "SERVICE_DISABLED"),
    });

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.notApproved });
    expectNothingSaved();
  });

  it("saves nothing on any other 403, with the permission message", async () => {
    seedState();
    google({ accounts: () => googleError(403, "PERMISSION_DENIED", "The caller does not have permission") });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Google did not give CheersAI permission/);
    expect(result.error).not.toContain("caller");
    expectNothingSaved();
  });

  it("saves nothing when Google is unavailable, with a try-again message", async () => {
    seedState();
    google({ accounts: () => googleError(503, "UNAVAILABLE", "The service is currently unavailable.") });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.error).toMatch(/^Google is not responding at the moment/);
    expectNothingSaved();
  });

  it("saves nothing when the code exchange fails", async () => {
    seedState();
    google({ token: () => json({ error: "invalid_grant", error_description: "Malformed auth code." }, 400) });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result).toEqual({
      success: false,
      error: "Google did not finish the sign-in. Nothing was saved. Please click Connect again.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expectNothingSaved();
    expectNoSecretsLogged();
  });

  it("treats a sign-in without a refresh token as failed", async () => {
    seedState();
    google({ token: () => json({ access_token: ACCESS_TOKEN, expires_in: 3599, scope: SCOPE }) });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Google did not give CheersAI ongoing access/);
    // The accounts and locations are never asked for.
    expect(fetchMock).toHaveBeenCalledOnce();
    expectNothingSaved();
  });

  it("treats a sign-in where the business permission was not granted as permission denied", async () => {
    seedState();
    google({ token: () => json({ access_token: ACCESS_TOKEN, expires_in: 3599, refresh_token: REFRESH_TOKEN, scope: "openid" }) });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.error).toMatch(/^Google did not give CheersAI permission/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expectNothingSaved();
  });

  it("says so plainly when the login manages no accounts", async () => {
    seedState();
    google({ accounts: () => json({}) });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.error).toMatch(/^This Google login does not manage any business profiles/);
    expectNothingSaved();
  });

  it("says so plainly when the login manages no locations", async () => {
    seedState();
    google({ locations: () => json({}) });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.error).toMatch(/^This Google login has no business locations/);
    expectNothingSaved();
  });

  it("shows what loaded and flags the list as incomplete when one account cannot be listed", async () => {
    seedState();
    google({
      accounts: () => json({ accounts: [{ name: "accounts/111", accountName: "One" }, { name: "accounts/222", accountName: "Two" }] }),
      locations: (url) => (url.pathname.includes("accounts/222") ? googleError(500, "INTERNAL", "Internal error") : LOCATIONS_OK()),
    });

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(true);
    const read = await readGoogleLocationChoice(db.client(), {
      token: result.locationChoice as string,
      userId: USER_ID,
      ownedAccountIds: [ACCOUNT],
    });
    expect(read.ok && read.choice.payload.incomplete).toBe(true);
    expect(read.ok && read.choice.payload.locations.map((entry) => entry.id)).toEqual([ANCHOR]);
  });

  it("refuses a repeated callback: the state works once", async () => {
    await reachPicker();
    fetchMock.mockClear();

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.expiredLink });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(choiceRows()).toHaveLength(1);
  });

  it("refuses an expired state, an unknown state and a Facebook state", async () => {
    seedState({ state: "expired", expires_at: new Date(Date.now() - 1000).toISOString() });
    seedState({ state: "facebook-state", provider: "facebook" });

    for (const state of ["expired", "unknown", "facebook-state"]) {
      expect(await completeGoogleConnect(AUTH_CODE, state)).toEqual({ success: false, error: MESSAGES.expiredLink });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("refuses a state someone else started, without using it up", async () => {
    seedState({ created_by: OTHER_USER_ID });

    expect(await completeGoogleConnect(AUTH_CODE, "valid-state")).toEqual({ success: false, error: MESSAGES.expiredLink });
    expect(stateRow("valid-state")?.used_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the owner's access to the brand was removed during the sign-in", async () => {
    seedState();
    mockRequireAuthContext.mockResolvedValue(
      authContext({ accountId: OTHER_ACCOUNT, brands: [{ accountId: OTHER_ACCOUNT, role: "owner", googlePosts: true }] }),
    );

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result).toEqual({ success: false, error: "You no longer have owner access to the brand that started this connection." });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it("refuses a pending location choice used as a login state", async () => {
    const reference = await reachPicker();
    fetchMock.mockClear();

    expect(await completeGoogleConnect(AUTH_CODE, reference)).toEqual({ success: false, error: MESSAGES.expiredLink });
    expect(fetchMock).not.toHaveBeenCalled();
    // The pending choice is untouched.
    expect(choiceRows()[0].used_at).toBeNull();
  });

  it("sends a signed-out visitor to sign in", async () => {
    mockRequireAuthContext.mockImplementation(async () => redirect("/auth/login"));

    await expect(completeGoogleConnect(AUTH_CODE, "valid-state")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("saves nothing when the pending choice cannot be stored", async () => {
    seedState();
    google();
    db.fail("oauth_states", "insert", 1);

    const result = await completeGoogleConnect(AUTH_CODE, "valid-state");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^We could not save your list of locations/);
    expectNothingSaved();
  });
});

// ---------------------------------------------------------------------------
// Choice
// ---------------------------------------------------------------------------

describe("chooseGoogleLocation", () => {
  it("stores the location in the one format, the metadata keys and both tokens", async () => {
    const reference = await reachPicker();

    const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    expect(result).toEqual({ success: true });
    const row = googleRow();
    expect(row).toMatchObject({
      account_id: ACCOUNT,
      provider: "gbp",
      status: "active",
      platform_account_id: ANCHOR,
      platform_account_name: "The Anchor",
      scopes: [SCOPE],
      metadata: { localPostParent: ANCHOR, locationTitle: "The Anchor", placeId: "ChIJ-anchor" },
      access_token: null,
      refresh_token: null,
    });
    expect(Object.keys(row?.metadata as object).sort()).toEqual(["connectedAt", "localPostParent", "locationTitle", "placeId"]);
    // When this save connected it: Google versions are made automatically only for posts created after (D8).
    expect(Date.now() - Date.parse(String((row?.metadata as { connectedAt?: string }).connectedAt))).toBeLessThan(60 * 1000);
    expect(new Date(String(row?.token_expires_at)).getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);

    const vault = db.rows("token_vault");
    expect(vault.map((entry) => entry.token_type).sort()).toEqual(["access", "refresh"]);
    expect(vault.every((entry) => entry.social_connection_id === row?.id)).toBe(true);
    // Encrypted at rest, and readable back.
    expect(JSON.stringify(vault)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(vault)).not.toContain(REFRESH_TOKEN);
    expect(await readGoogleVaultToken(db.client(), String(row?.id), "access")).toBe(ACCESS_TOKEN);
    expect(await readGoogleVaultToken(db.client(), String(row?.id), "refresh")).toBe(REFRESH_TOKEN);

    // The pending choice is used up and its tokens are gone.
    expect(choiceRows()[0]).toMatchObject({ auth_code: null });
    expect(choiceRows()[0].used_at).not.toBeNull();
    expectNoSecretsLogged();
  });

  it("refuses a location that was not in the list shown (forged), saving nothing", async () => {
    const reference = await reachPicker();

    const result = await chooseGoogleLocation({ choice: reference, locationId: "accounts/111/locations/31337" });

    expect(result).toEqual({
      success: false,
      error: "That location was not in your list. Start again from the Connections screen.",
    });
    expect(db.rows("social_connections")).toEqual([]);
    expect(db.rows("token_vault")).toEqual([]);
  });

  it.each(["locations/999", "999", "accounts/111/locations/999/localPosts/1", ""])(
    "refuses a location id in any other format (%s)",
    async (locationId) => {
      const reference = await reachPicker();

      const result = await chooseGoogleLocation({ choice: reference, locationId });

      expect(result.success).toBe(false);
      expect(db.rows("social_connections")).toEqual([]);
    },
  );

  it("refuses, and discards the stored tokens, when the brand's switch was turned off meanwhile", async () => {
    const reference = await reachPicker();
    mockRequireAuthContext.mockResolvedValue(authContext({ googlePosts: false }));

    const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    expect(result).toEqual({ success: false, error: MESSAGES.notAvailable });
    expect(db.rows("social_connections")).toEqual([]);
    expect(db.rows("token_vault")).toEqual([]);
    expect(choiceRows()[0]).toMatchObject({ auth_code: null });
  });

  it("refuses an expired choice and drops its tokens", async () => {
    const reference = await reachPicker();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });
    vi.useRealTimers();

    expect(result).toEqual({
      success: false,
      error: "This choice has expired and nothing was saved. Start again from the Connections screen.",
    });
    expect(db.rows("social_connections")).toEqual([]);
    expect(choiceRows()[0]).toMatchObject({ auth_code: null });
  });

  it("works once: a second submit is refused and changes nothing", async () => {
    const reference = await reachPicker();
    await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });
    const before = googleRow();

    const again = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    expect(again.success).toBe(false);
    expect(again.error).toMatch(/^This choice has already been used/);
    expect(googleRow()).toEqual(before);
  });

  it("refuses someone else's choice, and a member who no longer owns the brand", async () => {
    const reference = await reachPicker();

    mockRequireAuthContext.mockResolvedValue(authContext({ userId: OTHER_USER_ID }));
    expect((await chooseGoogleLocation({ choice: reference, locationId: ANCHOR })).success).toBe(false);

    mockRequireAuthContext.mockResolvedValue(authContext({ role: "member" }));
    expect((await chooseGoogleLocation({ choice: reference, locationId: ANCHOR })).success).toBe(false);

    expect(db.rows("social_connections")).toEqual([]);
    // Neither attempt used the choice up.
    expect(choiceRows()[0].used_at).toBeNull();
  });

  it("refuses a Facebook Page choice reference", async () => {
    db.seed("oauth_states", [
      {
        state: "P".repeat(43),
        provider: "facebook",
        account_id: ACCOUNT,
        created_by: USER_ID,
        redirect_to: "/connections/choose-page",
        auth_code: '{"ciphertext":"c","iv":"i","tag":"t","keyVersion":1}',
      },
    ]);

    const result = await chooseGoogleLocation({ choice: "P".repeat(43), locationId: ANCHOR });

    expect(result.success).toBe(false);
    expect(db.rows("social_connections")).toEqual([]);
  });

  it("removes the half-made connection when the tokens cannot be stored", async () => {
    const reference = await reachPicker();
    db.fail("token_vault", "upsert", 1, { skip: 1 });

    const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^We could not save this connection securely/);
    expect(db.rows("social_connections")).toEqual([]);
    expect(db.rows("token_vault")).toEqual([]);
  });

  it("leaves the previous connection and its tokens untouched when a reconnect cannot be saved", async () => {
    // Connected to another location already.
    const previous = "44444444-4444-4444-8444-444444444444";
    db.seed("social_connections", [
      {
        id: previous,
        account_id: ACCOUNT,
        provider: "gbp",
        status: "active",
        platform_account_id: "accounts/111/locations/555",
        platform_account_name: "Old location",
        metadata: { localPostParent: "accounts/111/locations/555", locationTitle: "Old location", placeId: "old-place" },
        token_expires_at: "2026-11-16T12:00:00.000Z",
      },
    ]);
    await writeGoogleVaultToken(db.client(), previous, "access", "old-access");
    await writeGoogleVaultToken(db.client(), previous, "refresh", "old-refresh");
    const before = googleRow();

    for (const breakIt of [
      () => db.fail("token_vault", "upsert", 1, { skip: 1 }),
      () => db.fail("social_connections", "update", 1),
    ]) {
      const reference = await reachPicker();
      breakIt();

      const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

      expect(result.success).toBe(false);
      expect(googleRow()).toMatchObject({
        id: previous,
        status: "active",
        platform_account_id: "accounts/111/locations/555",
        metadata: before?.metadata,
        token_expires_at: before?.token_expires_at,
      });
      expect(await readGoogleVaultToken(db.client(), previous, "access")).toBe("old-access");
      expect(await readGoogleVaultToken(db.client(), previous, "refresh")).toBe("old-refresh");
      db.tables.oauth_states = [];
    }
  });

  it("puts the connection out of use when another save replaced the tokens at the same time", async () => {
    const previous = "44444444-4444-4444-8444-444444444444";
    db.seed("social_connections", [
      {
        id: previous,
        account_id: ACCOUNT,
        provider: "gbp",
        status: "active",
        platform_account_id: "accounts/111/locations/555",
        metadata: { localPostParent: "accounts/111/locations/555", locationTitle: "Old location", placeId: "old-place" },
      },
    ]);
    await writeGoogleVaultToken(db.client(), previous, "access", "old-access");
    await writeGoogleVaultToken(db.client(), previous, "refresh", "old-refresh");
    const reference = await reachPicker();

    // A second save for the same brand lands its tokens just before this one updates the row.
    let connectionCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "social_connections") {
        connectionCalls += 1;
        if (connectionCalls === 2) {
          void writeGoogleVaultToken(db.client(), previous, "access", "other-save-access");
          void writeGoogleVaultToken(db.client(), previous, "refresh", "other-save-refresh");
        }
      }
      return db.client().from(table);
    });

    const result = await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/another window/);
    // Not left looking healthy with someone else's credentials beside this location.
    expect(googleRow()).toMatchObject({ id: previous, status: "needs_action" });
  });

  it("moves an existing connection to the newly chosen location, on the same row", async () => {
    const previous = "44444444-4444-4444-8444-444444444444";
    db.seed("social_connections", [
      {
        id: previous,
        account_id: ACCOUNT,
        provider: "gbp",
        status: "needs_action",
        platform_account_id: "accounts/111/locations/555",
        metadata: { localPostParent: "accounts/111/locations/555", locationTitle: "Old location", placeId: "old-place" },
      },
    ]);
    const reference = await reachPicker();

    expect(await chooseGoogleLocation({ choice: reference, locationId: ANCHOR })).toEqual({ success: true });

    expect(db.rows("social_connections")).toHaveLength(1);
    expect(googleRow()).toMatchObject({
      id: previous,
      status: "active",
      platform_account_id: ANCHOR,
      metadata: { localPostParent: ANCHOR, locationTitle: "The Anchor", placeId: "ChIJ-anchor" },
    });
    // A reconnect restarts the clock for automatic Google versions (D8).
    expect((googleRow()?.metadata as { connectedAt?: string }).connectedAt).toEqual(expect.any(String));
    expect(await readGoogleVaultToken(db.client(), previous, "refresh")).toBe(REFRESH_TOKEN);
  });

  it("scopes every connection query to the brand that started the flow", async () => {
    const reference = await reachPicker();
    db.queries.length = 0;

    await chooseGoogleLocation({ choice: reference, locationId: ANCHOR });

    const unscoped = db.queries.filter(
      (query) =>
        query.table === "social_connections" && !query.eq.some(([column, value]) => column === "account_id" && value === ACCOUNT)
          && query.op !== "insert",
    );
    expect(unscoped).toEqual([]);
    expect(googleRow(OTHER_ACCOUNT)).toBeUndefined();
  });
});
