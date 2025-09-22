import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/observability/logger'

// Removed edge runtime due to Node.js dependencies in logger
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const metric = await req.json()
    const { name, value, id, label, path, navigationType } = metric || {}
    logger.event('info', {
      area: 'webvitals',
      op: String(name || 'vital'),
      status: 'ok',
      msg: 'Web vital',
      meta: { value, id, label, path, navigationType }
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.event('warn', {
      area: 'webvitals',
      op: 'vital.parse',
      status: 'fail',
      msg: 'Failed to parse web vital payload',
      meta: { errorMessage: err.message },
    })
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
