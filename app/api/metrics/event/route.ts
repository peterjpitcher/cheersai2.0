import { NextRequest, NextResponse } from 'next/server'
import { metrics } from '@/lib/observability/metrics'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const allowedOrigins = new Set<string>()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    const host = req.headers.get('host')
    if (appUrl) {
      try { allowedOrigins.add(new URL(appUrl).origin) } catch {}
    }
    if (siteUrl) {
      try { allowedOrigins.add(new URL(siteUrl).origin) } catch {}
    }
    if (host) {
      allowedOrigins.add(`https://${host}`)
      allowedOrigins.add(`http://${host}`)
    }

    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    const deriveOrigin = (value: string | null) => {
      if (!value) return null
      try { return new URL(value).origin } catch { return null }
    }
    const requestOrigin = deriveOrigin(origin) || deriveOrigin(referer)
    if (requestOrigin && allowedOrigins.size > 0 && !allowedOrigins.has(requestOrigin)) {
      return NextResponse.json({ ok: false }, { status: 403 })
    }

    const rawBody = await req.json().catch(() => ({}))
    const body = typeof rawBody === 'object' && rawBody !== null ? rawBody as Record<string, unknown> : {}
    const nameRaw = (body as { name?: unknown }).name
    const valueRaw = (body as { value?: unknown }).value
    const tagsRaw = (body as { tags?: unknown }).tags
    const name = typeof nameRaw === 'string' ? nameRaw : 'ui.page_view'
    const value = typeof valueRaw === 'number' ? valueRaw : 1
    const tags: Record<string, string> = {}
    if (typeof tagsRaw === 'object' && tagsRaw !== null) {
      for (const [k, v] of Object.entries(tagsRaw as Record<string, unknown>)) {
        if (typeof v === 'string') tags[k] = v
      }
    }
    metrics.incrementCounter(name, value, tags)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
