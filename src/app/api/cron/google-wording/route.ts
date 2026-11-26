/**
 * Google wording cron (tasks/SPEC-gbp-separate-posts.md, decision D15). Runs
 * every two minutes, apart from the google-posts cron that sends, because one
 * AI draft can take most of a minute and must never delay a send.
 *
 * For brands with the Google switch on and an active Google connection, it
 * writes Google wording for the posts still waiting for it, a few a run. With
 * no such brand, or nothing waiting, it reads a few rows and calls nothing
 * outside the database.
 */

import { NextResponse } from "next/server";

import { listGoogleBrands } from "@/lib/google-posts/brands";
import { defaultGooglePostsDeps } from "@/lib/google-posts/deps";
import { emptyWordingSummary, writeGoogleWordings } from "@/lib/google-posts/wording";
import { createLogger } from "@/lib/logging";
import { verifyCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
/** Two drafts of up to 45 seconds each, with room to store them. */
export const maxDuration = 120;
/** No new draft starts unless a whole one fits before this. */
const RUN_BUDGET_MS = 105_000;

const logger = createLogger("google-posts");

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  try {
    const deps = await defaultGooglePostsDeps();
    const deadline = deps.now().getTime() + RUN_BUDGET_MS;
    const summary = emptyWordingSummary();
    const brands = await listGoogleBrands(deps.db);
    for (const brand of brands) {
      try {
        await writeGoogleWordings(deps, brand, { deadline, summary });
      } catch (error) {
        summary.errors += 1;
        logger.error("Google wording failed for a brand", new Error(error instanceof Error ? error.message : "unknown error"), {
          accountId: brand.accountId,
        });
      }
    }
    // Counts only: never the wording.
    if (summary.written || summary.retried || summary.fellBack || summary.errors) {
      logger.info("Google wording run", { brands: brands.length, ...summary });
    }
    return NextResponse.json({ brands: brands.length, ...summary }, { status: summary.errors > 0 ? 500 : 200 });
  } catch (error) {
    logger.error("Google wording run failed", new Error(error instanceof Error ? error.message : String(error)));
    return NextResponse.json({ error: "Google wording run failed" }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
