import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { renderBannerServer } from "@/lib/banner/render-server";
import type { ResolvedConfig, BannerPosition } from "@/lib/banner/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BANNER_POSITIONS: BannerPosition[] = ["top", "bottom", "left", "right"];

interface RenderBannerRequestBody {
    sourceMediaUrl: string;
    config: ResolvedConfig;
    label: string;
}

function isResolvedConfig(value: unknown): value is ResolvedConfig {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (typeof v.enabled !== "boolean") return false;
    if (typeof v.position !== "string") return false;
    if (!BANNER_POSITIONS.includes(v.position as BannerPosition)) return false;
    if (typeof v.bgColour !== "string") return false;
    if (typeof v.textColour !== "string") return false;
    if (v.textOverride !== null && typeof v.textOverride !== "string") return false;
    return true;
}

function isValidBody(value: unknown): value is RenderBannerRequestBody {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (typeof v.sourceMediaUrl !== "string" || v.sourceMediaUrl.length === 0) return false;
    if (typeof v.label !== "string" || v.label.length === 0) return false;
    if (!isResolvedConfig(v.config)) return false;
    return true;
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

    if (!isValidBody(body)) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { sourceMediaUrl, config, label } = body;

    let sourceBuffer: Buffer;
    try {
        const sourceResp = await fetch(sourceMediaUrl);
        if (!sourceResp.ok) {
            return NextResponse.json(
                { error: `BANNER_RENDER_FAILED: source download failed with status ${sourceResp.status}` },
                { status: 500 },
            );
        }
        const arrayBuffer = await sourceResp.arrayBuffer();
        sourceBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : "unknown source download error";
        return NextResponse.json(
            { error: `BANNER_RENDER_FAILED: ${message}` },
            { status: 500 },
        );
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
