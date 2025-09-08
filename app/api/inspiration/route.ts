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
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return new NextResponse('unauthorized', { status: 401 })

  const url = request.nextUrl
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = fromParam ? new Date(fromParam + 'T00:00:00Z') : first
  const to = toParam ? new Date(toParam + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) + 42 * 24 * 3600 * 1000)

  // Read user prefs (sports/alcohol) if exists
  const { data: prefs } = await supabase
    .from('user_prefs')
    .select('show_sports, show_alcohol')
    .eq('user_id', auth.user.id)
    .maybeSingle()

  const showSports = prefs?.show_sports ?? true
  const showAlcoholPref = prefs?.show_alcohol ?? true

  // Tenant-level alcohol-free override
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', auth.user.id).single()
  let tenantAlcoholFree = false
  if (u?.tenant_id) {
    const { data: t } = await supabase.from('tenants').select('alcohol_free').eq('id', u.tenant_id).maybeSingle()
    tenantAlcoholFree = !!t?.alcohol_free
  }
  const showAlcohol = tenantAlcoholFree ? false : showAlcoholPref

  // Query selected ideas in range, joining events
  const { data, error } = await supabase
    .from('event_occurrences')
    .select('start_date, end_date, event_id, events:events(id, name, category, alcohol_flag), ideas:idea_instances!inner(rank_score, selected)')
    .gte('start_date', fmt(from))
    .lte('start_date', fmt(to))
    .eq('ideas.selected', true)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Expand multi-day occurrences into per-day items within [from, to]
  const expandDays = (startISO: string, endISO: string) => {
    const out: string[] = []
    const s = new Date(startISO + 'T00:00:00Z')
    const e = new Date(endISO + 'T00:00:00Z')
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = fmt(d)
      // keep within requested range
      if (iso >= fmt(from) && iso <= fmt(to)) out.push(iso)
    }
    return out
  }

  const base = (data || [])
    .filter((r: any) => {
      if (r.events?.category === 'sports' && !showSports) return false
      if (r.events?.alcohol_flag && !showAlcohol) return false
      return true
    })
    .flatMap((r: any) => {
      const days = expandDays(r.start_date as string, (r.end_date as string) || (r.start_date as string))
      return days.map((d: string) => ({
        date: d,
        event_id: r.events?.id as string,
        name: (r.events?.name || 'Event') as string,
        category: (r.events?.category || 'civic') as string,
        alcohol: !!r.events?.alcohol_flag,
        rank: (r.ideas?.rank_score || 0) as number,
      }))
    })

  // Exclude snoozed items for this user in range
  const { data: snoozes } = await supabase
    .from('inspiration_snoozes')
    .select('event_id, date')
    .gte('date', fmt(from))
    .lte('date', fmt(to))

  const snoozed = new Set<string>(
    (snoozes || []).map((s: any) => `${s.date}|${s.event_id}`)
  )

  const filteredBase = base.filter((i: any) => !snoozed.has(`${i.date}|${i.event_id}`))

  // Fetch latest briefs for involved events
  const eventIds = Array.from(new Set(filteredBase.map((i: any) => i.event_id).filter(Boolean)))
  let briefByEvent: Record<string, { text: string; version: number }> = {}
  if (eventIds.length > 0) {
    const { data: briefs } = await supabase
      .from('event_briefs')
      .select('event_id, text, version')
      .in('event_id', eventIds)
    for (const b of briefs || []) {
      const ev = (b as any).event_id as string
      const v = (b as any).version as number
      const cur = briefByEvent[ev]
      if (!cur || v > cur.version) briefByEvent[ev] = { text: (b as any).text as string, version: v }
    }
  }

  const items = filteredBase.map((i: any) => ({
    date: i.date,
    event_id: i.event_id,
    name: i.name,
    category: i.category,
    alcohol: i.alcohol,
    rank: i.rank,
    hasBrief: !!briefByEvent[i.event_id],
    brief: briefByEvent[i.event_id]?.text || null,
  }))

  // Return up to 2 per day (the selector enforces this, but re-guard here)
  const byDate: Record<string, any[]> = {}
  for (const it of items) {
    (byDate[it.date] ||= []).push(it)
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => b.rank - a.rank)
    byDate[d] = byDate[d].slice(0, 2)
  }
  const flattened = Object.values(byDate).flat()

  return NextResponse.json({ ok: true, items: flattened })
}
