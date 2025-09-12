import { NextRequest, NextResponse } from "next/server";
import { unauthorized, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

// This is the main cron endpoint that Vercel Cron or external services will call
// Configure in vercel.json or your cron service to run every minute
export async function GET(request: NextRequest) {
  try {
    // Verify the request is from our cron service
    // Accept either:
    //  - Vercel Cron header: x-vercel-cron
    //  - Authorization: Bearer <CRON_SECRET>
    const authHeader = request.headers.get("authorization");
    const vercelCron = request.headers.get('x-vercel-cron');
    const hasBearer = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isVercelCron = Boolean(vercelCron);
    if (!hasBearer && !isVercelCron) {
      return unauthorized('Unauthorized', undefined, request)
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
        // Internal call retains protection on /api/queue/process
        "Authorization": `Bearer ${process.env.CRON_SECRET || ''}`,
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

    return ok({
      success: true,
      timestamp: new Date().toISOString(),
      tasks: {
        publishing_queue: queueResult,
        gdpr_cleanup: dataCleanupResult,
      }
    }, request);
  } catch (error) {
    console.error("Cron job error:", error);
    return serverError('Cron job failed', { details: String(error) }, request)
  }
}
