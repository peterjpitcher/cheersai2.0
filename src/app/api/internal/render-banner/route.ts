import { NextResponse } from "next/server";
import { z } from "zod";

import { renderBannerForContent } from "@/lib/scheduling/banner-renderer.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  contentId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
});

function normaliseAuthHeader(value: string | null) {
  if (!value) return "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

function resolveInternalSecrets() {
  return [process.env.INTERNAL_RENDER_SECRET, process.env.CRON_SECRET].filter((value): value is string => Boolean(value));
}

export async function POST(request: Request) {
  const allowedSecrets = resolveInternalSecrets();
  if (!allowedSecrets.length) {
    return NextResponse.json({ error: "Internal render secret not configured" }, { status: 500 });
  }

  const xInternalSecret = request.headers.get("x-internal-render-secret")?.trim();
  const xCronSecret = request.headers.get("x-cron-secret")?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get("authorization"));
  const providedSecret = xInternalSecret || xCronSecret || authHeader;

  if (!allowedSecrets.includes(providedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid render payload" }, { status: 400 });
  }

  try {
    const result = await renderBannerForContent(parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Banner render failed",
      },
      { status: 500 },
    );
  }
}
