// The publish worker sends an event story's booking prompt to the render route
// (tasks/SPEC-story-booking-prompt.md). Instagram says "LINK IN BIO TO BOOK";
// Facebook names the brand's website, read from link_in_bio_profiles only for
// a Facebook event story with a booking link. A failed website read must not
// cost the story its slot. The ordered database mocks follow
// "renders a banner onto the story derivative" in tests/publish-queue.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

vi.mock("../supabase/functions/publish-queue/tournament-freshness", () => ({
    legacyTournamentContentIssue: vi.fn().mockResolvedValue(null),
}));

import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

const mockSupabase = {
    from: vi.fn(),
    storage: { from: vi.fn() },
    rpc: vi.fn(),
};

class TestWorker extends PublishQueueWorker {
    protected async checkPublishHold(): Promise<null> {
        return null;
    }
    async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform, request);
    }
    async recoverStuckJobs() {
        return;
    }
    protected async recordHeartbeat() {
        return;
    }
    protected async ensureJobsForScheduledContent() {
        return;
    }
}

const ACCOUNT_ID = "acc-anchor";
const BOOKING_LINKS = {
    brief: {
        ctaLinks: {
            facebook: "https://l.the-anchor.pub/fb6e761f",
            instagram: "https://l.the-anchor.pub/ig6e761f",
        },
    },
};

type WebsiteLookup = { data: { website_url: string | null } | null; error: { code: string; message: string } | null };

interface ScenarioOptions {
    platform: "facebook" | "instagram";
    placement?: "feed" | "story";
    campaignType?: string;
    bannerEnabled?: boolean;
    /** Mocked only when the worker is expected to read it. */
    website?: WebsiteLookup;
}

// Dated from today so a label is always due whenever this runs: an event a
// month away, or a promotion that is running now.
function campaignMetadata(campaignType: string) {
    const today = DateTime.now().setZone("Europe/London");
    if (campaignType === "promotion") {
        return { startDate: today.minus({ days: 1 }).toISODate(), endDate: today.plus({ days: 10 }).toISODate() };
    }
    return { startDate: today.plus({ days: 30 }).toISODate(), startTime: "19:00" };
}

function chain(terminal: Record<string, unknown>) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ...terminal,
    };
}

/**
 * Queue the worker's database calls in order and capture what it sends to the
 * render route and to the provider.
 */
function setUpScenario(options: ScenarioOptions) {
    const placement = options.placement ?? "story";
    const mediaRow = {
        id: "media-1",
        storage_path: "media/original.jpg",
        media_type: "image",
        derived_variants: { story: "derived/media-1/story.jpg" },
    };

    // 1. Jobs fetch
    mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
            data: [{
                id: "job-1",
                content_item_id: "content-1",
                variant_id: "variant-1",
                status: "queued",
                attempt: 0,
                placement,
            }],
            error: null,
        }),
    });
    // 2. Lock
    mockSupabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
    });
    // 3. Content: due now, inside the story grace window
    mockSupabase.from.mockReturnValueOnce(chain({
        maybeSingle: vi.fn().mockResolvedValue({
            data: {
                id: "content-1",
                account_id: ACCOUNT_ID,
                status: "scheduled",
                platform: options.platform,
                placement,
                scheduled_for: new Date().toISOString(),
                prompt_context: BOOKING_LINKS,
                campaigns: {
                    name: "Snowball Showdown Cash Bingo",
                    campaign_type: options.campaignType ?? "event",
                    metadata: campaignMetadata(options.campaignType ?? "event"),
                },
            },
            error: null,
        }),
    }));
    // 4. Variant: event posts are written with the overlay on and no text
    mockSupabase.from.mockReturnValueOnce(chain({
        maybeSingle: vi.fn().mockResolvedValue({
            data: {
                id: "variant-1",
                content_item_id: "content-1",
                body: placement === "story" ? "" : "Snowball Showdown is back. Book now: https://l.the-anchor.pub/fb6e761f",
                media_ids: ["media-1"],
                banner_enabled: options.bannerEnabled ?? true,
                banner_text_override: null,
                banner_position: null,
                banner_bg: null,
                banner_text_colour: null,
            },
            error: null,
        }),
    }));
    // 5. Connection
    mockSupabase.from.mockReturnValueOnce(chain({
        maybeSingle: vi.fn().mockResolvedValue({
            data: {
                id: "conn-1",
                provider: options.platform,
                status: "active",
                access_token: "token",
                metadata: options.platform === "facebook" ? { pageId: "page-1" } : { igBusinessId: "ig-123" },
            },
            error: null,
        }),
    }));
    // 6. markContentStatus (publishing)
    mockSupabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
    });
    // 7. Posting defaults (resolveAndRenderBanner)
    mockSupabase.from.mockReturnValueOnce(chain({
        maybeSingle: vi.fn().mockResolvedValue({
            data: {
                banners_enabled: true,
                banner_position: "right",
                banner_bg: "#a57626",
                banner_text_colour: "#FFFFFF",
            },
            error: null,
        }),
    }));

    const willRender = options.bannerEnabled ?? true;
    if (willRender) {
        // 8. Source media for the render (story derivative for stories)
        mockSupabase.from.mockReturnValueOnce(chain({
            maybeSingle: vi.fn().mockResolvedValue({ data: mediaRow, error: null }),
        }));
    }

    // 9. Brand website, read only for a Facebook event story with a link
    let websiteEq: ReturnType<typeof vi.fn> | null = null;
    if (options.website) {
        websiteEq = vi.fn().mockReturnThis();
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: websiteEq,
            maybeSingle: vi.fn().mockResolvedValue(options.website),
        });
    }

    // 10. Media bulk fetch (loadMedia)
    mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        returns: vi.fn().mockResolvedValue({
            data: [{ ...mediaRow, mime_type: "image/jpeg", processed_status: null }],
            error: null,
        }),
    });
    // 11. After publishing: markJobSucceeded, markContentStatus(posted), notification
    mockSupabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockSupabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

    mockSupabase.storage.from.mockReturnValue({
        createSignedUrls: vi.fn().mockImplementation((paths: string[]) => Promise.resolve({
            data: paths.map((path) => ({ signedUrl: `https://mock.supabase.co/${path}`, path, error: null })),
            error: null,
        })),
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const renderBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        renderBodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    });

    return { renderBodies, websiteEq };
}

describe("PublishQueueWorker story booking prompt", () => {
    let worker: TestWorker;
    let publishSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSupabase.from.mockReset();
        mockSupabase.storage.from.mockReset();
        mockSupabase.rpc.mockReset();
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(createDefaultConfig(), mockSupabase as any);
        publishSpy = vi.spyOn(worker, "publishByPlatform").mockImplementation(async (platform) => ({
            platform,
            externalId: "post-123",
            payloadPreview: "",
            publishedAt: new Date().toISOString(),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("sends BOOK AT <the brand's domain> for a Facebook event story", async () => {
        const { renderBodies, websiteEq } = setUpScenario({
            platform: "facebook",
            website: { data: { website_url: "https://www.the-anchor.pub" }, error: null },
        });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(renderBodies).toHaveLength(1);
        expect(renderBodies[0].storyPrompt).toBe("BOOK AT THE-ANCHOR.PUB");
        // The website read is scoped to the post's brand.
        expect(mockSupabase.from).toHaveBeenCalledWith("link_in_bio_profiles");
        expect(websiteEq).toHaveBeenCalledWith("account_id", ACCOUNT_ID);
    });

    it("sends LINK IN BIO TO BOOK for an Instagram event story without reading the website", async () => {
        const { renderBodies } = setUpScenario({ platform: "instagram" });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(renderBodies[0].storyPrompt).toBe("LINK IN BIO TO BOOK");
        expect(mockSupabase.from).not.toHaveBeenCalledWith("link_in_bio_profiles");
    });

    it("still publishes, with the generic Facebook text, when the website read fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { renderBodies } = setUpScenario({
            platform: "facebook",
            website: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
        });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(renderBodies[0].storyPrompt).toBe("SEE OUR PAGE TO BOOK");
        expect(consoleError).toHaveBeenCalledWith(
            "[publish-queue] brand website lookup failed; story uses the generic booking prompt",
            expect.objectContaining({ contentId: "content-1", code: "57014" }),
        );
    });

    it("sends no prompt for an event feed post", async () => {
        const { renderBodies } = setUpScenario({ platform: "facebook", placement: "feed" });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(renderBodies[0].storyPrompt).toBeNull();
        expect(renderBodies[0].label).toEqual(expect.any(String));
        expect(mockSupabase.from).not.toHaveBeenCalledWith("link_in_bio_profiles");
    });

    it("sends no prompt for a story that is not an event", async () => {
        const { renderBodies } = setUpScenario({ platform: "instagram", campaignType: "promotion" });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        // The running promotion still gets its strip, without a prompt.
        expect(renderBodies).toHaveLength(1);
        expect(renderBodies[0].label).toBe("1 WEEK LEFT");
        expect(renderBodies[0].storyPrompt).toBeNull();
        expect(mockSupabase.from).not.toHaveBeenCalledWith("link_in_bio_profiles");
    });

    it("draws nothing when the story's overlay is switched off", async () => {
        const { renderBodies } = setUpScenario({ platform: "facebook", bannerEnabled: false });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(renderBodies).toHaveLength(0);
        expect(mockSupabase.from).not.toHaveBeenCalledWith("link_in_bio_profiles");
    });
});
