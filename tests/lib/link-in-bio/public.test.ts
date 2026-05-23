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

const managementClientMock = vi.hoisted(() => ({
  listManagementEvents: vi.fn(),
  getManagementEventDetail: vi.fn(),
}));

vi.mock("@/lib/management-app/client", () => managementClientMock);

describe("getPublicLinkInBioPageData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-19T20:00:00.000Z"));
    managementClientMock.listManagementEvents.mockResolvedValue([]);
    managementClientMock.getManagementEventDetail.mockResolvedValue(null);
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
                logo_url: null,
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
                    campaign_type: "event",
                    link_in_bio_url: null,
                    account_id: "account-1",
                    metadata: {
                      ctaUrl: "https://example.com/book",
                      ctaLabel: "Book now",
                      description: "Weekly music bingo with prizes.",
                      eventStart: "2026-01-19T20:00:00.000Z",
                    },
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
    expect(data?.campaigns[0]?.campaignType).toBe("event");
    expect(data?.campaigns[0]?.ctaLabel).toBe("Book now");
    expect(data?.campaigns[0]?.summary).toBe("Weekly music bingo with prizes.");
    expect(sawPlacementFilter).toBe(true);
  });

  it("pulls campaigns down after their active window ends", async () => {
    supabaseMock = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};

        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.in = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);

        builder.maybeSingle = vi.fn(async () => {
          if (table === "link_in_bio_profiles") {
            return {
              data: {
                account_id: "account-1",
                slug: "the-anchor",
                display_name: "The Anchor",
                bio: null,
                logo_url: null,
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
                template: "classic",
                font_family: "inter",
                is_published: true,
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
                  id: "content-recent",
                  campaign_id: "campaign-recent",
                  scheduled_for: "2026-01-10T19:00:00.000Z",
                  status: "posted",
                  placement: "feed",
                  prompt_context: { ctaLabel: "Book now" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: {
                    id: "campaign-recent",
                    name: "Cash Bingo",
                    campaign_type: "event",
                    link_in_bio_url: "https://example.com/cash-bingo",
                    account_id: "account-1",
                    metadata: {
                      eventStart: "2026-01-10T19:00:00.000Z",
                      description: "Finished campaign event.",
                    },
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

    expect(data?.campaigns).toHaveLength(0);
  });

  it("uses the latest live campaign entry as the creative matures", async () => {
    supabaseMock = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};

        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.in = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);

        builder.maybeSingle = vi.fn(async () => {
          if (table === "link_in_bio_profiles") {
            return {
              data: {
                account_id: "account-1",
                slug: "the-anchor",
                display_name: "The Anchor",
                bio: null,
                logo_url: null,
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
                template: "classic",
                font_family: "inter",
                is_published: true,
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
            const campaign = {
              id: "campaign-live",
              name: "Music Bingo",
              campaign_type: "event",
              link_in_bio_url: "https://example.com/music-bingo",
              account_id: "account-1",
              metadata: {
                eventStart: "2026-01-19T22:00:00.000Z",
                description: "Live campaign creative.",
              },
            };

            return {
              data: [
                {
                  id: "content-early",
                  campaign_id: "campaign-live",
                  scheduled_for: "2026-01-19T10:00:00.000Z",
                  status: "posted",
                  placement: "feed",
                  prompt_context: { ctaLabel: "Early creative" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: campaign,
                },
                {
                  id: "content-latest",
                  campaign_id: "campaign-live",
                  scheduled_for: "2026-01-19T19:00:00.000Z",
                  status: "posted",
                  placement: "feed",
                  prompt_context: { ctaLabel: "Latest creative" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: campaign,
                },
                {
                  id: "content-future",
                  campaign_id: "campaign-live",
                  scheduled_for: "2026-01-19T21:30:00.000Z",
                  status: "scheduled",
                  placement: "feed",
                  prompt_context: { ctaLabel: "Future creative" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: campaign,
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

    expect(data?.campaigns).toHaveLength(1);
    expect(data?.campaigns[0]?.ctaLabel).toBe("Latest creative");
  });

  it("pulls weekly campaigns down after their display end date", async () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));

    supabaseMock = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};

        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.in = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);

        builder.maybeSingle = vi.fn(async () => {
          if (table === "link_in_bio_profiles") {
            return {
              data: {
                account_id: "account-1",
                slug: "the-anchor",
                display_name: "The Anchor",
                bio: null,
                logo_url: null,
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
                template: "classic",
                font_family: "inter",
                is_published: true,
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
                  id: "content-open-mic",
                  campaign_id: "campaign-open-mic",
                  scheduled_for: "2026-02-28T14:27:00.000Z",
                  status: "posted",
                  placement: "feed",
                  prompt_context: { ctaLabel: "Book a table" },
                  platform: "instagram",
                  content_variants: null,
                  campaigns: {
                    id: "campaign-open-mic",
                    name: "Open Mic Night Call for Artists",
                    campaign_type: "weekly",
                    link_in_bio_url: "https://example.com/open-mic",
                    account_id: "account-1",
                    metadata: {
                      dayOfWeek: 6,
                      time: "07:00",
                      startDate: "2026-02-28T00:00:00.000Z",
                      displayEndDate: "2026-04-18T06:00:00.000Z",
                      description: "Expired weekly open mic campaign.",
                    },
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

    expect(data?.campaigns).toHaveLength(0);
  });

  it("loads upcoming website events from the management connection", async () => {
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
    managementClientMock.listManagementEvents.mockResolvedValue([
      {
        id: "event-1",
        name: "Music Bingo",
        slug: "music-bingo",
        date: "2026-06-12",
        time: "21:00",
        event_status: "scheduled",
      },
    ]);
    managementClientMock.getManagementEventDetail.mockResolvedValue({
      id: "event-1",
      slug: "music-bingo",
      name: "Music Bingo",
      date: "2026-06-12",
      time: "21:00",
      startDate: "2026-06-12T21:00:00.000+01:00",
      shortDescription: "<p>Big tunes and prizes.</p>",
      event_status: "scheduled",
      linkInBioShortLink: "https://l.the-anchor.pub/music-bingo",
      thumbnailImageUrl: "https://example.com/music-bingo.png",
      category: { name: "Music Bingo", slug: "music-bingo" },
    });

    supabaseMock = {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};

        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.in = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);

        builder.maybeSingle = vi.fn(async () => {
          if (table === "link_in_bio_profiles") {
            return {
              data: {
                account_id: "account-1",
                slug: "the-anchor",
                display_name: "The Anchor",
                bio: null,
                logo_url: null,
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
                website_url: "https://the-anchor.pub",
                template: "classic",
                font_family: "inter",
                is_published: true,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
              error: null,
            };
          }

          if (table === "accounts") {
            return { data: { timezone: "Europe/London" }, error: null };
          }

          if (table === "management_app_connections") {
            return {
              data: {
                base_url: "https://management.orangejelly.co.uk",
                api_key: "secret",
                enabled: true,
              },
              error: null,
            };
          }

          return { data: null, error: null };
        });

        builder.returns = vi.fn(async () => {
          if (table === "link_in_bio_tiles" || table === "content_items") {
            return { data: [], error: null };
          }

          return { data: [], error: null };
        });

        return builder;
      }),
    };

    const { getPublicLinkInBioPageData } = await import("@/lib/link-in-bio/public");
    const data = await getPublicLinkInBioPageData("the-anchor");

    expect(managementClientMock.listManagementEvents).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://management.orangejelly.co.uk", apiKey: "secret" }),
      expect.objectContaining({ fromDate: "2026-05-22", status: "scheduled,rescheduled,postponed,sold_out" }),
    );
    expect(data?.websiteEvents).toEqual([
      expect.objectContaining({
        id: "event-1",
        name: "Music Bingo",
        summary: "Big tunes and prizes.",
        imageUrl: "https://example.com/music-bingo.png",
        ctaUrl: "https://l.the-anchor.pub/music-bingo",
      }),
    ]);
  });
});
