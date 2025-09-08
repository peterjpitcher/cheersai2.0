import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/observability/logger'

export const runtime = 'edge'

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
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}

