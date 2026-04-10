import { describe, expect, it, vi, beforeEach } from "vitest";

// Set env before any imports that touch env.ts
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "mock-anon-key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mock-service-role-key";

// Track all inserted rows
let allInsertedRows: Array<Record<string, unknown>> = [];

// Track all .from() calls for debugging
let fromCalls: string[] = [];

// Mock the supabase service module before any imports
vi.mock("@/lib/supabase/service", () => ({
  tryCreateServiceSupabaseClient: vi.fn(),
}));

import { materialiseRecurringCampaigns, parseWeeklyCampaignMetadata } from "@/lib/scheduling/materialise";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

const mockedTryCreate = vi.mocked(tryCreateServiceSupabaseClient);

function setupMock(
  campaigns: Array<Record<string, unknown>>,
  existingContentByCampaign: Array<Record<string, unknown>>,
  existingContentByAccount: Array<Record<string, unknown>>,
) {
  allInsertedRows = [];
  fromCalls = [];

  // Build a chainable query mock
  function makeChain(resolveData: unknown[]) {
    const result = { data: resolveData, error: null };
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "neq", "in", "throwOnError"]) {
      self[m] = vi.fn().mockReturnValue(self);
    }
    // Make it resolve like an awaitable query
    Object.assign(self, result);
    return self;
  }

  // The mock client — one shared client returned for all tryCreate calls

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);

      if (table === "campaigns") {
        return makeChain(campaigns);
      }

      if (table === "content_items") {
        // First content_items call per campaign = existing check (select)
        // Second content_items call per campaign = insert
        // For the existing query, we need to distinguish between
        // campaign-scoped and account-scoped queries.
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((col: string) => {
              if (col === "campaign_id") {
                // Campaign-scoped query
                return {
                  gte: vi.fn().mockReturnValue({
                    lte: vi.fn().mockReturnValue({
                      data: existingContentByCampaign,
                      error: null,
                    }),
                  }),
                };
              }
              if (col === "account_id") {
                // Account-scoped query (the fix adds this)
                return {
                  gte: vi.fn().mockReturnValue({
                    lte: vi.fn().mockReturnValue({
                      data: existingContentByAccount,
                      error: null,
                    }),
                  }),
                  eq: vi.fn().mockReturnValue({
                    gte: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        data: existingContentByAccount,
                        error: null,
                      }),
                    }),
                  }),
                };
              }
              return makeChain([]);
            }),
          }),
          insert: vi.fn((rows: unknown[]) => {
            allInsertedRows.push(
              ...(rows as Array<Record<string, unknown>>),
            );
            return { throwOnError: vi.fn() };
          }),
        };
      }

      return makeChain([]);
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedTryCreate.mockReturnValue(client as any);
}

describe("parseWeeklyCampaignMetadata", () => {
  it("parses spread_evenly metadata correctly", () => {
    const result = parseWeeklyCampaignMetadata({
      scheduleMode: "spread_evenly",
      postsPerWeek: 3,
      staggerPlatforms: true,
    });
    expect(result.scheduleMode).toBe("spread_evenly");
    expect(result.postsPerWeek).toBe(3);
    expect(result.staggerPlatforms).toBe(true);
  });

  it("defaults to fixed_days when scheduleMode is missing", () => {
    const result = parseWeeklyCampaignMetadata({
      postsPerWeek: 2,
    });
    expect(result.scheduleMode).toBe("fixed_days");
  });

  it("defaults to fixed_days for null metadata", () => {
    const result = parseWeeklyCampaignMetadata(null);
    expect(result.scheduleMode).toBe("fixed_days");
    expect(result.staggerPlatforms).toBe(true);
  });

  it("defaults to fixed_days for empty object", () => {
    const result = parseWeeklyCampaignMetadata({});
    expect(result.scheduleMode).toBe("fixed_days");
  });

  it("rejects invalid scheduleMode and falls back to defaults", () => {
    const result = parseWeeklyCampaignMetadata({
      scheduleMode: "invalid_mode",
    });
    expect(result.scheduleMode).toBe("fixed_days");
  });

  it("validates postsPerWeek bounds", () => {
    const valid = parseWeeklyCampaignMetadata({
      scheduleMode: "spread_evenly",
      postsPerWeek: 7,
    });
    expect(valid.postsPerWeek).toBe(7);

    // Out of bounds — Zod rejects, falls back to defaults
    const invalid = parseWeeklyCampaignMetadata({
      scheduleMode: "spread_evenly",
      postsPerWeek: 10,
    });
    expect(invalid.scheduleMode).toBe("fixed_days");
  });
});

describe("materialiseRecurringCampaigns — spread_evenly campaigns are skipped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allInsertedRows = [];
    fromCalls = [];
  });

  it("does not materialise slots for spread_evenly campaigns", async () => {
    const reference = new Date("2026-01-05T00:00:00Z");

    const spreadCampaign = {
      id: "spread-campaign",
      name: "Spread Campaign",
      metadata: {
        scheduleMode: "spread_evenly",
        postsPerWeek: 3,
        staggerPlatforms: true,
        cadence: [
          { platform: "facebook", weekday: 3, hour: 10, minute: 0 },
        ],
      },
    };

    setupMock([spreadCampaign], [], []);

    await materialiseRecurringCampaigns(reference);

    // No rows should be inserted — spread_evenly campaigns are skipped
    expect(allInsertedRows).toHaveLength(0);
  });

  it("materialises fixed_days campaigns normally alongside spread_evenly ones", async () => {
    const reference = new Date("2026-01-05T00:00:00Z");

    const spreadCampaign = {
      id: "spread-campaign",
      name: "Spread Campaign",
      metadata: {
        scheduleMode: "spread_evenly",
        postsPerWeek: 3,
        cadence: [
          { platform: "facebook", weekday: 3, hour: 10, minute: 0 },
        ],
      },
    };

    const fixedCampaign = {
      id: "fixed-campaign",
      name: "Fixed Campaign",
      metadata: {
        scheduleMode: "fixed_days",
        cadence: [
          { platform: "facebook", weekday: 3, hour: 10, minute: 0 },
        ],
      },
    };

    setupMock([spreadCampaign, fixedCampaign], [], []);

    await materialiseRecurringCampaigns(reference);

    // Only fixed-campaign rows should be inserted
    const fixedRows = allInsertedRows.filter(
      (r) => r.campaign_id === "fixed-campaign",
    );
    const spreadRows = allInsertedRows.filter(
      (r) => r.campaign_id === "spread-campaign",
    );

    expect(spreadRows).toHaveLength(0);
    expect(fixedRows.length).toBeGreaterThan(0);
  });
});

describe("materialiseRecurringCampaigns — cross-campaign conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allInsertedRows = [];
    fromCalls = [];
  });

  it("shifts a slot when another campaign already occupies the same platform+time", async () => {
    // Reference date: Monday 2026-01-05
    const reference = new Date("2026-01-05T00:00:00Z");

    // Campaign A wants facebook on Wednesday at 10:00.
    // Wednesday 2026-01-07, weekday 3 (ISO).
    const campaignA = {
      id: "campaign-a",
      name: "Campaign A",
      metadata: {
        cadence: [
          { platform: "facebook", weekday: 3, hour: 10, minute: 0 },
        ],
      },
    };

    // No existing content for campaign A specifically
    const existingByCampaign: Array<Record<string, unknown>> = [];

    // But campaign B already has facebook at Wed 10:00 (account-level query)
    const existingByAccount = [
      {
        id: "existing-b",
        scheduled_for: "2026-01-07T10:00:00.000Z",
        platform: "facebook",
      },
    ];

    setupMock([campaignA], existingByCampaign, existingByAccount);

    await materialiseRecurringCampaigns(reference);

    // There should be exactly one inserted row for campaign A
    const campaignARows = allInsertedRows.filter(
      (r) => r.campaign_id === "campaign-a",
    );
    expect(campaignARows).toHaveLength(1);

    // The scheduled time should NOT be 10:00 — it should be shifted
    expect(campaignARows[0].scheduled_for).not.toBe(
      "2026-01-07T10:00:00.000Z",
    );
  });
});
