import { describe, expect, it, vi, beforeEach } from "vitest";
import { PublishQueueWorker, createDefaultConfig } from "../supabase/functions/publish-queue/worker";
import type { ProviderPublishRequest, ProviderPublishResult } from "../supabase/functions/publish-queue/providers/types";

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
    async publishByPlatform(platform: string, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        return super.publishByPlatform(platform as any, request);
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
