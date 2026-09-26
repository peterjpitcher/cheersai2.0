import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store for disconnectAdAccount. It runs the real
// deleteMetaAdAccountTokens and enforces the live NOT NULL rules on
// meta_ad_accounts (checked 2026-09-26; access_token is NOT NULL default ''),
// so a write the database would reject fails here too.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Op = "select" | "update" | "delete";

const BRAND = "brand-1";
const OTHER = "brand-2";

const NOT_NULL: Record<string, string[]> = {
  meta_ad_accounts: [
    "id",
    "account_id",
    "meta_account_id",
    "currency",
    "timezone",
    "access_token",
    "setup_complete",
    "created_at",
    "conversion_event_name",
    "conversion_optimisation_enabled",
  ],
};

let db: Record<string, Row[]>;
let injectFailure: (table: string, op: Op, patch: Row) => string | null;
let fromCalls: string[];

const requireAuthContextMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/meta/graph", () => ({
  getMetaGraphApiBase: () => "https://graph.facebook.com/v24.0",
}));

vi.mock("@/lib/connections/oauth", () => ({
  buildFacebookAdsOAuthUrl: () => "https://facebook.test/oauth",
}));

/** Supports the `col.is.null` and `col.gte.value` terms used by the action. */
function orPredicate(filter: string): (r: Row) => boolean {
  const terms = filter.split(",").map((term) => {
    const [column, op, ...rest] = term.split(".");
    const value = rest.join(".");
    if (op === "is" && value === "null") return (r: Row) => r[column] === null || r[column] === undefined;
    if (op === "gte") return (r: Row) => typeof r[column] === "string" && (r[column] as string) >= value;
    throw new Error(`unsupported or() term ${term}`);
  });
  return (r) => terms.some((test) => test(r));
}

function query(table: string) {
  fromCalls.push(table);
  let op: Op = "select";
  let patch: Row = {};
  let head = false;
  const preds: Array<(r: Row) => boolean> = [];

  const run = () => {
    const injected = injectFailure(table, op, patch);
    if (injected) return { data: null, count: null, error: { message: injected } };
    const rows = (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
    if (op === "update") {
      for (const column of NOT_NULL[table] ?? []) {
        if (column in patch && patch[column] === null) {
          return {
            data: null,
            count: null,
            error: { code: "23502", message: `null value in column "${column}" of relation "${table}" violates not-null constraint` },
          };
        }
      }
      rows.forEach((r) => Object.assign(r, patch));
      return { data: rows, count: null, error: null };
    }
    if (op === "delete") {
      db[table] = (db[table] ?? []).filter((r) => !preds.every((p) => p(r)));
      return { data: null, count: null, error: null };
    }
    return head ? { data: null, count: rows.length, error: null } : { data: rows, count: null, error: null };
  };

  const q = {
    select: (_columns?: string, options?: { head?: boolean }) => {
      head = Boolean(options?.head);
      return q;
    },
    update: (p: Row) => {
      op = "update";
      patch = p;
      return q;
    },
    delete: () => {
      op = "delete";
      return q;
    },
    eq: (c: string, v: unknown) => {
      preds.push((r) => r[c] === v);
      return q;
    },
    in: (c: string, vs: unknown[]) => {
      preds.push((r) => vs.includes(r[c]));
      return q;
    },
    or: (filter: string) => {
      preds.push(orPredicate(filter));
      return q;
    },
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({ from: (table: string) => query(table) }),
}));

const { disconnectAdAccount } = await import("@/app/(app)/connections/actions-ads");

function adAccount(accountId: string, overrides: Row = {}): Row {
  return {
    id: `ads-${accountId}`,
    account_id: accountId,
    meta_account_id: "act_123",
    currency: "GBP",
    timezone: "Europe/London",
    access_token: "",
    token_expires_at: "2026-11-20T00:00:00Z",
    setup_complete: true,
    created_at: "2026-05-01T00:00:00Z",
    meta_pixel_id: "1234567890",
    conversion_event_name: "Purchase",
    conversion_optimisation_enabled: true,
    conversions_api_access_token: null,
    ...overrides,
  };
}

function campaign(id: string, accountId: string, status: string, endDate: string | null): Row {
  return { id, account_id: accountId, status, end_date: endDate };
}

function ownerContext(overrides: Row = {}) {
  return { accountId: BRAND, role: "owner", features: { paidAds: true }, ...overrides };
}

const adRow = (accountId: string) => db.meta_ad_accounts.find((r) => r.account_id === accountId);
const tokenIds = () => db.meta_ad_account_tokens.map((r) => r.id);

describe("disconnectAdAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    // 13:00 in London on Saturday 26 September 2026 (BST).
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    requireAuthContextMock.mockResolvedValue(ownerContext());
    injectFailure = () => null;
    fromCalls = [];
    db = {
      meta_campaigns: [
        // Ended campaigns stay ACTIVE in the table; they must not block.
        campaign("ended-active", BRAND, "ACTIVE", "2026-08-14"),
        campaign("paused", BRAND, "PAUSED", "2026-10-16"),
        // Another brand's running campaign is not this brand's business.
        campaign("other-running", OTHER, "ACTIVE", "2026-10-16"),
      ],
      meta_ad_accounts: [
        adAccount(BRAND),
        adAccount(OTHER),
      ],
      meta_ad_account_tokens: [
        { id: "tok-access", account_id: BRAND, token_type: "access" },
        { id: "tok-capi", account_id: BRAND, token_type: "conversions_api" },
        { id: "tok-other", account_id: OTHER, token_type: "access" },
      ],
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes both Meta tokens and marks setup incomplete, keeping the account settings", async () => {
    const result = await disconnectAdAccount();

    expect(result).toEqual({ success: true });
    expect(tokenIds()).toEqual(["tok-other"]);
    expect(adRow(BRAND)).toMatchObject({
      access_token: "",
      conversions_api_access_token: null,
      setup_complete: false,
      token_expires_at: null,
      meta_account_id: "act_123",
      meta_pixel_id: "1234567890",
    });
    expect(adRow(OTHER)).toMatchObject({ setup_complete: true, token_expires_at: "2026-11-20T00:00:00Z" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/connections");
    expect(revalidatePathMock).toHaveBeenCalledWith("/campaigns");
  });

  it.each([
    ["ends later", "2026-10-16"],
    ["ends today", "2026-09-26"],
    ["has no end date", null],
  ])("refuses while an ACTIVE campaign that %s can still spend", async (_label, endDate) => {
    db.meta_campaigns.push(campaign("running", BRAND, "ACTIVE", endDate));

    const result = await disconnectAdAccount();

    expect(result.error).toMatch(/^Pause your running campaigns in Campaigns first/);
    expect(tokenIds()).toHaveLength(3);
    expect(adRow(BRAND)?.setup_complete).toBe(true);
  });

  it("uses the London date: at 00:30 BST a campaign that ended the day before does not block", async () => {
    // 23:30 UTC on 25 September is 00:30 on 26 September in London.
    vi.setSystemTime(new Date("2026-09-25T23:30:00Z"));
    db.meta_campaigns.push(campaign("ended-yesterday", BRAND, "ACTIVE", "2026-09-25"));

    const result = await disconnectAdAccount();

    expect(result).toEqual({ success: true });
  });

  it("fails visibly and keeps every token when the campaign check fails", async () => {
    injectFailure = (table) => (table === "meta_campaigns" ? "connection reset" : null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await disconnectAdAccount();

    expect(result.error).toBe("Could not check your campaigns, so Meta Ads is still connected. Please try again.");
    expect(tokenIds()).toHaveLength(3);
    expect(adRow(BRAND)?.setup_complete).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails visibly and leaves setup complete when the token delete fails", async () => {
    injectFailure = (table, op) => (table === "meta_ad_account_tokens" && op === "delete" ? "permission denied" : null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await disconnectAdAccount();

    expect(result.error).toBe("Could not disconnect Meta Ads. Please try again.");
    expect(tokenIds()).toHaveLength(3);
    expect(adRow(BRAND)?.setup_complete).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails visibly when marking the account disconnected fails", async () => {
    injectFailure = (table, op, patch) =>
      table === "meta_ad_accounts" && op === "update" && "setup_complete" in patch ? "statement timeout" : null;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await disconnectAdAccount();

    expect(result.error).toBe("Could not disconnect Meta Ads. Please try again.");
    expect(adRow(BRAND)?.setup_complete).toBe(true);
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses a member before touching the database", async () => {
    requireAuthContextMock.mockResolvedValue(ownerContext({ role: "member" }));

    await expect(disconnectAdAccount()).rejects.toThrow("Only an owner of this brand can do that.");
    expect(fromCalls).toEqual([]);
  });

  it("refuses a brand without paid ads before touching the database", async () => {
    requireAuthContextMock.mockResolvedValue(ownerContext({ features: { paidAds: false } }));

    await expect(disconnectAdAccount()).rejects.toThrow();
    expect(fromCalls).toEqual([]);
  });
});
