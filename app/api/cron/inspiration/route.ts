import { NextRequest } from 'next/server'
import { orchestrateInspiration } from '@/lib/inspiration/orchestrator'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { ok, forbidden, serverError } from '@/lib/http'

export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  const hasVercelCronHeader = request.headers.get('x-vercel-cron') === '1'
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (!hasVercelCronHeader) {
    if (!secret || secret !== process.env.CRON_SECRET) return forbidden('Forbidden', undefined, request)
  }

  const from = request.nextUrl.searchParams.get('from') || undefined
  const to = request.nextUrl.searchParams.get('to') || undefined
  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const forceBriefs = request.nextUrl.searchParams.get('forceBriefs') === '1'

  try {
    const res = await orchestrateInspiration({ from, to, dryRun: dry, forceBriefs })
    reqLogger.info('Inspiration cron executed', {
      area: 'inspiration',
      op: 'cron.run',
      status: 'ok',
      meta: { from, to, dry, forceBriefs },
    })
    return ok(res, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Inspiration cron failed', {
      area: 'inspiration',
      op: 'cron.run',
      status: 'fail',
      error: err,
    })
    logger.error('Inspiration cron failed', {
      area: 'inspiration',
      op: 'cron.run',
      status: 'fail',
      error: err,
    })
    return serverError('Inspiration cron failed', { message: err.message }, request)
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
