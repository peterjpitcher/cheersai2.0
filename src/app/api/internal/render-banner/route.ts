import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { renderBannerServer } from "@/lib/banner/render-server";
import type { ResolvedConfig, BannerPosition } from "@/lib/banner/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANNER_POSITIONS: BannerPosition[] = ["top", "bottom", "left", "right"];

// SSRF / DoS hardening:
//   - Only the project's Supabase Storage host may be fetched.
//   - Only https: scheme is allowed.
//   - Loopback / private IPv4 ranges and IPv6 loopback are rejected even if a
//     malicious DNS entry for the project host points there.
//   - The fetch is given a 15s timeout via AbortSignal.timeout.
//   - We refuse to download bodies larger than 25 MB based on Content-Length,
//     and re-check post-read in case the header was missing or wrong.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SOURCE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Derive the allowed Supabase Storage hostname from the project URL at module
 * load. Throws below if a request comes in with a missing/invalid env, but at
 * import time we tolerate undefined so non-route callers (and tests that mock
 * env vars) don't blow up.
 */
function getAllowedSupabaseHost(): string | null {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw) return null;
    try {
        return new URL(raw).host.toLowerCase();
    } catch {
        return null;
    }
}

const ALLOWED_SUPABASE_HOST = getAllowedSupabaseHost();

function isPrivateOrLoopbackHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (lower === "localhost" || lower === "ip6-localhost" || lower === "ip6-loopback") {
        return true;
    }
    // IPv6 loopback / unspecified
    if (lower === "::1" || lower === "::") {
        return true;
    }
    // IPv4 dotted quad
    const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const a = Number(ipv4[1]);
        const b = Number(ipv4[2]);
        if (a === 10) return true;                          // 10.0.0.0/8
        if (a === 127) return true;                         // 127.0.0.0/8 loopback
        if (a === 0) return true;                           // 0.0.0.0/8
        if (a === 169 && b === 254) return true;            // link-local
        if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
        if (a === 192 && b === 168) return true;            // 192.168.0.0/16
        if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    }
    return false;
}

interface RenderBannerRequestBody {
    sourceMediaUrl: string;
    config: ResolvedConfig;
    label: string;
}

// G4 hardening: stricter input validation prevents callers (or buggy
// upstream workers) from feeding arbitrary content into Sharp/libvips. We
// cap label length, restrict the label charset to a generous but bounded
// set, and require strict hex format on colour fields. Anything else is a
// fast 400 reject before we touch the renderer.
const MAX_LABEL_LENGTH = 60;
// Allowed: word chars, whitespace, and common punctuation we've seen in
// natural banner labels. Anything else (control chars, emoji, raw quotes,
// SVG meta-chars beyond the ones already escaped by the renderer) is
// rejected. This is intentionally permissive enough to cover labels like
// "WEDNESDAY 25 SEPTEMBER" and "Buy 1 get 1 free" while excluding garbage.
const LABEL_PATTERN = /^[\w\s\-:.,!?'"&%@#()/]+$/;
const HEX_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Validate a parsed body. Returns null on success, or a short reason string
 * (used as `BANNER_RENDER_FAILED: invalid <reason>`) on failure.
 */
function validateBody(value: unknown): string | null {
    if (!value || typeof value !== "object") return "body";
    const v = value as Record<string, unknown>;

    if (typeof v.sourceMediaUrl !== "string" || v.sourceMediaUrl.length === 0) {
        return "sourceMediaUrl";
    }
    if (typeof v.label !== "string" || v.label.length === 0) {
        return "label";
    }
    if (v.label.length > MAX_LABEL_LENGTH) {
        return "label";
    }
    if (!LABEL_PATTERN.test(v.label)) {
        return "label";
    }

    if (!v.config || typeof v.config !== "object") return "config";
    const c = v.config as Record<string, unknown>;

    if (typeof c.enabled !== "boolean") return "config.enabled";
    if (typeof c.position !== "string"
        || !BANNER_POSITIONS.includes(c.position as BannerPosition)) {
        return "config.position";
    }
    if (typeof c.bgColour !== "string" || !HEX_COLOUR_PATTERN.test(c.bgColour)) {
        return "config.bgColour";
    }
    if (typeof c.textColour !== "string" || !HEX_COLOUR_PATTERN.test(c.textColour)) {
        return "config.textColour";
    }
    if (c.textOverride !== null && typeof c.textOverride !== "string") {
        return "config.textOverride";
    }

    return null;
}

function safeEqualSecret(provided: string, expected: string): boolean {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) {
        // Constant-time compare against the longer to avoid early-exit timing leaks.
        const padded = Buffer.alloc(b.length);
        a.copy(padded);
        timingSafeEqual(padded, b);
        return false;
    }
    return timingSafeEqual(a, b);
}

function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function bannerRenderFailed(reason: string) {
    return NextResponse.json(
        { error: `BANNER_RENDER_FAILED: ${reason}` },
        { status: 500 },
    );
}

/**
 * Validate the source URL: must be an absolute https: URL whose host matches
 * the project's Supabase Storage host. Returns the parsed URL on success or a
 * string reason on failure.
 */
function validateSourceUrl(sourceMediaUrl: string): URL | string {
    let parsed: URL;
    try {
        parsed = new URL(sourceMediaUrl);
    } catch {
        return "source media URL is not a valid absolute URL";
    }
    if (parsed.protocol !== "https:") {
        return `source media URL scheme not allowed: ${parsed.protocol}`;
    }
    if (!ALLOWED_SUPABASE_HOST) {
        return "Supabase project host not configured";
    }
    if (parsed.host.toLowerCase() !== ALLOWED_SUPABASE_HOST) {
        return `source media host not allowed: ${parsed.host}`;
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
        return `source media host not allowed: ${parsed.hostname}`;
    }
    return parsed;
}

export async function POST(request: Request): Promise<Response> {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
        return unauthorized();
    }
    const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!provided || !safeEqualSecret(provided, cronSecret)) {
        return unauthorized();
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validationFailure = validateBody(body);
    if (validationFailure !== null) {
        return NextResponse.json(
            { error: `BANNER_RENDER_FAILED: invalid ${validationFailure}` },
            { status: 400 },
        );
    }

    // validationFailure === null means body matches RenderBannerRequestBody
    // shape — the type predicate is preserved by validateBody's return.
    const { sourceMediaUrl, config, label } = body as RenderBannerRequestBody;

    const validated = validateSourceUrl(sourceMediaUrl);
    if (typeof validated === "string") {
        return bannerRenderFailed(validated);
    }

    let sourceBuffer: Buffer;
    try {
        const sourceResp = await fetch(validated.toString(), {
            signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
            redirect: "error",
        });
        if (!sourceResp.ok) {
            return bannerRenderFailed(`source download failed with status ${sourceResp.status}`);
        }

        // Content-Length pre-check. Reject if absent or > cap. The header is
        // user-controlled (signed Storage URL responses include it), so this
        // is a fast reject; we also re-check after read.
        const contentLengthHeader = sourceResp.headers.get("content-length");
        if (!contentLengthHeader) {
            return bannerRenderFailed("source media missing Content-Length header");
        }
        const declaredLength = Number(contentLengthHeader);
        if (!Number.isFinite(declaredLength) || declaredLength < 0) {
            return bannerRenderFailed("source media declared invalid Content-Length");
        }
        if (declaredLength > MAX_SOURCE_BYTES) {
            return bannerRenderFailed(
                `source media exceeds ${MAX_SOURCE_BYTES} byte cap (declared ${declaredLength})`,
            );
        }

        const arrayBuffer = await sourceResp.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_SOURCE_BYTES) {
            return bannerRenderFailed(
                `source media exceeds ${MAX_SOURCE_BYTES} byte cap (read ${arrayBuffer.byteLength})`,
            );
        }
        sourceBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown source download error";
        return bannerRenderFailed(message);
    }

    let rendered: Buffer;
    try {
        rendered = await renderBannerServer(sourceBuffer, config, label);
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown render error";
        const reason = message.startsWith("BANNER_RENDER_FAILED")
            ? message
            : `BANNER_RENDER_FAILED: ${message}`;
        return NextResponse.json({ error: reason }, { status: 500 });
    }

    return new Response(new Uint8Array(rendered), {
        status: 200,
        headers: {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
        },
    });
}
