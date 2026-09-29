import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimPageChoice,
  createPageChoice,
  PAGE_CHOICE_PATH,
  readPageChoice,
  toPageChoiceOption,
  type PageChoicePayload,
} from "@/lib/connections/page-choice";
import { buildPageChoiceView } from "@/lib/connections/page-choice-view";
import { InMemoryConnectionsDb } from "../../../tests/helpers/in-memory-connections-db";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
// Supabase auth user ids are uuids, and oauth_states.created_by is a uuid column.
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_TOKEN = "EAAB-long-lived-user-token-secret";

function input(overrides: Partial<Omit<PageChoicePayload, "version">> = {}): Omit<PageChoicePayload, "version"> {
  return {
    userId: USER,
    accountId: ACCOUNT,
    provider: "facebook",
    changePage: false,
    userAccessToken: USER_TOKEN,
    expiresAt: "2026-11-28T10:00:00.000Z",
    metaUserId: "meta-user-1",
    currentPageId: null,
    instagramPageId: null,
    pages: [
      toPageChoiceOption({ id: "101", name: "The Crown", accessToken: "page-token-101", tasks: null, instagram: { id: "ig-1", username: "thecrown", name: null } }),
      toPageChoiceOption({ id: "202", name: "Crown Events", accessToken: "page-token-202", tasks: ["ANALYZE"], instagram: null }),
    ],
    ...overrides,
  };
}

describe("Page choice hand-off", () => {
  let db: InMemoryConnectionsDb;

  beforeEach(() => {
    vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
    db = new InMemoryConnectionsDb();
    db.seed("accounts", [{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const read = (token: string, overrides: Partial<{ userId: string; ownedAccountIds: string[] }> = {}) =>
    readPageChoice(db.client(), { token, userId: USER, ownedAccountIds: [ACCOUNT], ...overrides });

  it("stores one encrypted row, bound to the person who logged in, that expires in 10 minutes", async () => {
    const before = Date.now();
    const token = await createPageChoice(db.client(), input());

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = db.rows("oauth_states");
    expect(row).toMatchObject({
      state: token,
      provider: "facebook",
      account_id: ACCOUNT,
      redirect_to: PAGE_CHOICE_PATH,
      used_at: null,
      // Safe since #163: no row level security policy reads created_by any more.
      created_by: USER,
    });
    expect(db.rejected).toEqual([]);
    const expiresIn = Date.parse(String(row.expires_at)) - before;
    expect(expiresIn).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
    // Tokens and Page names are ciphertext at rest.
    expect(String(row.auth_code)).not.toContain(USER_TOKEN);
    expect(String(row.auth_code)).not.toContain("The Crown");
    expect(JSON.parse(String(row.auth_code))).toEqual(
      expect.objectContaining({ ciphertext: expect.any(String), iv: expect.any(String), tag: expect.any(String), keyVersion: 1 }),
    );
  });

  it("reads the choice back for the same owner", async () => {
    const token = await createPageChoice(db.client(), input());

    const result = await read(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.payload).toMatchObject({ userId: USER, accountId: ACCOUNT, userAccessToken: USER_TOKEN });
    expect(result.choice.payload.pages.map((page) => page.id)).toEqual(["101", "202"]);
  });

  it("refuses another signed-in user, even an owner of the same brand", async () => {
    const token = await createPageChoice(db.client(), input());

    expect(await read(token, { userId: OTHER_USER })).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("refuses a row without created_by (made before it was recorded), even for the person in the payload", async () => {
    const token = await createPageChoice(db.client(), input({ changePage: true }));
    db.tables.oauth_states[0].created_by = null;

    expect(await read(token)).toMatchObject({ ok: false, reason: "forbidden" });

    // Once expired it still drops the token, but does not reveal the flow's mode.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await read(token)).toEqual({ ok: false, reason: "expired", provider: "facebook", changePage: null });
    expect(db.rows("oauth_states")[0].auth_code).toBeNull();
  });

  it("needs both bindings: the row's created_by and the payload's user", async () => {
    const token = await createPageChoice(db.client(), input());
    db.tables.oauth_states[0].created_by = OTHER_USER;

    expect(await read(token)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await read(token, { userId: OTHER_USER })).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("does not look at rows in brands the user does not own", async () => {
    const token = await createPageChoice(db.client(), input());

    expect(await read(token, { ownedAccountIds: [OTHER_ACCOUNT] })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await read(token, { ownedAccountIds: [] })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses a malformed reference without querying", async () => {
    const result = await read("not-a-token");

    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(db.queries).toHaveLength(0);
  });

  it("says expired after 10 minutes, keeping the platform and mode for Start again", async () => {
    const token = await createPageChoice(db.client(), input({ changePage: true }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);

    expect(await read(token)).toEqual({ ok: false, reason: "expired", provider: "facebook", changePage: true });
  });

  it("drops the encrypted Meta token as soon as an expired choice is seen", async () => {
    const token = await createPageChoice(db.client(), input({ changePage: true }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    await read(token);

    const [row] = db.rows("oauth_states");
    expect(row.auth_code).toBeNull();
    // Still unused, so it keeps saying expired, but the mode is no longer known.
    expect(row.used_at).toBeNull();
    expect(await read(token)).toEqual({ ok: false, reason: "expired", provider: "facebook", changePage: null });
  });

  it("drops another owner's expired payload too, without revealing its mode", async () => {
    const token = await createPageChoice(db.client(), input({ changePage: true }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    expect(await read(token, { userId: OTHER_USER })).toEqual({
      ok: false,
      reason: "expired",
      provider: "facebook",
      changePage: null,
    });
    expect(db.rows("oauth_states")[0].auth_code).toBeNull();
  });

  it("still says expired, and logs it, when the payload cannot be dropped", async () => {
    const token = await createPageChoice(db.client(), input());
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    db.fail("oauth_states", "update", 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await read(token)).toMatchObject({ ok: false, reason: "expired" });
    expect(db.rows("oauth_states")[0].auth_code).not.toBeNull();
    expect(warn.mock.calls.flat().map(String).join("\n")).toContain("could not clear an expired Page choice");
    expect(warn.mock.calls.flat().map(String).join("\n")).not.toContain(USER_TOKEN);
  });

  it("is single use: the first claim wins and clears the encrypted payload", async () => {
    const token = await createPageChoice(db.client(), input());
    const first = await read(token);
    if (!first.ok) throw new Error("expected a readable choice");

    expect(await claimPageChoice(db.client(), first.choice)).toBe(true);
    expect(await claimPageChoice(db.client(), first.choice)).toBe(false);

    const [row] = db.rows("oauth_states");
    expect(row.used_at).not.toBeNull();
    expect(row.auth_code).toBeNull();
    expect(await read(token)).toMatchObject({ ok: false, reason: "used", provider: "facebook" });
  });

  it("claims only a row started by the person readPageChoice checked", async () => {
    const token = await createPageChoice(db.client(), input());
    const result = await read(token);
    if (!result.ok) throw new Error("expected a readable choice");
    db.tables.oauth_states[0].created_by = OTHER_USER;

    expect(await claimPageChoice(db.client(), result.choice)).toBe(false);
    expect(db.rows("oauth_states")[0].used_at).toBeNull();
    expect(db.rows("oauth_states")[0].auth_code).not.toBeNull();
  });

  it("will not claim an expired choice", async () => {
    const token = await createPageChoice(db.client(), input());
    const result = await read(token);
    if (!result.ok) throw new Error("expected a readable choice");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    expect(await claimPageChoice(db.client(), result.choice)).toBe(false);
  });

  it("throws when the claim itself fails", async () => {
    const token = await createPageChoice(db.client(), input());
    const result = await read(token);
    if (!result.ok) throw new Error("expected a readable choice");
    db.fail("oauth_states", "update", 1);

    await expect(claimPageChoice(db.client(), result.choice)).rejects.toThrow(/Could not claim/);
  });

  it("refuses a row whose payload was tampered with, or sealed with another key", async () => {
    const token = await createPageChoice(db.client(), input());
    const row = db.tables.oauth_states[0];
    const sealed = JSON.parse(String(row.auth_code));
    row.auth_code = JSON.stringify({ ...sealed, ciphertext: Buffer.from("tampered").toString("base64") });
    expect(await read(token)).toMatchObject({ ok: false, reason: "invalid" });

    row.auth_code = JSON.stringify(sealed);
    vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
    expect(await read(token)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses an OAuth state row, which has no payload", async () => {
    const token = randomBytes(32).toString("base64url");
    db.seed("oauth_states", [{ state: token, provider: "facebook", account_id: ACCOUNT, redirect_to: PAGE_CHOICE_PATH }]);

    expect(await read(token)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reports a failed lookup rather than a missing choice", async () => {
    const token = await createPageChoice(db.client(), input());
    db.fail("oauth_states", "select", 1);

    expect(await read(token)).toMatchObject({ ok: false, reason: "lookup_failed" });
  });

  it("fails loudly, storing nothing, when the vault key is missing or the insert fails", async () => {
    vi.stubEnv("TOKEN_VAULT_KEY", "");
    await expect(createPageChoice(db.client(), input())).rejects.toThrow(/TOKEN_VAULT_KEY/);

    vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
    db.fail("oauth_states", "insert", 1);
    await expect(createPageChoice(db.client(), input())).rejects.toThrow(/Could not store/);
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("builds a view with names and flags only, never the token", async () => {
    const token = await createPageChoice(db.client(), input({ instagramPageId: "303", currentPageId: "101" }));
    const result = await read(token);
    if (!result.ok) throw new Error("expected a readable choice");

    const view = buildPageChoiceView({ token, brandName: "The Crown", payload: result.choice.payload });

    expect(JSON.stringify(view)).not.toContain(USER_TOKEN);
    expect(JSON.stringify(view)).not.toContain("page-token");
    expect(view.options).toEqual([
      expect.objectContaining({ id: "101", selectable: true, connectedNow: true, instagramEffect: "Instagram moves to @thecrown." }),
      expect.objectContaining({ id: "202", selectable: false, note: "Your Facebook profile cannot post to this Page.", instagramEffect: null }),
    ]);
    expect(view.instagramConnected).toBe(true);
  });
});

describe("buildPageChoiceView for Instagram", () => {
  it("disables Pages without an Instagram account and explains why", () => {
    const view = buildPageChoiceView({
      token: "t".repeat(43),
      brandName: null,
      payload: {
        provider: "instagram",
        changePage: false,
        currentPageId: null,
        instagramPageId: null,
        pages: [
          { id: "1", name: null, instagramUsername: null, hasInstagram: false, canPostToFacebook: true, canPostToInstagram: false },
          { id: "2", name: "Bar", instagramUsername: "bar", hasInstagram: true, canPostToFacebook: true, canPostToInstagram: false },
          { id: "3", name: "Pub", instagramUsername: "pub", hasInstagram: true, canPostToFacebook: false, canPostToInstagram: true },
        ],
      },
    });

    expect(view.options.map((option) => [option.name, option.selectable, option.note])).toEqual([
      ["Unnamed Page", false, "No Instagram professional account is linked to this Page."],
      ["Bar", false, "Your Facebook profile cannot post to this Instagram account."],
      ["Pub", true, null],
    ]);
    expect(view.instagramConnected).toBe(false);
  });

  it("warns that a Facebook choice without Instagram disconnects a connected Instagram", () => {
    const view = buildPageChoiceView({
      token: "t".repeat(43),
      brandName: "Pub",
      payload: {
        provider: "facebook",
        changePage: true,
        currentPageId: "1",
        instagramPageId: "1",
        pages: [
          { id: "1", name: "Pub", instagramUsername: "pub", hasInstagram: true, canPostToFacebook: true, canPostToInstagram: true },
          { id: "2", name: "Events", instagramUsername: null, hasInstagram: false, canPostToFacebook: true, canPostToInstagram: false },
        ],
      },
    });

    expect(view.options[0].instagramEffect).toBeNull();
    expect(view.options[1].instagramEffect).toBe(
      "Instagram will be disconnected, as this Page has no account CheersAI can post to.",
    );
  });
});
