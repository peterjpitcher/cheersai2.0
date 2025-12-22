import { NextResponse } from "next/server";

const PUBLISH_FUNCTION = "publish-queue";

async function invokePublishQueue() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return {
      ok: false,
      status: 500,
      body: { error: "Supabase environment missing" },
    } as const;
  }

  const functionUrl = `${supabaseUrl}/functions/v1/${PUBLISH_FUNCTION}`;

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source: "cron" }),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        body: {
          error: "Publish queue invocation failed",
          edgeStatus: response.status,
          responseText: await response.text(),
        },
      } as const;
    }

    return {
      ok: true,
      status: 200,
      body: await response.json().catch(() => ({})),
    } as const;
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "Failed to call publish queue",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const;
  }
}

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

  const result = await invokePublishQueue();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
