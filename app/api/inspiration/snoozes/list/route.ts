import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function fmt(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = request.nextUrl
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = fromParam ? new Date(fromParam + 'T00:00:00Z') : first
  const to = toParam ? new Date(toParam + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  const { data, error } = await supabase
    .from('inspiration_snoozes')
    .select('date, event_id, events:events(name, category)')
    .gte('date', fmt(from))
    .lte('date', fmt(to))

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const items = (data || []).map((r: any) => ({
    date: r.date as string,
    event_id: r.event_id as string,
    name: (r.events?.name || 'Event') as string,
    category: (r.events?.category || 'civic') as string,
  }))

  return NextResponse.json({ ok: true, items })
}

