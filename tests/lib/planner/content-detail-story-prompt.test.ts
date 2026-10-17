// The planner's post detail carries the booking prompt the worker will draw on
// an event story, so the drawer and the post page preview it
// (tasks/SPEC-story-booking-prompt.md). Only a Facebook prompt needs the
// brand's website, so only that case reads link_in_bio_profiles.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthContextMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/supabase/service", () => ({
  tryCreateServiceSupabaseClient: () => null,
}));

import { getPlannerContentDetail } from "@/lib/planner/data";

const ACCOUNT_ID = "account-anchor";

type QueryResult = { data: unknown; error: unknown };
type RecordedQuery = { table: string; filters: Array<[string, unknown]> };

function fakeSupabase(results: Record<string, QueryResult>) {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, filters: [] };
      queries.push(query);
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          query.filters.push([column, value]);
          return chain;
        },
        is: () => chain,
        in: () => chain,
        maybeSingle: async () => results[table] ?? { data: null, error: null },
        returns: async () => results[table] ?? { data: [], error: null },
      };
      return chain;
    },
  };
  return { client, queries };
}

function contentRow(overrides: { platform: string; placement: "feed" | "story"; campaignType?: string | null }) {
  return {
    id: "content-1",
    platform: overrides.platform,
    placement: overrides.placement,
    scheduled_for: "2026-10-19T06:00:00.000Z",
    status: "scheduled",
    auto_generated: true,
    prompt_context: {
      brief: {
        ctaLinks: {
          facebook: "https://l.the-anchor.pub/fb6e761f",
          instagram: "https://l.the-anchor.pub/ig6e761f",
        },
      },
    },
    campaigns: {
      id: "campaign-1",
      name: "Snowball Showdown Cash Bingo",
      campaign_type: overrides.campaignType === undefined ? "event" : overrides.campaignType,
      metadata: { startDate: "2026-11-18", startTime: "19:00" },
    },
    content_variants: [{ body: "", media_ids: [], banner_enabled: true, banner_text_override: null }],
    publish_jobs: [],
  };
}

function setUp(row: ReturnType<typeof contentRow>, website: QueryResult) {
  const { client, queries } = fakeSupabase({
    content_items: { data: row, error: null },
    link_in_bio_profiles: website,
  });
  requireAuthContextMock.mockResolvedValue({ supabase: client, accountId: ACCOUNT_ID });
  return queries;
}

describe("getPlannerContentDetail storyPrompt", () => {
  beforeEach(() => {
    requireAuthContextMock.mockReset();
  });

  it("names the brand's website on a Facebook event story", async () => {
    const queries = setUp(contentRow({ platform: "facebook", placement: "story" }), {
      data: { website_url: "https://www.the-anchor.pub" },
      error: null,
    });

    const detail = await getPlannerContentDetail("content-1");

    expect(detail?.storyPrompt).toBe("BOOK AT THE-ANCHOR.PUB");
    const websiteQuery = queries.find((query) => query.table === "link_in_bio_profiles");
    expect(websiteQuery?.filters).toEqual([["account_id", ACCOUNT_ID]]);
  });

  it("gives an Instagram event story its text without reading the website", async () => {
    const queries = setUp(contentRow({ platform: "instagram", placement: "story" }), {
      data: { website_url: "https://www.the-anchor.pub" },
      error: null,
    });

    const detail = await getPlannerContentDetail("content-1");

    expect(detail?.storyPrompt).toBe("LINK IN BIO TO BOOK");
    expect(queries.some((query) => query.table === "link_in_bio_profiles")).toBe(false);
  });

  it.each([
    ["a feed post", contentRow({ platform: "facebook", placement: "feed" })],
    ["a story that is not an event", contentRow({ platform: "facebook", placement: "story", campaignType: "promotion" })],
  ])("returns no prompt for %s and does not read the website", async (_case, row) => {
    const queries = setUp(row, { data: { website_url: "https://www.the-anchor.pub" }, error: null });

    const detail = await getPlannerContentDetail("content-1");

    expect(detail?.storyPrompt).toBeNull();
    expect(queries.some((query) => query.table === "link_in_bio_profiles")).toBe(false);
  });

  it("shows the generic Facebook text when the website read fails, and still loads the post", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setUp(contentRow({ platform: "facebook", placement: "story" }), {
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const detail = await getPlannerContentDetail("content-1");

    expect(detail).not.toBeNull();
    expect(detail?.storyPrompt).toBe("SEE OUR PAGE TO BOOK");
    expect(consoleError).toHaveBeenCalledWith("[planner] brand website lookup failed", expect.anything());
    consoleError.mockRestore();
  });

  it("uses the generic Facebook text for a brand with no website", async () => {
    setUp(contentRow({ platform: "facebook", placement: "story" }), { data: null, error: null });

    const detail = await getPlannerContentDetail("content-1");

    expect(detail?.storyPrompt).toBe("SEE OUR PAGE TO BOOK");
  });
});
