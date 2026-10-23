import { NextResponse } from "next/server";

import { createGraphGet, loadConnectedAccounts, syncAccountPostResults } from "@/lib/analytics/post-results";
import { tokenForPlatform } from "@/lib/analytics/post-results-token";
import { createLogger } from "@/lib/logging";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import { verifyCronAuth } from "@/lib/security/cron-auth";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const logger = createLogger("sync-post-results");

type RunTotals = {
  brands: number;
  posts: number;
  written: number;
  skipped: number;
  failures: number;
};

/**
 * Daily read of each published post's results from Meta (tasks/SPEC-post-results.md). A brand
 * whose posts cannot be read or stored fails the run, so it shows in Vercel; the others still run.
 */
async function syncPostResults(): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = tryCreateServiceSupabaseClient();
  if (!db) {
    return { status: 500, body: { error: "Supabase service role is not configured" } };
  }

  let accounts: string[];
  try {
    accounts = await loadConnectedAccounts(db);
  } catch (error) {
    logger.error("connected brands could not be read", error instanceof Error ? error : new Error(String(error)));
    return { status: 500, body: { error: "Connections could not be read" } };
  }

  const get = createGraphGet(getMetaGraphApiBase());
  const totals: RunTotals = { brands: 0, posts: 0, written: 0, skipped: 0, failures: 0 };
  for (const accountId of accounts) {
    try {
      const summary = await syncAccountPostResults(
        { db, accountId },
        {
          get,
          tokenFor: (platform) => tokenForPlatform(db, accountId, platform),
          log: (message, detail) => logger.warn(message, detail),
        },
      );
      totals.brands += 1;
      totals.posts += summary.posts;
      totals.written += summary.written;
      totals.skipped += summary.skipped;
      if (Object.keys(summary.refused).length) {
        // Usually the insights permissions: the owner reconnects Facebook and Instagram.
        logger.warn("Meta refused some results", { accountId, refused: summary.refused });
      }
    } catch (error) {
      totals.failures += 1;
      logger.error(
        "post results failed for a brand",
        error instanceof Error ? error : new Error(String(error)),
        { accountId },
      );
    }
  }

  logger.info("post results finished", totals);
  return { status: totals.failures ? 500 : 200, body: totals };
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }
  const result = await syncPostResults();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
