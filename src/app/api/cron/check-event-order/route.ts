import { NextResponse } from "next/server";

import { checkAccountEventOrder } from "@/lib/content/event-order-check";
import { createLogger } from "@/lib/logging";
import { verifyCronAuth } from "@/lib/security/cron-auth";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const logger = createLogger("check-event-order");

type RunTotals = {
  brands: number;
  campaigns: number;
  posts: number;
  flagged: number;
  notified: number;
  failures: number;
};

type ConnectionRow = {
  account_id: string;
  base_url: string | null;
  api_key: string | null;
};

/**
 * Daily check of the event-order rule (tasks/SPEC-daily-event-order-check.md): every brand with
 * an events-system connection, its scheduled event posts against each event's promotion window.
 * In-app notices only. A brand that cannot be checked fails the run, so it shows in Vercel.
 */
async function checkEventOrder(): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = tryCreateServiceSupabaseClient();
  if (!db) {
    return { status: 500, body: { error: "Supabase service role is not configured" } };
  }

  const { data: connections, error } = await db
    .from("management_app_connections")
    .select("account_id, base_url, api_key")
    .eq("enabled", true)
    .returns<ConnectionRow[]>();
  if (error) {
    logger.error("events-system connections could not be read", new Error(error.message));
    return { status: 500, body: { error: "Events-system connections could not be read" } };
  }

  const totals: RunTotals = {
    brands: 0,
    campaigns: 0,
    posts: 0,
    flagged: 0,
    notified: 0,
    failures: 0,
  };
  for (const connection of connections ?? []) {
    const baseUrl = connection.base_url?.trim();
    const apiKey = connection.api_key?.trim();
    if (!baseUrl || !apiKey) {
      totals.failures += 1;
      logger.error("events-system connection is incomplete", undefined, { accountId: connection.account_id });
      continue;
    }
    try {
      const summary = await checkAccountEventOrder({ db, accountId: connection.account_id, config: { baseUrl, apiKey } });
      totals.brands += 1;
      totals.campaigns += summary.campaigns;
      totals.posts += summary.posts;
      totals.flagged += summary.flagged;
      totals.notified += summary.notified;
      if (summary.flagged) {
        logger.warn("scheduled posts break the event-order rule", { accountId: connection.account_id, ...summary });
      }
    } catch (checkError) {
      totals.failures += 1;
      logger.error(
        "event-order check failed for a brand",
        checkError instanceof Error ? checkError : new Error(String(checkError)),
        { accountId: connection.account_id },
      );
    }
  }

  logger.info("event-order check finished", totals);
  return { status: totals.failures ? 500 : 200, body: totals };
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }
  const result = await checkEventOrder();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
