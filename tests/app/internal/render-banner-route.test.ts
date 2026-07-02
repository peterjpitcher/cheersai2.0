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

// Setup pins NEXT_PUBLIC_SUPABASE_URL to https://mock.supabase.co — match it.
const ALLOWED_URL = "https://mock.supabase.co/storage/v1/object/sign/media/source.jpg";

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

function buildAllowedSourceResponse(bytes: Uint8Array): Response {
    // Cast to BodyInit — Uint8Array is accepted by the Response constructor at
    // runtime in Node 20+ but the lib.dom typings only list ArrayBuffer/Blob/etc.
    return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
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
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "CRON_SECRET not configured" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 503 BANNER_DISABLED when BANNER_OVERLAY_DISABLED is set", async () => {
        process.env.BANNER_OVERLAY_DISABLED = "true";
        try {
            const fetchSpy = vi.spyOn(globalThis, "fetch");

            const response = await POST(buildRequest({
                headers: { authorization: "Bearer test-cron-secret" },
                body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
            }));

            expect(response.status).toBe(503);
            const json = await response.json();
            expect(json).toEqual({ error: "BANNER_DISABLED" });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(renderBannerServerMock).not.toHaveBeenCalled();
        } finally {
            delete process.env.BANNER_OVERLAY_DISABLED;
        }
    });

    it("returns 401 when authorization header is missing", async () => {
        const response = await POST(buildRequest({
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 401 when authorization header is wrong", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer wrong-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
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
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid label" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 when config has invalid position", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: { ...VALID_CONFIG, position: "centre" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid config.position" });
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    // G4 hardening: label length and charset, hex-only colours.
    it("returns 400 when label exceeds the 60-char cap", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: VALID_CONFIG,
                label: "A".repeat(200),
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid label" });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 when label contains disallowed characters", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: VALID_CONFIG,
                // Emoji are outside the allowed character class.
                label: "TONIGHT \u{1F389}",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid label" });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 when bgColour is not a 6-digit hex", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: { ...VALID_CONFIG, bgColour: "red" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid config.bgColour" });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 400 when textColour is a 3-digit hex (not full hex)", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: {
                sourceMediaUrl: ALLOWED_URL,
                config: { ...VALID_CONFIG, textColour: "#abc" },
                label: "TONIGHT",
            },
        }));

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: invalid config.textColour" });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects sources on a non-allowlisted host", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "https://evil.example.com/x.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media host not allowed/);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects non-https schemes", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "http://mock.supabase.co/x.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media URL scheme not allowed/);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects relative or invalid URLs", async () => {
        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: "/relative/path.jpg", config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media URL is not a valid absolute URL/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects sources missing Content-Length", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media missing Content-Length header/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("rejects sources whose declared Content-Length exceeds the cap", async () => {
        const oversize = 26 * 1024 * 1024;
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-length": String(oversize) },
            }),
        );

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source media exceeds .* byte cap/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("propagates fetch timeout / abort errors as BANNER_RENDER_FAILED", async () => {
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "TimeoutError";
        globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: /);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 500 when source download fails", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json.error).toMatch(/^BANNER_RENDER_FAILED: source download failed with status 503$/);
        expect(renderBannerServerMock).not.toHaveBeenCalled();
    });

    it("returns 500 when renderBannerServer throws", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            buildAllowedSourceResponse(new Uint8Array([1, 2, 3])),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("BANNER_RENDER_FAILED: source has no dimensions"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: source has no dimensions" });
        expect(renderBannerServerMock).toHaveBeenCalledOnce();
    });

    it("prefixes BANNER_RENDER_FAILED on render errors that lack the prefix", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            buildAllowedSourceResponse(new Uint8Array([1, 2, 3])),
        );
        renderBannerServerMock.mockRejectedValueOnce(new Error("ENOENT"));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
        }));

        expect(response.status).toBe(500);
        const json = await response.json();
        expect(json).toEqual({ error: "BANNER_RENDER_FAILED: ENOENT" });
    });

    it("returns the rendered JPEG buffer on success", async () => {
        const sourceBytes = new Uint8Array([10, 20, 30, 40]);
        globalThis.fetch = vi.fn().mockResolvedValue(buildAllowedSourceResponse(sourceBytes));
        const renderedBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        renderBannerServerMock.mockResolvedValueOnce(renderedBytes);

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "TONIGHT" },
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

    it("accepts a pound-sign label (£) and renders it instead of 400ing", async () => {
        // Regression: natural pub pricing like "£5 PINTS" used to be rejected at
        // this gate, failing the whole publish job. It must now pass through.
        globalThis.fetch = vi.fn().mockResolvedValue(buildAllowedSourceResponse(new Uint8Array([1, 2, 3, 4])));
        renderBannerServerMock.mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

        const response = await POST(buildRequest({
            headers: { authorization: "Bearer test-cron-secret" },
            body: { sourceMediaUrl: ALLOWED_URL, config: VALID_CONFIG, label: "£5 PINTS" },
        }));

        expect(response.status).toBe(200);
        expect(renderBannerServerMock).toHaveBeenCalledWith(
            expect.any(Buffer),
            VALID_CONFIG,
            "£5 PINTS",
        );
    });
});
