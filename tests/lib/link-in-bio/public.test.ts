import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/library/data", () => ({
  normaliseStoragePath: (value: string) => value,
  resolvePreviewCandidates: () => [],
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: () => false,
}));

let supabaseMock: { from: ReturnType<typeof vi.fn> } | null = null;

vi.mock("@/lib/supabase/service", () => ({
  tryCreateServiceSupabaseClient: () => supabaseMock,
}));

describe("getPublicLinkInBioPageData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-19T20:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    supabaseMock = null;
  });

  it("shows feed posts (not stories) and uses a campaign link", async () => {
    let sawPlacementFilter = false;

    supabaseMock = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};

        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn((...args: unknown[]) => {
          if (table === "content_items" && args[0] === "placement" && args[1] === "feed") {
            sawPlacementFilter = true;
          }
          return builder;
        });
        builder.in = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);

        if (table === "content_items") {
          builder.not = vi.fn(() => {
            throw new Error("Unexpected link_in_bio_url filter");
          });
          builder.neq = vi.fn(() => {
            throw new Error("Unexpected link_in_bio_url filter");
          });
        }

        builder.maybeSingle = vi.fn(async () => {
          if (table === "link_in_bio_profiles") {
            return {
              data: {
                account_id: "account-1",
                slug: "the-anchor",
                display_name: "The Anchor",
                bio: "A cosy pub.",
                hero_media_id: null,
                theme: null,
                phone_number: null,
                whatsapp_number: null,
                booking_url: null,
                menu_url: null,
                parking_url: null,
                directions_url: null,
                facebook_url: null,
                instagram_url: null,
                website_url: null,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
              error: null,
            };
          }

          if (table === "accounts") {
            return { data: { timezone: "Europe/London" }, error: null };
          }

          return { data: null, error: null };
        });

        builder.returns = vi.fn(async () => {
          if (table === "link_in_bio_tiles") {
            return { data: [], error: null };
          }

          if (table === "content_items") {
            return {
              data: [
                {
                  id: "content-1",
                  campaign_id: "campaign-1",
                  scheduled_for: "2026-01-19T10:00:00.000Z",
                  status: "posted",
                  placement: "feed",
                  prompt_context: { slot: "manual-1" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: {
                    id: "campaign-1",
                    name: "Music Bingo",
                    link_in_bio_url: null,
                    account_id: "account-1",
                    metadata: { ctaUrl: "https://example.com/book" },
                  },
                },
              ],
              error: null,
            };
          }

          return { data: [], error: null };
        });

        return builder;
      }),
    };

    const { getPublicLinkInBioPageData } = await import("@/lib/link-in-bio/public");
    const data = await getPublicLinkInBioPageData("the-anchor");

    expect(data?.profile.slug).toBe("the-anchor");
    expect(data?.campaigns).toHaveLength(1);
    expect(data?.campaigns[0]?.name).toBe("Music Bingo");
    expect(data?.campaigns[0]?.linkUrl).toBe("https://example.com/book");
    expect(sawPlacementFilter).toBe(true);
  });
});
