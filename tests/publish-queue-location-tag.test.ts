import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderPublishRequest } from "../supabase/functions/publish-queue/providers/types";

/**
 * B5 (tasks/SPEC-instagram-location-tag.md): Instagram feed posts carry the venue's location, the
 * Facebook Page saved in Settings, and a location Instagram refuses never stops the post.
 */

vi.mock("../supabase/functions/publish-queue/tournament-freshness", () => ({
    legacyTournamentContentIssue: vi.fn().mockResolvedValue(null),
}));

const PAGE_ID = "628953850871830";

function response(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

function request(payload: Partial<ProviderPublishRequest["payload"]> = {}, placement: "feed" | "story" = "feed"): ProviderPublishRequest {
    return {
        payload: {
            body: "Five rounds of cash bingo.",
            media: [{ id: "media-1", url: "https://cdn.example.com/post.jpg", mediaType: "image", mimeType: "image/jpeg" }],
            placement,
            locationPageId: PAGE_ID,
            ...payload,
        },
        auth: { connectionId: "connection-1", accessToken: "fixture-access-token" },
        accountId: "account-1",
        contentId: "content-1",
        attempt: 1,
        connectionMetadata: { igBusinessId: "ig-123" },
        placement,
    };
}

async function loadProvider() {
    vi.resetModules();
    vi.stubGlobal("Deno", {
        env: {
            get: vi.fn((key: string) => {
                if (key === "INSTAGRAM_IMAGE_CONTAINER_PUBLISH_DELAY_MS") return "0";
                if (key === "INSTAGRAM_PUBLISH_RETRY_DELAY_MS") return "0";
                return undefined;
            }),
        },
    });
    return import("../supabase/functions/publish-queue/providers/instagram");
}

/** The form fields of the nth fetch call. */
function sentParams(fetchMock: ReturnType<typeof vi.fn>, call: number): URLSearchParams {
    return fetchMock.mock.calls[call][1].body as URLSearchParams;
}

const LOCATION_REFUSED = {
    error: {
        message: "Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: 2207067,
        error_user_title: "Invalid location ID",
        error_user_msg: "The location ID is not valid.",
    },
};

describe("publishToInstagram location tag", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends the Page as location_id with the caption on a feed post", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(200, { id: "container-1" }))
            .mockResolvedValueOnce(response(200, { id: "ig-media-1" }));
        vi.stubGlobal("fetch", fetchMock);

        const { publishToInstagram } = await loadProvider();
        await publishToInstagram(request());

        const params = sentParams(fetchMock, 0);
        expect(params.get("location_id")).toBe(PAGE_ID);
        expect(params.get("caption")).toBe("Five rounds of cash bingo.");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["a story", request({}, "story")],
        ["no saved Page", request({ locationPageId: null })],
        ["a blank Page id", request({ locationPageId: "  " })],
        ["an id that is not a number", request({ locationPageId: "the-anchor" })],
    ])("sends no location for %s", async (_label, publishRequest) => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(200, { id: "container-1" }))
            .mockResolvedValueOnce(response(200, { id: "ig-media-1" }));
        vi.stubGlobal("fetch", fetchMock);

        const { publishToInstagram } = await loadProvider();
        await publishToInstagram(publishRequest);

        expect(sentParams(fetchMock, 0).has("location_id")).toBe(false);
    });

    it("publishes without the location when Instagram refuses it, and says so in the log", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(400, LOCATION_REFUSED))
            .mockResolvedValueOnce(response(200, { id: "container-2" }))
            .mockResolvedValueOnce(response(200, { id: "ig-media-2" }));
        vi.stubGlobal("fetch", fetchMock);

        const { publishToInstagram } = await loadProvider();
        const result = await publishToInstagram(request());

        expect(result.externalId).toBe("ig-media-2");
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const retry = sentParams(fetchMock, 1);
        expect(retry.has("location_id")).toBe(false);
        expect(retry.get("caption")).toBe("Five rounds of cash bingo.");
        expect(sentParams(fetchMock, 2).get("creation_id")).toBe("container-2");
        expect(warn).toHaveBeenCalledWith("[instagram] location tag refused; publishing without it", {
            status: 400,
            code: 100,
            subcode: 2207067,
            message: "Invalid parameter",
        });
        expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-access-token");
    });

    it("does not try again for an error that is not about the location", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(response(400, {
            error: { message: "Media download has failed.", type: "OAuthException", code: 9004, error_subcode: 2207052 },
        }));
        vi.stubGlobal("fetch", fetchMock);

        const { publishToInstagram } = await loadProvider();
        await expect(publishToInstagram(request())).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it("tries only once without the location, then fails as today", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(400, LOCATION_REFUSED))
            .mockResolvedValueOnce(response(400, LOCATION_REFUSED));
        vi.stubGlobal("fetch", fetchMock);

        const { publishToInstagram } = await loadProvider();
        await expect(publishToInstagram(request())).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("PublishQueueWorker location lookup", () => {
    function chain(result: unknown) {
        const calls = { select: vi.fn(), eq: vi.fn() };
        const builder = {
            select: calls.select.mockImplementation(() => builder),
            eq: calls.eq.mockImplementation(() => builder),
            maybeSingle: vi.fn().mockResolvedValue(result),
        };
        return { builder, calls };
    }

    async function workerWith(supabase: unknown) {
        const { PublishQueueWorker, createDefaultConfig } = await import("../supabase/functions/publish-queue/worker");
        class ExposedWorker extends PublishQueueWorker {
            lookUp(content: Record<string, unknown>) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return this.loadLocationPageId(content as any);
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new ExposedWorker(createDefaultConfig(), supabase as any);
    }

    const IG_FEED = { id: "content-1", account_id: "acc-anchor", platform: "instagram", placement: "feed" };

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("reads the Page saved in Settings for the post's own account", async () => {
        const { builder, calls } = chain({ data: { facebook_location_id: ` ${PAGE_ID} ` }, error: null });
        const supabase = { from: vi.fn().mockReturnValue(builder) };
        const worker = await workerWith(supabase);

        await expect(worker.lookUp(IG_FEED)).resolves.toBe(PAGE_ID);
        expect(supabase.from).toHaveBeenCalledWith("posting_defaults");
        expect(calls.select).toHaveBeenCalledWith("facebook_location_id");
        expect(calls.eq).toHaveBeenCalledWith("account_id", "acc-anchor");
    });

    it.each([
        ["a Facebook post", { ...IG_FEED, platform: "facebook" }],
        ["an Instagram story", { ...IG_FEED, placement: "story" }],
    ])("does not look for %s", async (_label, content) => {
        const supabase = { from: vi.fn() };
        const worker = await workerWith(supabase);

        await expect(worker.lookUp(content)).resolves.toBeNull();
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it.each([
        ["no Settings row", { data: null, error: null }],
        ["a blank Page id", { data: { facebook_location_id: " " }, error: null }],
    ])("returns nothing for %s", async (_label, result) => {
        const { builder } = chain(result);
        const worker = await workerWith({ from: vi.fn().mockReturnValue(builder) });

        await expect(worker.lookUp(IG_FEED)).resolves.toBeNull();
    });

    it("publishes without a location, and logs it, when the Settings read fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { builder } = chain({ data: null, error: { message: "connection reset" } });
        const worker = await workerWith({ from: vi.fn().mockReturnValue(builder) });

        await expect(worker.lookUp(IG_FEED)).resolves.toBeNull();
        expect(warn).toHaveBeenCalledWith("[publish-queue] location tag unavailable; publishing without it", {
            contentId: "content-1",
            message: "connection reset",
        });
    });

    it("publishes without a location when the read throws", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const worker = await workerWith({ from: vi.fn(() => { throw new Error("boom"); }) });

        await expect(worker.lookUp(IG_FEED)).resolves.toBeNull();
        expect(warn).toHaveBeenCalledOnce();
    });
});

describe("PublishQueueWorker passes the location to the provider", () => {
    it("puts the saved Page on an Instagram feed post's request", async () => {
        const { PublishQueueWorker, createDefaultConfig } = await import("../supabase/functions/publish-queue/worker");
        class FlowWorker extends PublishQueueWorker {
            protected async checkPublishHold(): Promise<null> { return null; }
            protected async loadLocationPageId(): Promise<string | null> { return PAGE_ID; }
            async recoverStuckJobs() { return; }
            protected async recordHeartbeat() { return; }
            protected async ensureJobsForScheduledContent() { return; }
        }
        const job = { id: "job-1", content_item_id: "content-1", variant_id: "variant-1", status: "queued", attempt: 0, placement: "feed" };
        const ordered = [
            { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [job], error: null }) },
            { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) },
            { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "content-1", account_id: "acc-anchor", status: "scheduled", platform: "instagram", placement: "feed", prompt_context: {}, campaigns: null }, error: null }) },
            { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "variant-1", content_item_id: "content-1", body: "Five rounds of cash bingo.", media_ids: [], banner_enabled: null, banner_text_override: null, banner_position: null, banner_bg: null, banner_text_colour: null }, error: null }) },
            { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conn-1", provider: "instagram", status: "active", access_token: "token", metadata: { igBusinessId: "ig-123" } }, error: null }) },
            { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) },
            { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) },
            { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) },
            { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) },
            { insert: vi.fn().mockResolvedValue({ error: null }) },
        ];
        const supabase = { from: vi.fn(), storage: { from: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
        for (const mock of ordered) supabase.from.mockReturnValueOnce(mock);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const worker = new FlowWorker(createDefaultConfig(), supabase as any);
        const publish = vi.spyOn(worker as unknown as { publishByPlatform: () => Promise<unknown> }, "publishByPlatform")
            .mockResolvedValue({ platform: "instagram", externalId: "ig-media-1", payloadPreview: "", publishedAt: new Date().toISOString() });

        const result = await worker.processDueJobs();

        expect(result.processed).toBe(1);
        expect(publish).toHaveBeenCalledWith("instagram", expect.objectContaining({
            payload: expect.objectContaining({ locationPageId: PAGE_ID, placement: "feed" }),
        }));
    });
});
