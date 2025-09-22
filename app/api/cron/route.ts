import { NextRequest } from "next/server";
import { unauthorized, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

// This is the main cron endpoint that Vercel Cron or external services will call
// Configure in vercel.json or your cron service to run every minute
export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    // Verify the request is from our cron service
    // Accept either:
    //  - Vercel Cron header: x-vercel-cron
    //  - Authorization: Bearer <CRON_SECRET>
    const authHeader = request.headers.get("authorization");
    const vercelCron = request.headers.get('x-vercel-cron');
    const isVercelCron = Boolean(vercelCron);
    const secret = process.env.CRON_SECRET;
    if (!secret && !isVercelCron) {
      // Allow Vercel Cron without CRON_SECRET; otherwise require the secret
      return serverError('cron_misconfigured', { message: 'CRON_SECRET not set' }, request)
    }
    const hasBearer = secret ? authHeader === `Bearer ${secret}` : false;
    if (!hasBearer && !isVercelCron) {
      return unauthorized('Unauthorized', undefined, request)
    }

    // Resolve base URL from the incoming request (same deployment),
    // falling back to configured site/app URLs when needed.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    const commonHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (secret) {
      commonHeaders.Authorization = `Bearer ${secret}`
    }
    if (vercelCron) {
      commonHeaders['x-vercel-cron'] = vercelCron
    }

    // Helper to safely parse JSON, with fallback to text
    const parseJsonSafe = async (res: Response) => {
      try {
        return await res.json()
      } catch (parseError) {
        const text = await res.text()
        return {
          non_json_response: true,
          status: res.status,
          text: text.slice(0, 500),
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
        }
      }
    }

    // Process the publishing queue
    const queueResponse = await fetch(`${baseUrl}/api/queue/process`, {
      method: "POST",
      headers: commonHeaders,
    });

    const queueResult = await parseJsonSafe(queueResponse);

    // GDPR Data Retention Cleanup - UK ICO Compliance
    const dataCleanupResponse = await fetch(`${baseUrl}/api/gdpr/cleanup`, {
      method: "POST",
      headers: commonHeaders,
    });

    const dataCleanupResult = await parseJsonSafe(dataCleanupResponse);

    // You can add more cron tasks here in the future
    // For example:
    // - Send reminder emails
    // - Generate analytics reports
    // - Check for expired trials

    const responsePayload = {
      success: true,
      timestamp: new Date().toISOString(),
      tasks: {
        publishing_queue: queueResult,
        gdpr_cleanup: dataCleanupResult,
      }
    }

    reqLogger.info('Cron tasks executed', {
      area: 'queue',
      op: 'cron.execute',
      status: 'ok',
      meta: responsePayload.tasks,
    })

    return ok(responsePayload, request);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Cron job error', {
      area: 'queue',
      op: 'cron.execute',
      status: 'fail',
      error: err,
    })
    logger.error('Cron job error', {
      area: 'queue',
      op: 'cron.execute',
      status: 'fail',
      error: err,
    })
    return serverError('Cron job failed', { details: String(error) }, request)
  }
}
