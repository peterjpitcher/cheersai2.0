/**
 * Google versions cron (tasks/SPEC-gbp-posting-reintroduction.md, decision
 * D12). Runs every minute, entirely apart from publish-scheduler, so a Google
 * problem can never delay Facebook or Instagram. Creates Google versions for
 * new Facebook feed posts, sends the ones that are due and checks Google's
 * moderation state, for brands with the Google switch on and an active Google
 * connection only. With no such brand it does almost nothing and calls nothing
 * outside the database.
 */

import { NextResponse } from "next/server";

import { defaultGooglePostsDeps } from "@/lib/google-posts/deps";
import { runGooglePostsCron } from "@/lib/google-posts/run";
import { createLogger } from "@/lib/logging";
import { verifyCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
/** The run stops starting new work after 50 seconds (RUN_BUDGET_MS). */
export const maxDuration = 60;

const logger = createLogger("google-posts");

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  try {
    const deps = await defaultGooglePostsDeps();
    const summary = await runGooglePostsCron(deps);
    // Counts only: no token, signed URL or post text.
    if (summary.brands > 0) logger.info("Google posts run", { ...summary });
    const failed = summary.stepFailures > 0 || summary.send.errors > 0 || summary.moderation.errors > 0;
    return NextResponse.json(summary, { status: failed ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Google posts run failed", new Error(message));
    return NextResponse.json({ error: "Google posts run failed" }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
