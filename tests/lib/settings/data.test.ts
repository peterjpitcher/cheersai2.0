import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const isSchemaMissingErrorMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: (...args: unknown[]) => isSchemaMissingErrorMock(...args),
}));

vi.mock("@/lib/constants", () => ({
  DEFAULT_TIMEZONE: "Europe/London",
}));

function createQueryBuilder() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => ({ data: null, error: null })),
  });
  return builder as {
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
  };
}

describe("getOwnerSettings", () => {
  let accountsBuilder: ReturnType<typeof createQueryBuilder>;
  let linkInBioBuilder: ReturnType<typeof createQueryBuilder>;
  let brandBuilder: ReturnType<typeof createQueryBuilder>;
  let postingBuilder: ReturnType<typeof createQueryBuilder>;
  let fromMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    accountsBuilder = createQueryBuilder();
    linkInBioBuilder = createQueryBuilder();
    brandBuilder = createQueryBuilder();
    postingBuilder = createQueryBuilder();

    let callIndex = 0;
    fromMock = vi.fn((table: string) => {
      if (table === "accounts") return accountsBuilder;
      if (table === "link_in_bio_profiles") return linkInBioBuilder;
      if (table === "brand_profile") return brandBuilder;
      if (table === "posting_defaults") return postingBuilder;
      // fallback by call order
      callIndex++;
      return callIndex <= 2 ? accountsBuilder : brandBuilder;
    });

    requireAuthContextMock.mockResolvedValue({
      supabase: { from: fromMock },
      accountId: "account-1",
    });

    isSchemaMissingErrorMock.mockReturnValue(false);
  });

  it("maps default_posting_time and venue_location from snake_case to camelCase", async () => {
    accountsBuilder.maybeSingle.mockResolvedValue({
      data: { timezone: "Europe/London", display_name: "Test Venue" },
      error: null,
    });
    linkInBioBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    brandBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    postingBuilder.maybeSingle.mockResolvedValue({
      data: {
        facebook_location_id: null,
        instagram_location_id: null,
        gbp_location_id: null,
        default_posting_time: "18:30",
        venue_location: "123 High Street, London",
        venue_latitude: "51.4625",
        venue_longitude: "-0.5021",
        notifications: { emailFailures: true, emailTokenExpiring: true },
        gbp_cta_standard: "LEARN_MORE",
        gbp_cta_event: "LEARN_MORE",
        gbp_cta_offer: "REDEEM",
      },
      error: null,
    });

    const { getOwnerSettings } = await import("@/lib/settings/data");
    const result = await getOwnerSettings();

    expect(result.posting.defaultPostingTime).toBe("18:30");
    expect(result.posting.venueLocation).toBe("123 High Street, London");
    expect(result.posting.venueLatitude).toBe(51.4625);
    expect(result.posting.venueLongitude).toBe(-0.5021);
    expect(result.venueLocation).toBe("123 High Street, London");
  });

  it("returns undefined for defaultPostingTime and venueLocation when not set", async () => {
    accountsBuilder.maybeSingle.mockResolvedValue({
      data: { timezone: "Europe/London", display_name: null },
      error: null,
    });
    linkInBioBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    brandBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    postingBuilder.maybeSingle.mockResolvedValue({
      data: {
        facebook_location_id: null,
        instagram_location_id: null,
        gbp_location_id: null,
        default_posting_time: null,
        venue_location: null,
        venue_latitude: null,
        venue_longitude: null,
        notifications: null,
        gbp_cta_standard: "LEARN_MORE",
        gbp_cta_event: "LEARN_MORE",
        gbp_cta_offer: "REDEEM",
      },
      error: null,
    });

    const { getOwnerSettings } = await import("@/lib/settings/data");
    const result = await getOwnerSettings();

    expect(result.posting.defaultPostingTime).toBeUndefined();
    expect(result.posting.venueLocation).toBeUndefined();
    expect(result.posting.venueLatitude).toBeUndefined();
    expect(result.posting.venueLongitude).toBeUndefined();
    expect(result.venueLocation).toBeUndefined();
  });

  it("returns undefined for new fields when posting_defaults row is missing", async () => {
    accountsBuilder.maybeSingle.mockResolvedValue({
      data: { timezone: "Europe/London", display_name: null },
      error: null,
    });
    linkInBioBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    brandBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    postingBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const { getOwnerSettings } = await import("@/lib/settings/data");
    const result = await getOwnerSettings();

    expect(result.posting.defaultPostingTime).toBeUndefined();
    expect(result.posting.venueLocation).toBeUndefined();
  });
});
