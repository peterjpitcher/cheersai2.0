import { NextResponse } from "next/server";

import { getPublicLinkInBioPageData, type PageDataTimings } from "@/lib/link-in-bio/public";
import { verifyCronAuth } from "@/lib/security/cron-auth";

/**
 * Guarded latency diagnostic for the public link-in-bio page.
 *
 * The page renders in a few seconds in production while every individual query
 * it makes measures fast in isolation, so the phases have to be timed where
 * they actually run. This calls the same data function the page calls and
 * reports a per-phase breakdown, deliberately without touching the render path.
 *
 * Authenticated with CRON_SECRET, matching /api/internal/render-banner: the
 * numbers describe internal behaviour and should not be public. It returns no
 * page content, only durations and a few coarse counts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json(
      { error: auth.errorMessage ?? "Unauthorized" },
      { status: auth.errorStatus ?? 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase();
  if (!slug) {
    return NextResponse.json(
      { error: "slug query parameter is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const timings: PageDataTimings = {};
  const startedAt = Date.now();

  let data: Awaited<ReturnType<typeof getPublicLinkInBioPageData>>;
  try {
    data = await getPublicLinkInBioPageData(slug, timings);
  } catch (error) {
    return NextResponse.json(
      {
        error: "getPublicLinkInBioPageData threw",
        message: error instanceof Error ? error.message : String(error),
        totalMs: Date.now() - startedAt,
        timings,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const totalMs = Date.now() - startedAt;
  const measured = Object.values(timings).reduce((sum, ms) => sum + ms, 0);

  // Server-Timing so the same numbers show up in browser devtools.
  const serverTiming = Object.entries(timings)
    .map(([phase, ms]) => `${phase.replace(/[^a-zA-Z0-9_-]/g, "-")};dur=${ms}`)
    .concat([`total;dur=${totalMs}`])
    .join(", ");

  return NextResponse.json(
    {
      slug,
      found: Boolean(data),
      totalMs,
      // Anything in `total` but not in the phases is work between them:
      // shaping, sorting and banner resolution rather than IO.
      unattributedMs: totalMs - measured,
      timings,
      counts: data
        ? {
            tiles: data.tiles.length,
            campaigns: data.campaigns.length,
            websiteEvents: data.websiteEvents?.length ?? 0,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store", "Server-Timing": serverTiming } },
  );
}
