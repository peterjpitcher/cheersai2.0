import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import { MetaGraphApiError } from "../supabase/functions/publish-queue/providers/meta-error";
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
        mockSupabase.from.mockReset();
        mockSupabase.storage.from.mockReset();
        mockSupabase.rpc.mockReset();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker = new TestWorker(config, mockSupabase as any);

        // Default mocks
        mockSupabase.rpc.mockResolvedValue({ data: { context: "test" }, error: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

            // 4. Mock loadVariant — banner override columns all null (banner disabled by default since no posting_defaults loaded)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-1",
                        content_item_id: "content-1",
                        body: "Hello World",
                        media_ids: [],
                        banner_enabled: null,
                        banner_text_override: null,
                        banner_position: null,
                        banner_bg: null,
                        banner_text_colour: null,
                    },
                    error: null,
                }),
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

            // 7. Mock posting_defaults lookup (banner preflight): no row → renderBannerPreflight short-circuits.
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

            // 8. Mock publishByPlatform (Stub the response)
            const publishSpy = vi.spyOn(worker, 'publishByPlatform').mockResolvedValue({
                platform: 'facebook',
                externalId: 'post-123',
                payloadPreview: 'Hello World',
                publishedAt: new Date().toISOString()
            });

            // 9. Mock markJobSucceeded
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 10. Mock markContentStatus (posted)
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 11. Mock insertNotification
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
            // 4. Variant — banner override columns all null
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-2",
                        content_item_id: "content-2",
                        body: "Retry me",
                        media_ids: [],
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
            mockSupabase.from.mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conn-1", provider: "facebook", status: "active", access_token: "token", metadata: { pageId: "123" } }, error: null }) });
            // 6. Status publishing
            mockSupabase.from.mockReturnValueOnce({ update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) });
            // 6b. Posting defaults lookup (banner preflight): no row → short-circuit
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

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

            // 4. Variant — banner override columns all null
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-story-1",
                        content_item_id: "content-story-1",
                        body: "",
                        media_ids: [],
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

            // 6b. Posting defaults lookup (banner preflight): no row → short-circuit
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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

        it("retries ambiguous instagram story code 100 when connection probes healthy", async () => {
            const nowIso = new Date().toISOString();
            const job = {
                id: "job-story-code-100",
                content_item_id: "content-story-code-100",
                variant_id: "variant-story-code-100",
                status: "queued",
                attempt: 0,
                placement: "story",
            };

            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: job.content_item_id,
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
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: job.variant_id,
                        content_item_id: job.content_item_id,
                        body: "",
                        media_ids: [],
                        banner_enabled: null,
                        banner_text_override: null,
                        banner_position: null,
                        banner_bg: null,
                        banner_text_colour: null,
                    },
                    error: null,
                }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-ig-healthy",
                        provider: "instagram",
                        status: "active",
                        access_token: "token",
                        metadata: { igBusinessId: "ig-123" },
                    },
                    error: null,
                }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

            vi.spyOn(worker, "publishByPlatform").mockRejectedValue(
                new MetaGraphApiError(400, {
                    error: {
                        message: "Authorization Error",
                        type: "GraphMethodException",
                        code: 100,
                        fbtrace_id: "trace-code-100",
                    },
                }, "instagram_create_container"),
            );

            const fetchSpy = vi.spyOn(globalThis, "fetch")
                .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ig-123", username: "theanchor.pub" }), { status: 200 }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ quota_usage: 0 }] }), { status: 200 }));

            const retryJobUpdate = vi.fn().mockReturnThis();
            mockSupabase.from.mockReturnValueOnce({
                update: retryJobUpdate,
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            const insertNotification = vi.fn().mockResolvedValue({ error: null });
            mockSupabase.from.mockReturnValueOnce({ insert: insertNotification });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(fetchSpy).toHaveBeenCalledTimes(2);
            expect(retryJobUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: "queued",
                    last_error: expect.stringContaining("code 100"),
                }),
            );
            expect(insertNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    category: "story_publish_retry",
                    metadata: expect.objectContaining({
                        graph: expect.objectContaining({
                            code: 100,
                            phase: "instagram_create_container",
                            fbtrace_id: "trace-code-100",
                        }),
                    }),
                }),
            );
            expect(mockSupabase.from.mock.calls.filter(([table]) => table === "social_connections")).toHaveLength(1);
            fetchSpy.mockRestore();
        });

        it("marks instagram connection needs_action for explicit token failures", async () => {
            const nowIso = new Date().toISOString();
            const job = {
                id: "job-story-token-expired",
                content_item_id: "content-story-token-expired",
                variant_id: "variant-story-token-expired",
                status: "queued",
                attempt: 0,
                placement: "story",
            };

            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: job.content_item_id,
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
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: job.variant_id,
                        content_item_id: job.content_item_id,
                        body: "",
                        media_ids: [],
                        banner_enabled: null,
                        banner_text_override: null,
                        banner_position: null,
                        banner_bg: null,
                        banner_text_colour: null,
                    },
                    error: null,
                }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "conn-ig-expired",
                        provider: "instagram",
                        status: "active",
                        access_token: "token",
                        metadata: { igBusinessId: "ig-123" },
                    },
                    error: null,
                }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            });

            vi.spyOn(worker, "publishByPlatform").mockRejectedValue(
                new MetaGraphApiError(401, {
                    error: {
                        message: "Invalid OAuth 2.0 Access Token",
                        type: "OAuthException",
                        code: 190,
                        fbtrace_id: "trace-token",
                    },
                }, "instagram_create_container"),
            );
            const fetchSpy = vi.spyOn(globalThis, "fetch");

            const failureJobUpdate = vi.fn().mockReturnThis();
            mockSupabase.from.mockReturnValueOnce({
                update: failureJobUpdate,
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const connectionUpdate = vi.fn().mockReturnThis();
            mockSupabase.from.mockReturnValueOnce({
                update: connectionUpdate,
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(failureJobUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: "failed",
                    last_error: expect.stringContaining("code 190"),
                }),
            );
            expect(connectionUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: "needs_action",
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

    describe("banner preflight render", () => {
        function buildBaselineMocks(opts: {
            bannerOverride?: Partial<{
                banner_enabled: boolean | null;
                banner_text_override: string | null;
                banner_position: "top" | "bottom" | "left" | "right" | null;
                banner_bg: string | null;
                banner_text_colour: string | null;
            }>;
            postingDefaults?: {
                banners_enabled: boolean;
                banner_position: "top" | "bottom" | "left" | "right";
                banner_bg: string;
                banner_text_colour: string;
            } | null;
            postingDefaultsError?: { message: string } | null;
            mediaId?: string;
            campaigns?: { campaign_type: string; metadata: Record<string, unknown> } | null;
            scheduledFor?: string | null;
            includeSourceMediaLookup?: boolean;
        }) {
            const job = {
                id: "job-banner",
                content_item_id: "content-banner",
                variant_id: "variant-banner",
                status: "queued",
                attempt: 0,
                placement: "feed" as const,
            };
            const mediaId = opts.mediaId ?? "media-1";
            const campaigns = opts.campaigns ?? {
                campaign_type: "event",
                metadata: { eventStart: "2026-04-29T18:00:00.000+01:00", startTime: "18:00" },
            };
            // Schedule earlier the same day so getProximityLabel returns "TONIGHT".
            const scheduledFor = opts.scheduledFor ?? "2026-04-29T08:00:00.000+01:00";

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
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-banner" }, error: null }),
            });
            // 3. Content
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "content-banner",
                        account_id: "acc-banner",
                        platform: "facebook",
                        placement: "feed",
                        scheduled_for: scheduledFor,
                        prompt_context: {},
                        campaigns,
                    },
                    error: null,
                }),
            });
            // 4. Variant — has media + banner overrides
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                        id: "variant-banner",
                        content_item_id: "content-banner",
                        body: "Banner test",
                        media_ids: [mediaId],
                        banner_enabled: opts.bannerOverride?.banner_enabled ?? null,
                        banner_text_override: opts.bannerOverride?.banner_text_override ?? null,
                        banner_position: opts.bannerOverride?.banner_position ?? null,
                        banner_bg: opts.bannerOverride?.banner_bg ?? null,
                        banner_text_colour: opts.bannerOverride?.banner_text_colour ?? null,
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
                        id: "conn-banner",
                        provider: "facebook",
                        status: "active",
                        access_token: "token",
                        metadata: { pageId: "page-1" },
                    },
                    error: null,
                }),
            });
            // 6. markContentStatus (publishing)
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            // 7. Posting defaults lookup (resolveAndRenderBanner — runs first)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.postingDefaultsError
                        ? null
                        : opts.postingDefaults === null
                            ? null
                            : (opts.postingDefaults ?? {
                                banners_enabled: true,
                                banner_position: "bottom",
                                banner_bg: "#000000",
                                banner_text_colour: "#FFFFFF",
                            }),
                    error: opts.postingDefaultsError ?? null,
                }),
            });
            // 8. media_assets lookup (resolveSourceMediaPath — only called when config.enabled)
            if (opts.includeSourceMediaLookup !== false) {
                mockSupabase.from.mockReturnValueOnce({
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                            id: mediaId,
                            storage_path: "media/source.jpg",
                            media_type: "image",
                            derived_variants: null,
                        },
                        error: null,
                    }),
                });
            }
            return { job, mediaId };
        }

        it("fails the job with BANNER_RENDER_FAILED and never calls the platform when render endpoint fails", async () => {
            buildBaselineMocks({});

            // Storage: signing source URL succeeds; we'll force the render endpoint
            // POST to fail to trigger the BANNER_RENDER_FAILED path.
            mockSupabase.storage.from.mockReturnValue({
                createSignedUrls: vi.fn().mockResolvedValue({
                    data: [{ signedUrl: "https://example.com/source.jpg", path: "media/source.jpg", error: null }],
                    error: null,
                }),
                upload: vi.fn().mockResolvedValue({ data: null, error: null }),
            });
            // The worker now POSTs the signed source URL to the Next.js render
            // endpoint instead of downloading and rendering inline. Force that
            // POST to return 503.
            const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
                new Response("nope", { status: 503 }),
            );

            const publishSpy = vi.spyOn(worker, "publishByPlatform");

            // 9. handleFailure path: publish_jobs update
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            // 10. markContentStatus (failed/scheduled)
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            // 11. notification
            const notificationInsert = vi.fn().mockResolvedValue({ error: null });
            mockSupabase.from.mockReturnValueOnce({ insert: notificationInsert });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).not.toHaveBeenCalled();
            expect(notificationInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        error: expect.stringContaining("BANNER_RENDER_FAILED"),
                    }),
                }),
            );
            // Verify the worker called the render endpoint with auth + JSON body
            // (it should have hit the configured render URL exactly once).
            expect(fetchSpy).toHaveBeenCalledWith(
                "http://localhost/api/internal/render-banner",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        authorization: expect.stringMatching(/^Bearer /),
                        "content-type": "application/json",
                    }),
                }),
            );

            fetchSpy.mockRestore();
        });

        it("skips render entirely when banners disabled at account level and no override", async () => {
            buildBaselineMocks({
                postingDefaults: {
                    banners_enabled: false,
                    banner_position: "bottom",
                    banner_bg: "#000000",
                    banner_text_colour: "#FFFFFF",
                },
                includeSourceMediaLookup: false,
            });

            // Storage: only the signed-URL call for the existing source media will run via loadMedia.
            // (loadMedia normalises "media/source.jpg" to "source.jpg" before signing.)
            const createSignedUrls = vi.fn().mockResolvedValue({
                data: [{ signedUrl: "https://example.com/source.jpg", path: "source.jpg", error: null }],
                error: null,
            });
            const upload = vi.fn();
            mockSupabase.storage.from.mockReturnValue({
                createSignedUrls,
                upload,
            });

            // 9. media_assets bulk fetch (loadMedia)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({
                    data: [{
                        id: "media-1",
                        storage_path: "media/source.jpg",
                        media_type: "image",
                        mime_type: "image/jpeg",
                        derived_variants: null,
                        processed_status: null,
                    }],
                    error: null,
                }),
            });

            const publishSpy = vi.spyOn(worker, "publishByPlatform").mockResolvedValue({
                platform: "facebook",
                externalId: "post-123",
                payloadPreview: "Banner test",
                publishedAt: new Date().toISOString(),
            });

            // markJobSucceeded
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            // markContentStatus (posted)
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            // notification
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).toHaveBeenCalled();
            // The render path uploads under banners/...; account-disabled path must never upload.
            expect(upload).not.toHaveBeenCalled();
        });

        // F2: a transient error fetching posting_defaults must not silently
        // publish without the requested banner — the job must fail with
        // BANNER_RENDER_FAILED and the platform must never be invoked.
        it("fails the job with BANNER_RENDER_FAILED when posting_defaults query errors", async () => {
            buildBaselineMocks({
                postingDefaultsError: { message: "connection refused" },
                includeSourceMediaLookup: false,
            });

            // No storage mocks needed — we bail before signing source URL.
            mockSupabase.storage.from.mockReturnValue({
                createSignedUrls: vi.fn(),
                upload: vi.fn(),
            });

            const fetchSpy = vi.spyOn(globalThis, "fetch");
            const publishSpy = vi.spyOn(worker, "publishByPlatform");

            // handleFailure path: publish_jobs update, markContentStatus, notification
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

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            expect(publishSpy).not.toHaveBeenCalled();
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(notificationInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        error: expect.stringContaining("BANNER_RENDER_FAILED: posting_defaults query failed"),
                    }),
                }),
            );
        });

        // F2: when the posting_defaults row is missing, the worker must fall
        // back to the SQL DEFAULTs (banners_enabled=true, etc.) so the banner
        // still renders on accounts that have never customised defaults.
        it("renders a banner using SQL DEFAULTS when posting_defaults row is missing", async () => {
            buildBaselineMocks({
                postingDefaults: null,
                campaigns: {
                    campaign_type: "event",
                    metadata: { eventStart: "2026-04-29T18:00:00.000+01:00", startTime: "18:00" },
                },
                scheduledFor: "2026-04-29T08:00:00.000+01:00",
            });

            // Storage: signing returns whichever path was asked for, so both
            // the source-URL sign and the loadMedia sign succeed.
            const upload = vi.fn().mockResolvedValue({ data: null, error: null });
            const createSignedUrls = vi.fn().mockImplementation((paths: string[]) => Promise.resolve({
                data: paths.map((path) => ({
                    signedUrl: `https://example.com/${path}`,
                    path,
                    error: null,
                })),
                error: null,
            }));
            mockSupabase.storage.from.mockReturnValue({ createSignedUrls, upload });

            // Render endpoint succeeds — return any bytes; the worker just uploads them.
            const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
                new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
            );

            // loadMedia bulk fetch
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({
                    data: [{
                        id: "media-1",
                        storage_path: "media/source.jpg",
                        media_type: "image",
                        mime_type: "image/jpeg",
                        derived_variants: null,
                        processed_status: null,
                    }],
                    error: null,
                }),
            });

            const publishSpy = vi.spyOn(worker, "publishByPlatform").mockResolvedValue({
                platform: "facebook",
                externalId: "post-123",
                payloadPreview: "Banner test",
                publishedAt: new Date().toISOString(),
            });

            // markJobSucceeded, markContentStatus(posted), notification
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            });
            mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

            const result = await worker.processDueJobs();
            expect(result.processed).toBe(1);
            // The render endpoint should have been called — defaults make banners enabled.
            expect(fetchSpy).toHaveBeenCalledWith(
                "http://localhost/api/internal/render-banner",
                expect.objectContaining({ method: "POST" }),
            );
            // Upload of the rendered banner should have happened.
            expect(upload).toHaveBeenCalled();
            // Platform publish should have been called.
            expect(publishSpy).toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it("BANNER_OVERLAY_DISABLED env var skips banner rendering and uploads source media", async () => {
            process.env.BANNER_OVERLAY_DISABLED = "true";
            try {
                const job = {
                    id: "job-banner",
                    content_item_id: "content-banner",
                    variant_id: "variant-banner",
                    status: "queued",
                    attempt: 0,
                    placement: "feed" as const,
                };

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
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-banner" }, error: null }),
                });
                // 3. Content
                mockSupabase.from.mockReturnValueOnce({
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                            id: "content-banner",
                            account_id: "acc-banner",
                            platform: "facebook",
                            placement: "feed",
                            scheduled_for: "2026-04-29T08:00:00.000+01:00",
                            prompt_context: {},
                            campaigns: {
                                campaign_type: "event",
                                metadata: { eventStart: "2026-04-29T18:00:00.000+01:00", startTime: "18:00" },
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
                            id: "variant-banner",
                            content_item_id: "content-banner",
                            body: "Banner test",
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
                            id: "conn-banner",
                            provider: "facebook",
                            status: "active",
                            access_token: "token",
                            metadata: { pageId: "page-1" },
                        },
                        error: null,
                    }),
                });
                // 6. markContentStatus (publishing)
                mockSupabase.from.mockReturnValueOnce({
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                // (No posting_defaults mock — kill switch fires first.)
                // 7. loadMedia bulk fetch
                mockSupabase.from.mockReturnValueOnce({
                    select: vi.fn().mockReturnThis(),
                    in: vi.fn().mockReturnThis(),
                    returns: vi.fn().mockResolvedValue({
                        data: [{
                            id: "media-1",
                            storage_path: "media/source.jpg",
                            media_type: "image",
                            mime_type: "image/jpeg",
                            derived_variants: null,
                            processed_status: null,
                        }],
                        error: null,
                    }),
                });

                // Storage signed URLs for source media path only — no banner upload.
                const upload = vi.fn().mockResolvedValue({ data: null, error: null });
                const createSignedUrls = vi.fn().mockImplementation((paths: string[]) =>
                    Promise.resolve({
                        data: paths.map((path) => ({
                            signedUrl: `https://example.com/${path}`,
                            path,
                            error: null,
                        })),
                        error: null,
                    }),
                );
                mockSupabase.storage.from.mockReturnValue({ createSignedUrls, upload });

                const fetchSpy = vi.spyOn(globalThis, "fetch");

                const publishSpy = vi.spyOn(worker, "publishByPlatform").mockResolvedValue({
                    platform: "facebook",
                    externalId: "post-123",
                    payloadPreview: "Banner test",
                    publishedAt: new Date().toISOString(),
                });

                // markJobSucceeded, markContentStatus(posted), notification
                mockSupabase.from.mockReturnValueOnce({
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                mockSupabase.from.mockReturnValueOnce({
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                mockSupabase.from.mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) });

                const result = await worker.processDueJobs();

                expect(result.processed).toBe(1);
                // The render endpoint should NEVER have been called.
                expect(fetchSpy).not.toHaveBeenCalled();
                // The banner upload path should NOT have happened.
                expect(upload).not.toHaveBeenCalled();
                // Platform publish should still have been called with the source media.
                expect(publishSpy).toHaveBeenCalled();
            } finally {
                delete process.env.BANNER_OVERLAY_DISABLED;
            }
        });

    });
});
