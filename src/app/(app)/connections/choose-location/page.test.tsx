import { randomBytes } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryConnectionsDb } from "../../../../../tests/helpers/in-memory-connections-db";

let db: InMemoryConnectionsDb;
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: vi.fn(() => db.client()),
}));

const mockRequireAuthContext = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" }, server: {} },
}));

const { default: ChooseLocation, metadata } = await import("./page");
const { createGoogleLocationChoice } = await import("@/lib/connections/google-choice");

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCESS_TOKEN = "ya29.google-access-never-shown";
const REFRESH_TOKEN = "1//google-refresh-never-shown";
const NOT_FOUND = "We could not find this choice. Start again from the Connections screen.";

function authContext({ userId = USER, googlePosts = true } = {}) {
  return {
    accountId: ACCOUNT,
    activeAccountId: ACCOUNT,
    user: { id: userId },
    brands: [
      {
        accountId: ACCOUNT,
        name: "The Anchor",
        timezone: "Europe/London",
        role: "owner",
        features: { paidAds: false, tournaments: false, managementImport: false, googlePosts },
      },
    ],
    isSuperAdmin: false,
    role: "owner",
  };
}

async function choice(overrides: Record<string, unknown> = {}) {
  return createGoogleLocationChoice(db.client(), {
    userId: USER,
    accountId: ACCOUNT,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    incomplete: false,
    currentLocationId: null,
    locations: [
      { id: "accounts/111/locations/1", title: "The Anchor", address: "Horton Road, Stanwell Moor, TW19 6AQ", accountName: "Peter Pitcher", placeId: "p1" },
      { id: "accounts/111/locations/2", title: "The Anchor", address: "1 High Street, Staines, TW18 4EE", accountName: "Peter Pitcher", placeId: "p2" },
    ],
    ...overrides,
  });
}

async function renderPage(token: string | undefined) {
  return renderToStaticMarkup(await ChooseLocation({ searchParams: Promise.resolve(token ? { choice: token } : {}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOKEN_VAULT_KEY", randomBytes(32).toString("hex"));
  db = new InMemoryConnectionsDb();
  db.seed("accounts", [{ id: ACCOUNT }]);
  mockRequireAuthContext.mockResolvedValue(authContext());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/connections/choose-location", () => {
  it("keeps the choice reference from leaking to other sites or search engines", () => {
    expect(metadata).toMatchObject({ referrer: "same-origin", robots: { index: false, follow: false } });
  });

  it("lists the locations with their addresses, so two with the same name can be told apart", async () => {
    const html = await renderPage(await choice());

    expect(html).toContain("Horton Road, Stanwell Moor, TW19 6AQ");
    expect(html).toContain("1 High Street, Staines, TW18 4EE");
    expect(html).toContain("Google account: Peter Pitcher");
    expect(html).toContain("for The Anchor");
  });

  it("never selects a location for the owner, even when there is only one", async () => {
    const html = await renderPage(
      await choice({
        locations: [{ id: "accounts/111/locations/1", title: "The Anchor", address: null, accountName: null, placeId: null }],
      }),
    );

    expect(html.match(/type="radio"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*\schecked/);
    // The confirm button stays disabled until the owner picks.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).toContain("No address on this listing");
  });

  it("never sends a Google token to the browser", async () => {
    const html = await renderPage(await choice());

    expect(html).not.toContain(ACCESS_TOKEN);
    expect(html).not.toContain(REFRESH_TOKEN);
  });

  it("says when some accounts could not be listed", async () => {
    const html = await renderPage(await choice({ incomplete: true }));
    expect(html).toContain("Some of your Google accounts could not be listed");
  });

  it("marks the location connected now", async () => {
    const html = await renderPage(await choice({ currentLocationId: "accounts/111/locations/2" }));
    expect(html.match(/Connected now/g)).toHaveLength(1);
  });

  it("shows nothing about Google, and no locations, to a brand without the switch", async () => {
    const token = await choice();
    mockRequireAuthContext.mockResolvedValue(authContext({ googlePosts: false }));

    const html = await renderPage(token);

    expect(html).toContain(NOT_FOUND);
    expect(html).not.toContain("Horton Road");
    expect(html).not.toMatch(/google/i);
  });

  it("refuses someone else's choice, a missing reference and a malformed one", async () => {
    const token = await choice();

    expect(await renderPage(undefined)).toContain(NOT_FOUND);
    expect(await renderPage("not-a-reference")).toContain(NOT_FOUND);

    mockRequireAuthContext.mockResolvedValue(authContext({ userId: OTHER_USER }));
    const html = await renderPage(token);
    expect(html).toContain(NOT_FOUND);
    expect(html).not.toContain("Horton Road");
  });

  it("says an expired choice saved nothing, and drops its tokens", async () => {
    const token = await choice();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    const html = await renderPage(token);

    expect(html).toContain("This choice has expired and nothing was saved.");
    expect(db.rows("oauth_states")[0].auth_code).toBeNull();
  });
});
