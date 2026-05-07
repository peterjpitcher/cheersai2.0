// F3: this file lives separately so we can vi.mock the banner-label module
// (the worker imports it with a .ts extension) without disrupting the rest
// of the publish-queue test suite. The fix being verified:
// when extractCampaignTiming or getProximityLabel throws, the error must NOT
// be swallowed — it must rethrow as BANNER_RENDER_FAILED so the job fails
// without invoking any platform.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks so the worker import below sees them.
const { extractCampaignTimingMock, getProximityLabelMock } = vi.hoisted(() => ({
    extractCampaignTimingMock: vi.fn(),
    getProximityLabelMock: vi.fn(),
}));

vi.mock("../supabase/functions/publish-queue/banner-label.ts", () => ({
    extractCampaignTiming: extractCampaignTimingMock,
    getProximityLabel: getProximityLabelMock,
}));

import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

// Minimal mock supabase shape — we only call .from() returning chainable thenables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSupabase: any = {
    from: vi.fn(),
    storage: { from: vi.fn() },
    rpc: vi.fn(),
};

class TestWorker extends PublishQueueWorker {
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

describe("PublishQueueWorker — F3 label compute throw", () => {
    let worker: TestWorker;
    const config = createDefaultConfig();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rethrows label-compute errors as BANNER_RENDER_FAILED and never publishes", async () => {
        const job = {
            id: "job-label-throw",
            content_item_id: "content-label-throw",
            variant_id: "variant-label-throw",
            status: "queued",
            attempt: 0,
            placement: "feed" as const,
        };

        // Make the label compute throw mid-flight. This is the precise condition
        // that the F3 fix turns from a silent swallow into a hard failure.
        getProximityLabelMock.mockImplementation(() => {
            throw new Error("boom");
        });
        extractCampaignTimingMock.mockReturnValue({
            campaignType: "event",
            startAt: { setZone: () => ({}) },
            timezone: "Europe/London",
        });

        // 1. Jobs fetch
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        });
        // 2. Lock
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        });
        // 3. Content (with a campaign so the label code runs)
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: job.content_item_id,
                    account_id: "acc",
                    platform: "facebook",
                    placement: "feed",
                    scheduled_for: "2026-04-29T08:00:00.000+01:00",
                    prompt_context: {},
                    campaigns: {
                        campaign_type: "event",
                        metadata: { startDate: "2026-04-29", startTime: "18:00" },
                    },
                },
                error: null,
            }),
        });
        // 4. Variant
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: job.variant_id,
                    content_item_id: job.content_item_id,
                    body: "x",
                    media_ids: ["media-1"],
                    banner_enabled: null,
                    banner_text_override: null,
                    banner_position: null,
                    banner_bg: null,
                    banner_text_colour: null,
                },
                error: null,
            }),
        });
        // 5. Connection
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: "conn",
                    provider: "facebook",
                    status: "active",
                    access_token: "t",
                    metadata: { pageId: "p" },
                },
                error: null,
            }),
        });
        // 6. markContentStatus(publishing)
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        // 7. posting_defaults — return defaults so banner is enabled and we
        //    enter the label-compute path that we forced to throw.
        mockSupabase.from.mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    banners_enabled: true,
                    banner_position: "bottom",
                    banner_bg: "#000000",
                    banner_text_colour: "#FFFFFF",
                },
                error: null,
            }),
        });

        // 8/9/10 — handleFailure path: publish_jobs.update, content.status, notification
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        mockSupabase.from.mockReturnValueOnce({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });
        const notificationInsert = vi.fn().mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValueOnce({ insert: notificationInsert });

        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const publishSpy = vi.spyOn(worker, "publishByPlatform");

        const result = await worker.processDueJobs();
        expect(result.processed).toBe(1);
        expect(publishSpy).not.toHaveBeenCalled();
        // The render endpoint should never be reached when label compute fails.
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(notificationInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    error: expect.stringContaining("BANNER_RENDER_FAILED: label computation failed"),
                }),
            }),
        );
    });
});
