import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, serverError } from '@/lib/http'

export const runtime = 'nodejs'

function fmt(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type SnoozedEventRow = {
  date: string
  event_id: string
  events: {
    name: string | null
    category: string | null
  } | null
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required', undefined, request)

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
    .eq('user_id', user.id)
    .gte('date', fmt(from))
    .lte('date', fmt(to))
    .returns<SnoozedEventRow[]>()

  if (error) return serverError('Failed to fetch snoozed inspiration items', { message: error.message }, request)

  const items = (data ?? []).map((row) => ({
    date: row.date,
    event_id: row.event_id,
    name: row.events?.name ?? 'Event',
    category: row.events?.category ?? 'civic',
  }))

  return ok({ items }, request)
}
