import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getInternalBaseUrl } from '@/lib/utils/get-app-url'

export const runtime = 'nodejs'

// Dev helper endpoint: triggers the queue processor server-side using CRON_SECRET.
// Only enabled outside production to avoid exposing privileged behaviour.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  }
  // Call internal processor with server-supplied Authorization
  const base = getInternalBaseUrl(request)
  const resp = await fetch(`${base}/api/queue/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const text = await resp.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return NextResponse.json({ ok: resp.ok, status: resp.status, data: parsed ?? text })
}
