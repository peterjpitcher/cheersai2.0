import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unauthorized, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    // Verify the request is from our cron service
    const authHeader = request.headers.get("authorization");
    
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return unauthorized('Unauthorized', undefined, request)
    }

    const supabase = await createClient();
    
    // Run the cleanup function to remove expired data per UK ICO guidelines
    const { data, error } = await supabase.rpc('cleanup_expired_data');
    
    if (error) {
      reqLogger.error('GDPR cleanup RPC error', {
        area: 'gdpr',
        op: 'cleanup',
        status: 'fail',
        error,
      })
      logger.error('GDPR cleanup error', {
        area: 'gdpr',
        op: 'cleanup',
        status: 'fail',
        error,
      })
      return serverError('Database cleanup failed', error.message, request)
    }

    reqLogger.info('GDPR cleanup completed', {
      area: 'gdpr',
      op: 'cleanup',
      status: 'ok',
      meta: { summary: data },
    })

    return ok({
      success: true,
      message: "UK ICO compliant data cleanup completed",
      timestamp: new Date().toISOString(),
      actions: [
        "Permanently deleted user data older than 30 days (post soft-delete)",
        "Removed analytics data older than 2 years", 
        "Cleaned up error logs older than 90 days",
        "Marked unused media files for deletion (90 days since last use)",
        "Cleaned up expired data export files"
      ]
    }, request);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('GDPR cleanup job error', {
      area: 'gdpr',
      op: 'cleanup',
      status: 'fail',
      error: err,
    })
    logger.error('GDPR cleanup job error', {
      area: 'gdpr',
      op: 'cleanup',
      status: 'fail',
      error: err,
    })
    return serverError('GDPR cleanup job failed', String(error), request)
  }
}
