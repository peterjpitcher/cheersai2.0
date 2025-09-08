import { NextRequest, NextResponse } from 'next/server'
import { metrics } from '@/lib/observability/metrics'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as any
    const name = typeof body?.name === 'string' ? body.name : 'ui.page_view'
    const value = typeof body?.value === 'number' ? body.value : 1
    const tags: Record<string, string> = {}
    if (body?.tags && typeof body.tags === 'object') {
      for (const [k, v] of Object.entries(body.tags)) {
        if (typeof v === 'string') tags[k] = v
      }
    }
    metrics.incrementCounter(name, value, tags)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}

