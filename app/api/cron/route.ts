import { NextRequest, NextResponse } from "next/server";

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

    // Process the publishing queue
    const queueResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/queue/process`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const queueResult = await queueResponse.json();

    // GDPR Data Retention Cleanup - UK ICO Compliance
    const dataCleanupResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/gdpr/cleanup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const dataCleanupResult = await dataCleanupResponse.json().catch(() => ({ error: "Failed to parse cleanup response" }));

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