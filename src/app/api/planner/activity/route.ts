import { NextRequest, NextResponse } from "next/server";

import { getPlannerActivity } from "@/lib/planner/data";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");

  let parsedLimit: number | undefined;
  if (limitParam !== null) {
    const parsedValue = Number.parseInt(limitParam, 10);
    if (Number.isNaN(parsedValue) || parsedValue <= 0) {
      return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
    }
    parsedLimit = parsedValue;
  }

  try {
    const activity = await getPlannerActivity({ limit: parsedLimit, unreadOnly: true });
    return NextResponse.json({ activity }, { status: 200 });
  } catch (error) {
    console.error("[api] planner activity feed failed", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load activity", message }, { status: 500 });
  }
}
