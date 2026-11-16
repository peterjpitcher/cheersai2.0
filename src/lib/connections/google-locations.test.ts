import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" }, server: {} },
}));

import { GoogleListError, listGoogleLocations } from "@/lib/connections/google-locations";

const ACCESS_TOKEN = "ya29.access-never-logged";
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATIONS = "https://mybusinessbusinessinformation.googleapis.com/v1";

type Handler = (url: URL) => Response | Promise<Response>;

const fetchMock = vi.fn();
const calls: URL[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Google's error body (AIP-193): `error.status` and an ErrorInfo `reason`. */
function googleError(status: number, googleStatus: string, message: string, reason?: string): Response {
  return json(
    {
      error: {
        code: status,
        message,
        status: googleStatus,
        details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] : [],
      },
    },
    status,
  );
}

function route(handler: Handler) {
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    return handler(url);
  });
}

function location(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    name: `locations/${id}`,
    title,
    storefrontAddress: { addressLines: ["Horton Road"], locality: "Stanwell Moor", postalCode: "TW19 6AQ", regionCode: "GB" },
    metadata: { placeId: `place-${id}`, mapsUri: "https://maps.google.com/?cid=1" },
    ...extra,
  };
}

async function failure(run: () => Promise<unknown>): Promise<GoogleListError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof GoogleListError) return error;
    throw error;
  }
  throw new Error("expected a GoogleListError");
}

beforeEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listGoogleLocations", () => {
  it("lists one location in the stored format, with its address and place id", async () => {
    route((url) =>
      url.href.startsWith(ACCOUNTS)
        ? json({ accounts: [{ name: "accounts/111", accountName: "Peter Pitcher", type: "PERSONAL" }] })
        : json({ locations: [location("999", "The Anchor")] }),
    );

    const list = await listGoogleLocations(ACCESS_TOKEN);

    expect(list).toEqual({
      locations: [
        {
          id: "accounts/111/locations/999",
          title: "The Anchor",
          address: "Horton Road, Stanwell Moor, TW19 6AQ",
          accountName: "Peter Pitcher",
          placeId: "place-999",
        },
      ],
      accountCount: 1,
      incomplete: false,
    });

    // The token goes in the Authorization header, never in the URL.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    for (const url of calls) expect(url.href).not.toContain(ACCESS_TOKEN);

    expect(calls[0].searchParams.get("pageSize")).toBe("20");
    expect(calls[1].pathname).toBe("/v1/accounts/111/locations");
    expect(calls[1].searchParams.get("readMask")).toBe("name,title,storefrontAddress,metadata");
    expect(calls[1].searchParams.get("pageSize")).toBe("100");
  });

  it("follows a second page of accounts and a second page of locations", async () => {
    route((url) => {
      const pageToken = url.searchParams.get("pageToken");
      if (url.href.startsWith(ACCOUNTS)) {
        return pageToken === "accounts-page-2"
          ? json({ accounts: [{ name: "accounts/222", accountName: "Group Two" }] })
          : json({ accounts: [{ name: "accounts/111", accountName: "Group One" }], nextPageToken: "accounts-page-2" });
      }
      if (url.pathname === "/v1/accounts/111/locations") {
        return pageToken === "locations-page-2"
          ? json({ locations: [location("2", "Anchor Two")] })
          : json({ locations: [location("1", "Anchor One")], nextPageToken: "locations-page-2" });
      }
      return json({ locations: [location("3", "Anchor Three")] });
    });

    const list = await listGoogleLocations(ACCESS_TOKEN);

    expect(list.accountCount).toBe(2);
    expect(list.incomplete).toBe(false);
    expect(list.locations.map((entry) => entry.id)).toEqual([
      "accounts/111/locations/1",
      "accounts/111/locations/2",
      "accounts/222/locations/3",
    ]);
    expect(calls.filter((url) => url.href.startsWith(ACCOUNTS))).toHaveLength(2);
    expect(calls.filter((url) => url.href.startsWith(LOCATIONS))).toHaveLength(3);
  });

  it("returns no accounts as an empty list, not an error", async () => {
    route(() => json({}));
    expect(await listGoogleLocations(ACCESS_TOKEN)).toEqual({ locations: [], accountCount: 0, incomplete: false });
  });

  it("returns an account with no locations as an empty list, not an error", async () => {
    route((url) => (url.href.startsWith(ACCOUNTS) ? json({ accounts: [{ name: "accounts/111" }] }) : json({})));
    expect(await listGoogleLocations(ACCESS_TOKEN)).toEqual({ locations: [], accountCount: 1, incomplete: false });
  });

  it("keeps what loaded and says the list is incomplete when one account cannot be listed", async () => {
    route((url) => {
      if (url.href.startsWith(ACCOUNTS)) {
        return json({ accounts: [{ name: "accounts/111", accountName: "One" }, { name: "accounts/222", accountName: "Two" }] });
      }
      return url.pathname === "/v1/accounts/222/locations"
        ? googleError(500, "INTERNAL", "Internal error encountered.")
        : json({ locations: [location("1", "Anchor One")] });
    });

    const list = await listGoogleLocations(ACCESS_TOKEN);

    expect(list.incomplete).toBe(true);
    expect(list.locations.map((entry) => entry.id)).toEqual(["accounts/111/locations/1"]);
  });

  it("fails, rather than reporting no locations, when the only locations found were behind a refused call", async () => {
    route((url) => {
      if (url.href.startsWith(ACCOUNTS)) {
        return json({ accounts: [{ name: "accounts/111" }, { name: "accounts/222" }] });
      }
      return url.pathname === "/v1/accounts/222/locations" ? googleError(503, "UNAVAILABLE", "Unavailable") : json({});
    });

    const error = await failure(() => listGoogleLocations(ACCESS_TOKEN));
    expect(error.kind).toBe("unavailable");
    expect(error.step).toBe("locations");
  });

  it("classifies the quota wall (429 RESOURCE_EXHAUSTED) as not approved, keeping no Google wording", async () => {
    route(() =>
      googleError(
        429,
        "RESOURCE_EXHAUSTED",
        "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com' for consumer 'project_number:344798984846'.",
        "RATE_LIMIT_EXCEEDED",
      ),
    );

    const error = await failure(() => listGoogleLocations(ACCESS_TOKEN));

    expect(error.kind).toBe("not_approved");
    expect(error.status).toBe(429);
    expect(error.googleStatus).toBe("RESOURCE_EXHAUSTED");
    expect(error.reason).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.step).toBe("accounts");
    expect(error.message).not.toContain("Quota exceeded");
    expect(error.message).not.toContain("344798984846");
    expect(error.message).not.toContain(ACCESS_TOKEN);
  });

  it("classifies a 403 about a switched-off API or quota as not approved", async () => {
    route(() =>
      googleError(
        403,
        "PERMISSION_DENIED",
        "My Business Account Management API has not been used in project 344798984846 before or it is disabled.",
        "SERVICE_DISABLED",
      ),
    );
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("not_approved");

    route(() => googleError(403, "PERMISSION_DENIED", "Quota exceeded for quota metric 'Requests'."));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("not_approved");
  });

  it("classifies any other 403, and a 401, as permission denied", async () => {
    route(() => googleError(403, "PERMISSION_DENIED", "The caller does not have permission"));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("permission_denied");

    route(() => googleError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("permission_denied");
  });

  it("classifies a 5xx, a timeout and an unreadable body as unavailable", async () => {
    route(() => googleError(503, "UNAVAILABLE", "The service is currently unavailable."));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("unavailable");

    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("unavailable");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("unavailable");
  });

  it("classifies any other refusal (for example a 400) as failed", async () => {
    route(() => googleError(400, "INVALID_ARGUMENT", "Invalid field mask"));
    expect((await failure(() => listGoogleLocations(ACCESS_TOKEN))).kind).toBe("failed");
  });

  it("fails when every account's locations are refused at the quota wall", async () => {
    route((url) =>
      url.href.startsWith(ACCOUNTS)
        ? json({ accounts: [{ name: "accounts/111" }] })
        : googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded", "RATE_LIMIT_EXCEEDED"),
    );

    const error = await failure(() => listGoogleLocations(ACCESS_TOKEN));
    expect(error.kind).toBe("not_approved");
    expect(error.step).toBe("locations");
  });

  it("drops entries without a usable account or location name", async () => {
    route((url) =>
      url.href.startsWith(ACCOUNTS)
        ? json({ accounts: [{ name: "accounts/111" }, { name: "not-an-account" }, { accountName: "No name" }] })
        : json({ locations: [location("1", "Anchor One"), { name: "accounts/1/locations/2", title: "Old format" }, { title: "No name" }] }),
    );

    const list = await listGoogleLocations(ACCESS_TOKEN);

    expect(list.accountCount).toBe(1);
    expect(list.locations.map((entry) => entry.id)).toEqual(["accounts/111/locations/1"]);
  });

  it("shows a listing without an address or a title plainly", async () => {
    route((url) =>
      url.href.startsWith(ACCOUNTS)
        ? json({ accounts: [{ name: "accounts/111" }] })
        : json({ locations: [{ name: "locations/1" }] }),
    );

    const [entry] = (await listGoogleLocations(ACCESS_TOKEN)).locations;
    expect(entry).toEqual({
      id: "accounts/111/locations/1",
      title: "Unnamed location",
      address: null,
      accountName: null,
      placeId: null,
    });
  });
});
