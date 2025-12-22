import { NextResponse } from "next/server";
import { DateTime } from "luxon";

import { isSchemaMissingError } from "@/lib/supabase/errors";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

const PURGE_WINDOW_DAYS = 7;

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const headerSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization");
  const urlSecret = new URL(request.url).searchParams.get("secret");
  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await purgeOldTrash();
  return NextResponse.json(result.body, { status: result.status });
}

async function purgeOldTrash(): Promise<{ status: number; body: Record<string, unknown> }> {
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return {
      status: 500,
      body: { error: "Supabase service role is not configured" },
    };
  }

  const cutoff = DateTime.utc().minus({ days: PURGE_WINDOW_DAYS }).toISO();
  if (!cutoff) {
    return {
      status: 200,
      body: { deletedCount: 0, message: "No cutoff determined" },
    };
  }

  try {
    const { data, error } = await service
      .from("content_items")
      .delete()
      .lt("deleted_at", cutoff)
      .select("id");

    if (error) {
      if (isSchemaMissingError(error)) {
        return {
          status: 200,
          body: { deletedCount: 0, message: "content_items table not present" },
        };
      }
      return {
        status: 500,
        body: {
          error: "Failed to purge trashed content",
          message: error.message,
        },
      };
    }

    return {
      status: 200,
      body: {
        deletedCount: data?.length ?? 0,
        cutoff,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: "Unexpected error while purging trash",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
