import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderBannerServerMock } = vi.hoisted(() => ({
    renderBannerServerMock: vi.fn(),
}));

vi.mock("@/lib/banner/render-server", () => ({
    renderBannerServer: renderBannerServerMock,
}));

import { POST } from "@/app/api/internal/render-banner/route";

const VALID_CONFIG = {
    enabled: true,
    position: "bottom" as const,
    bgColour: "#000000",
    textColour: "#FFFFFF",
    textOverride: null,
};

function buildRequest(opts: {
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string;
}): Request {
    const headers = new Headers(opts.headers ?? {});
    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const body = opts.rawBody !== undefined
        ? opts.rawBody
        : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined;
    return new Request("http://localhost/api/internal/render-banner", {
        method: "POST",
        headers,
        body,
    });
}

describe("POST /api/internal/render-banner", () => {
    const originalCronSecret = process.env.CRON_SECRET;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        process.env.CRON_SECRET = "test-cron-secret";
        renderBannerServerMock.mockReset();
    });

    afterEach(() => {
        if (originalCronSecret === undefined) {
            delete process.env.CRON_SECRET;
        } else {
            process.env.CRON_SECRET = originalCronSecret;
        }
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("returns 500 when CRON_SECRET is not configured", async () => {
        delete process.env.CRON_SECRET;

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer anything" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "CRON_SECRET not configured" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is missing", async () => {
        const response = await POST(buildRequest({
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is wrong", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer wrong-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid JSON body", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            rawBody: "{not json",
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when body fields are missing or invalid", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("returns 400 when config has invalid position", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: "https://example.com/img.jpg",
                config: { ...VALID_CONFIG, position: "centre" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "Invalid request body" });
    });

    it("returns 500 when source download fails", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source download failed with status 503$/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 500 when renderBannerServer throws", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("BANNER_RENDER_FAILED: source has no dimensions"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: source has no dimensions" });
        expect(renderBannerServerMock).toHaveBeenCalledOnce();
    });

    it("prefixes BANNER_RENDER_FAILED on render errors that lack the prefix", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("ENOENT"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: ENOENT" });
    });

    it("returns the rendered JPEG buffer on success", async () => {
        const sourceBytes = new Uint8Array([10, 20, 30, 40]);
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(sourceBytes, { status: 200 }));
        const renderedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        renderBannerServerMock.mockResolvedValueOnce(renderedBytes);

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://example.com/img.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/jpeg");
        const result = Buffer.from(await response.arrayBuffer());
        expect(result.equals(renderedBytes)).toBe(true);

        expect(renderBannerServerMock).toHaveBeenCalledWith(
            expect.any(Buffer),
            VALID_CONFIG,
            "TONIGHT",
        );
        const sourceArg = renderBannerServerMock.mock.calls[0][0] as Buffer;
        expect(Buffer.from(sourceBytes).equals(sourceArg)).toBe(true);
    });
});
