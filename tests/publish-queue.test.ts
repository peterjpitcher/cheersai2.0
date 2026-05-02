import { describe, expect, it, vi, beforeEach } from "vitest";
import { PublishQueueWorker, createDefaultConfig, getBannerPublishBlockReason } from "../supabase/functions/publish-queue/worker";
import type { ProviderPlatform, ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

// Mock Supabase Client
const mockSupabase = {
    from: vi.fn(),
    storage: {
        from: vi.fn(),
    },
    rpc: vi.fn(),
};

// Test-specific Worker subclass to override protected methods
class TestWorker extends PublishQueueWorker {
    // Spy on this method to inject responses
    async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform, request);
    }

    // Stub recovery to avoid breaking existing test mocks
    async recoverStuckJobs() {
        return;
    }

    protected async recordHeartbeat() {
        return;
    }

    protected async ensureJobsForScheduledContent() {
        return;
    }

    // Expose real implementation for testing
    public async testEnsureJobsForScheduledContent(windowIso: string, nowIso: string) {
        return PublishQueueWorker.prototype["ensureJobsForScheduledContent"].call(this, windowIso, nowIso);
    }
}

describe("PublishQueueWorker", () => {
    let worker: TestWorker;
    const config = createDefaultConfig();

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);

        // Default mocks
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    describe("banner publish guard", () => {
        type GuardContent = Parameters<typeof getBannerPublishBlockReason>[0];
        const content: GuardContent = {
            id: "content-1",
            account_id: "acc-1",
            platform: "facebook",
            placement: "feed",
            scheduled_for: "2026-04-28T06:30:00.000Z",
            prompt_context: {
                banner: {
                    schemaVersion: 1,
                    enabled: true,
                    position: "right",
                    bgColour: "gold",
                    textColour: "white",
                },
            },
            campaigns: {
                name: "Cash Bingo",
                campaign_type: "event",
                metadata: {
                    eventStart: "2026-04-29T18:00:00.000Z",
                },
            },
        };
        const promotionContent = (scheduledFor: string, endDate: string | null): GuardContent => ({
            ...content,
            scheduled_for: scheduledFor,
            campaigns: {
                name: "Manager's Special",
                campaign_type: "promotion",
                metadata: {
                    startDate: "2026-05-01T00:00:00.000+01:00",
                    ...(endDate ? { endDate } : {}),
                },
            },
        });

        it.each(["none", "expected", "stale"])("blocks %s banner state when a label is due", (bannerState) => {
            expect(getBannerPublishBlockReason(
                content,
                { banner_state: bannerState, bannered_media_path: null },
            )).toContain("expected but not rendered");
        });

        it("blocks rendered state without a stored banner path", () => {
            expect(getBannerPublishBlockReason(
                content,
                { banner_state: "rendered", bannered_media_path: null },
            )).toBe("Banner state is rendered but no bannered media path was stored");
        });

        it("blocks rendered state for a stale schedule", () => {
            expect(getBannerPublishBlockReason(
                content,
                {
                    banner_state: "rendered",
                    bannered_media_path: "banners/content-1/variant-1.jpg",
                    banner_rendered_for_scheduled_at: "2026-04-27T06:30:00.000Z",
                    banner_source_media_path: "source.jpg",
                },
            )).toBe("Banner render is stale for the current schedule");
        });

        it("blocks rendered state without a source media marker", () => {
            expect(getBannerPublishBlockReason(
                content,
                {
                    banner_state: "rendered",
                    bannered_media_path: "banners/content-1/variant-1.jpg",
                    banner_rendered_for_scheduled_at: content.scheduled_for,
                },
            )).toBe("Banner render is missing its source media marker");
        });

        it("allows rendered state with matching schedule and source marker", () => {
            expect(getBannerPublishBlockReason(
                content,
                {
                    banner_state: "rendered",
                    bannered_media_path: "banners/content-1/variant-1.jpg",
                    banner_rendered_for_scheduled_at: content.scheduled_for,
                    banner_source_media_path: "source.jpg",
                },
            )).toBeNull();
        });

        it("allows not_applicable when no label is due", () => {
            expect(getBannerPublishBlockReason(
                {
                    ...content,
                    scheduled_for: "2026-04-10T06:30:00.000Z",
                },
                { banner_state: "not_applicable", bannered_media_path: null },
            )).toBeNull();
        });

        it("uses week countdown labels for promotion banners", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-06T09:00:00.000Z", "2026-06-10T00:00:00.000+01:00"),
                { banner_state: "expected", bannered_media_path: null },
            )).toContain("5 WEEKS LEFT");
        });

        it("uses day countdown labels for promotion banners", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-18T09:00:00.000Z", "2026-05-20T00:00:00.000+01:00"),
                { banner_state: "expected", bannered_media_path: null },
            )).toContain("2 DAYS LEFT");
        });

        it("uses ENDS TOMORROW for promotion banners one day before end", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-19T09:00:00.000Z", "2026-05-20T00:00:00.000+01:00"),
                { banner_state: "expected", bannered_media_path: null },
            )).toContain("ENDS TOMORROW");
        });

        it("uses LAST DAY for promotion banners on the end date", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-20T09:00:00.000Z", "2026-05-20T00:00:00.000+01:00"),
                { banner_state: "expected", bannered_media_path: null },
            )).toContain("LAST DAY");
        });

        it("does not require a promotion banner after the end date", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-21T09:00:00.000Z", "2026-05-20T00:00:00.000+01:00"),
                { banner_state: "not_applicable", bannered_media_path: null },
            )).toBeNull();
        });

        it("keeps ON NOW for legacy promotion banners without an end date", () => {
            expect(getBannerPublishBlockReason(
                promotionContent("2026-05-10T09:00:00.000Z", null),
                { banner_state: "expected", bannered_media_path: null },
            )).toContain("ON NOW");
        });
    });

    describe("processDueJobs", () => {
        it("handles empty queue gracefully", async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(0);
        });

        it("processes a valid facebook job successfully", async () => {
            // 1. Mock jobs fetch
            const job = {
                id: "job-1",
                content_item_id: "content-1",
                variant_id: "variant-1",
                status: "queued",
                attempt: 0,
                placement: "feed",
            };

            mockSupabase.from.mockReturnValueOnce({ // select jobs
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
            });

            // 2. Mock lockJob
            mockSupabase.from.mockReturnValueOnce({ // update status=in_progress
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
            });

            // 3. Mock loadContent
            mockSupabase.from.mockReturnValueOnce({ // select content
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "content-1",
                        account_id: "acc-1",
                        platform: "facebook",
                        placement: "feed",
                        prompt_context: {},
                        campaigns: null
                    },
                    error: null
                }),
            });

            // 4. Mock loadVariant
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "variant-1", content_item_id: "content-1", body: "Hello World", media_ids: [] }, error: null }),
            });

            // 5. Mock loadConnection
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-1",
                        provider: "facebook",
                        status: "active",
                        access_token: "token",
                        metadata: { pageId: "123" }
                    },
                    error: null
                }),
            });

            // 6. Mock markContentStatus (publishing)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });

            // 7. Mock publishByPlatform (Stub the response)
            const publishSpy = vi.spyOn(worker, 'publishByPlatform').mockResolvedValue({
                platform: 'facebook',
                externalId: 'post-123',
                payloadPreview: 'Hello World',
                publishedAt: new Date().toISOString()
            });

            // 8. Mock markJobSucceeded
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 9. Mock markContentStatus (posted)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 10. Mock insertNotification
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).toHaveBeenCalled();
        });

        it("handles retry logic on network failure", async () => {
            // 1. Mock jobs fetch
            const job = { id: "job-2", content_item_id: "content-2", variant_id: "variant-2", status: "queued", attempt: 0, placement: "feed" };
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [job], error: null }) });

            // 2. Lock
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-2" }, error: null }) });

            // 3. Content
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "content-2", account_id: "acc-1", platform: "facebook", placement: "feed" }, error: null }) });
            // 4. Variant
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "variant-2", content_item_id: "content-2", body: "Retry me", media_ids: [] }, error: null }) });
            // 5. Connection
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conn-1", provider: "facebook", status: "active", access_token: "token", metadata: { pageId: "123" } }, error: null }) });
            // 6. Status publishing
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });

            // 7. Publish fails
            vi.spyOn(worker, 'publishByPlatform').mockRejectedValue(new Error("Network Error"));

            // 8. Handle Failure -> Reschedule
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }); // Update job
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }); // Update content status
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) }); // Notification

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(result.results?.[0]?.status).toBe('processed'); // Handled gracefully (retried)
        });

        it("retries instagram story publish when Meta media id is temporarily unavailable", async () => {
            const nowIso = new Date().toISOString();
            const job = {
                id: "job-story-1",
                content_item_id: "content-story-1",
                variant_id: "variant-story-1",
                status: "queued",
                attempt: 0,
                placement: "story",
            };

            // 1. Mock jobs fetch
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
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-story-1" }, error: null }),
            });

            // 3. Content
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "content-story-1",
                        account_id: "acc-1",
                        platform: "instagram",
                        placement: "story",
                        scheduled_for: nowIso,
                        prompt_context: {},
                        campaigns: null,
                    },
                    error: null,
                }),
            });

            // 4. Variant
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "variant-story-1", content_item_id: "content-story-1", body: "", media_ids: [] },
                    error: null,
                }),
            });

            // 5. Connection
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-ig-1",
                        provider: "instagram",
                        status: "active",
                        access_token: "token",
                        metadata: { igBusinessId: "ig-123" },
                    },
                    error: null,
                }),
            });

            // 6. markContentStatus (publishing)
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });

            // 7. Provider publish fails with transient 9007
            vi.spyOn(worker, "publishByPlatform").mockRejectedValue(
                new Error("OAuthException: Media ID is not available (code 9007)"),
            );

            const retryJobUpdate = vi.fn().mockReturnThis();

            // 8. publish_jobs reschedule
            mockSupabase.from.mockReturnValueOnce({
                update: retryJobUpdate,
                eq: vi.fn().mockResolvedValue({ error: null }),
            });

            // 9. markContentStatus (scheduled)
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });

            const insertNotification = vi.fn().mockResolvedValue({ error: null });

            // 10. retry notification
            mockSupabase.from.mockReturnValueOnce({
                insert: insertNotification,
            });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(result.results?.[0]?.status).toBe("processed");

            expect(retryJobUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: "queued",
                    last_error: "OAuthException: Media ID is not available (code 9007)",
                }),
            );

            expect(insertNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    category: "story_publish_retry",
                }),
            );
        });

        it("backfills missing jobs for scheduled content", async () => {
            const now = new Date();
            const windowIso = new Date(now.getTime() + 5 * 60000).toISOString();
            const nowIso = now.toISOString();

            // 1. Mock scheduled content
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({
                    data: [{ id: "content-missing-job", scheduled_for: nowIso, placement: "feed" }],
                    error: null
                }),
            });

            // 2. Mock existing jobs check (return empty)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            // 3. Mock variants fetch (return multiple to test sorting)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        { id: "variant-latest", content_item_id: "content-missing-job", updated_at: "2024-01-02" },
                        { id: "variant-old", content_item_id: "content-missing-job", updated_at: "2024-01-01" }
                    ],
                    error: null
                }),
            });

            // 4. Mock insert
            const insertMock = vi.fn().mockResolvedValue({ error: null });
            mockSupabase.from.mockReturnValueOnce({
                insert: insertMock,
            });

            await worker.testEnsureJobsForScheduledContent(windowIso, nowIso);

            expect(insertMock).toHaveBeenCalledWith([
                expect.objectContaining({
                    content_item_id: "content-missing-job",
                    variant_id: "variant-latest", // Should pick the first one from the ordered list
                    status: "queued"
                })
            ]);
        });
    });
});
