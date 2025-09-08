import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) return new NextResponse('forbidden', { status: 403 })
  const supabase = await createClient()
  const cutoffClicks = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  // prune old clicks
  await supabase.from('short_clicks').delete().lt('ts', cutoffClicks)
  return NextResponse.json({ ok: true })
}
