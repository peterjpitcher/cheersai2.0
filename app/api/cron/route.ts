import { NextRequest, NextResponse } from "next/server";

export const runtime = 'nodejs'

// This is the main cron endpoint that Vercel Cron or external services will call
// Configure in vercel.json or your cron service to run every minute
export async function GET(request: NextRequest) {
  try {
    // Verify the request is from our cron service
    const authHeader = request.headers.get("authorization");
    
    // For Vercel Cron, check for the CRON_SECRET
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve base URL from the incoming request (same deployment),
    // falling back to configured site/app URLs when needed.
    const origin = request.nextUrl?.origin
    const baseUrl = origin || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000"

    // Helper to safely parse JSON, with fallback to text
    const parseJsonSafe = async (res: Response) => {
      try {
        return await res.json()
      } catch (_) {
        const text = await res.text()
        return { non_json_response: true, status: res.status, text: text.slice(0, 500) }
      }
    }

    // Process the publishing queue
    const queueResponse = await fetch(`${baseUrl}/api/queue/process`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const queueResult = await parseJsonSafe(queueResponse);

    // GDPR Data Retention Cleanup - UK ICO Compliance
    const dataCleanupResponse = await fetch(`${baseUrl}/api/gdpr/cleanup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const dataCleanupResult = await parseJsonSafe(dataCleanupResponse);

    // You can add more cron tasks here in the future
    // For example:
    // - Send reminder emails
    // - Generate analytics reports
    // - Check for expired trials

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      tasks: {
        publishing_queue: queueResult,
        gdpr_cleanup: dataCleanupResult,
      }
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return NextResponse.json(
      { error: "Cron job failed", details: error },
      { status: 500 }
    );
  }
}
