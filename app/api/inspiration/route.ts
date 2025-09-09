import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rrulestr, RRule } from 'rrule'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { orchestrateInspiration } from '@/lib/inspiration/orchestrator'
import { scoreOccurrence, diversityForCategory } from '@/lib/inspiration/scoring'
import { easterSundayUTC, shroveTuesdayUTC, mothersDayUKUTC, goodFridayUTC } from '@/lib/inspiration/calculators'

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

  if (flattened.length > 0) {
    return NextResponse.json({ ok: true, items: flattened })
  }

  // Attempt to populate centrally if selection is missing for this range
  try {
    const res = await orchestrateInspiration({ from: fmt(from), to: fmt(to), dryRun: false, forceBriefs: true })
    if ((res?.selections || 0) > 0) {
      // Re-query persistent selection now that it exists
      const { data: data2 } = await supabase
        .from('event_occurrences')
        .select('start_date, end_date, event_id, events:events(id, name, category, alcohol_flag), ideas:idea_instances!inner(rank_score, selected)')
        .gte('start_date', fmt(from))
        .lte('start_date', fmt(to))
        .eq('ideas.selected', true)
      const base2 = (data2 || [])
        .filter((r: any) => {
          if (r.events?.category === 'sports' && !showSports) return false
          if (r.events?.alcohol_flag && !showAlcohol) return false
          return true
        })
        .flatMap((r: any) => {
          const expandDays = (startISO: string, endISO: string) => {
            const out: string[] = []
            const s = new Date(startISO + 'T00:00:00Z')
            const e = new Date(endISO + 'T00:00:00Z')
            for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
              const iso = fmt(d)
              if (iso >= fmt(from) && iso <= fmt(to)) out.push(iso)
            }
            return out
          }
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
      // Fetch briefs and return
      const eids2 = Array.from(new Set(base2.map((i: any) => i.event_id)))
      let briefsMap2: Record<string, string> = {}
      if (eids2.length) {
        const { data: briefs } = await supabase
          .from('event_briefs')
          .select('event_id, text, version')
          .in('event_id', eids2)
        const best: Record<string, { v: number; t: string }> = {}
        for (const b of briefs || []) {
          const ev = (b as any).event_id as string
          const v = (b as any).version as number
          if (!best[ev] || v > best[ev].v) best[ev] = { v, t: (b as any).text as string }
        }
        briefsMap2 = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.t]))
      }

      // Snoozes
      const snoozedKeys2 = new Set<string>()
      try {
        const { data: sno } = await supabase
          .from('inspiration_snoozes')
          .select('event_id, date')
          .gte('date', fmt(from))
          .lte('date', fmt(to))
        for (const s of sno || []) snoozedKeys2.add(`${(s as any).date}|${(s as any).event_id}`)
      } catch {}

      const byDate2: Record<string, any[]> = {}
      for (const it of base2) { (byDate2[it.date] ||= []).push(it) }
      for (const d of Object.keys(byDate2)) {
        byDate2[d].sort((a, b) => b.rank - a.rank)
        byDate2[d] = byDate2[d].slice(0, 2)
      }
      const flattened2 = Object.values(byDate2).flat()
      const out2 = flattened2
        .filter(p => !snoozedKeys2.has(`${p.date}|${p.event_id}`))
        .map(p => ({ ...p, hasBrief: !!briefsMap2[p.event_id], brief: briefsMap2[p.event_id] || null }))
      if (out2.length > 0) return NextResponse.json({ ok: true, items: out2 })
    }
  } catch {}

  // Fallback: compute ephemeral suggestions when no selections exist yet for the range
  // 1) Load active events
  let { data: events } = await supabase
    .from('events')
    .select('id, slug, name, category, alcohol_flag, date_type, rrule, fixed_date, active')
    .eq('active', true)

  // If DB has no events (first-run / local env), load curated YAML as fallback
  if (!events || events.length === 0) {
    try {
      const filePath = path.resolve(process.cwd(), 'data/inspiration/events.yaml')
      const raw = await fs.readFile(filePath, 'utf8')
      const yamlEvents = parse(raw) as any[]
      events = (yamlEvents || []).map(e => ({
        id: null, // no DB id in fallback
        slug: e.slug,
        name: e.name,
        category: e.category,
        alcohol_flag: !!e.alcohol_flag,
        date_type: e.date_type,
        rrule: e.rrule ?? null,
        fixed_date: e.fixed_date ?? null,
        active: e.active ?? true,
      }))
    } catch (e) {
      // if YAML missing, keep events as empty
    }
  }

  // 2) Expand occurrences on the fly
  function fmtDate(d: Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`
  }
  function defaultSpanDays(slug: string, dateType: string): number {
    if (slug === 'british-pie-week') return 7
    if (slug === 'royal-ascot') return 5
    if (slug === 'afternoon-tea-week') return 7
    if (slug === 'british-sandwich-week') return 7
    if (slug === 'national-vegetarian-week') return 7
    if (slug === 'notting-hill-carnival') return 2
    if (slug === 'edinburgh-fringe-opening-weekend') return 3
    return 1
  }
  function expandEvent(e: any): { date: string; event_id: string }[] {
    const out: { date: string; event_id: string }[] = []
    const fromISO = fmt(from)
    const toISO = fmt(to)
    const span = defaultSpanDays(e.slug, e.date_type)

    // Calculators
    if (e.slug === 'pancake-day') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = shroveTuesdayUTC(y)
        const iso = fmtDate(d)
        if (iso >= fromISO && iso <= toISO) out.push({ date: iso, event_id: e.id })
      }
      return out
    }
    if (e.slug === 'mothers-day-uk') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = mothersDayUKUTC(y)
        const iso = fmtDate(d)
        if (iso >= fromISO && iso <= toISO) out.push({ date: iso, event_id: e.id })
      }
      return out
    }
    if (e.slug === 'easter-sunday') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = easterSundayUTC(y)
        const iso = fmtDate(d)
        if (iso >= fromISO && iso <= toISO) out.push({ date: iso, event_id: e.id })
      }
      return out
    }
    if (e.slug === 'good-friday') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = goodFridayUTC(y)
        const iso = fmtDate(d)
        if (iso >= fromISO && iso <= toISO) out.push({ date: iso, event_id: e.id })
      }
      return out
    }

    // Fixed date each year
    if (e.date_type === 'fixed' && e.fixed_date) {
      const base = new Date(e.fixed_date + 'T00:00:00Z')
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = new Date(Date.UTC(y, base.getUTCMonth(), base.getUTCDate()))
        const iso = fmtDate(d)
        if (iso >= fromISO && iso <= toISO) {
          for (let i = 0; i < span; i++) {
            const dd = new Date(d); dd.setUTCDate(dd.getUTCDate() + i)
            const iso2 = fmtDate(dd)
            if (iso2 >= fromISO && iso2 <= toISO) out.push({ date: iso2, event_id: e.id })
          }
        }
      }
      return out
    }
    // RRULE
    if (e.rrule) {
      try {
        const rule = rrulestr(e.rrule, { forceset: false }) as RRule
        const dates = rule.between(from, to, true)
        for (const d of dates) {
          for (let i = 0; i < span; i++) {
            const dd = new Date(d); dd.setUTCDate(dd.getUTCDate() + i)
            const iso2 = fmtDate(dd)
            if (iso2 >= fromISO && iso2 <= toISO) out.push({ date: iso2, event_id: e.id })
          }
        }
      } catch {}
      return out
    }
    return out
  }

  const occs: { date: string; event_id: string | null; category: string; slug: string; alcohol: boolean; name: string }[] = []
  for (const e of events || []) {
    if (e.category === 'sports' && !showSports) continue
    if (e.alcohol_flag && !showAlcohol) continue
    const dates = expandEvent(e)
    for (const d of dates) {
      occs.push({ date: d.date, event_id: (e.id as string) || null, category: e.category as string, slug: e.slug as string, alcohol: !!e.alcohol_flag, name: e.name as string })
    }
  }

  // Score and pick top 2/day
  const byDay: Record<string, typeof occs> = {}
  for (const o of occs) { (byDay[o.date] ||= []).push(o) }
  const picks: any[] = []
  const DIVERSITY_PREF = ['civic', 'seasonal', 'sports', 'food_drink']
  const order = (b: string) => DIVERSITY_PREF.indexOf(b as any)
  for (const day of Object.keys(byDay)) {
    const items = byDay[day]
    const scored = items.map(o => ({
      o,
      s: scoreOccurrence(o.slug, o.category, o.date),
      b: (o.category === 'drink' || o.category === 'food') ? 'food_drink' : (o.category as any)
    }))
    scored.sort((a, b) => b.s - a.s)
    const sel: typeof scored = []
    for (const s of scored) {
      if (sel.length === 0) { sel.push(s); continue }
      if (sel.length === 1) {
        const top = sel[0]
        const close = Math.abs(top.s - s.s) <= 7
        if (close) {
          const aBetter = order(s.b) < order(top.b)
          sel.push(aBetter ? s : top)
          if (aBetter) sel[0] = s
        } else {
          sel.push(s)
        }
      }
      if (sel.length >= 2) break
    }
    for (const p of sel.slice(0, 2)) {
      picks.push({ date: p.o.date, event_id: p.o.event_id, name: p.o.name, category: p.o.category, alcohol: p.o.alcohol, rank: Math.round(p.s) })
    }
  }

  // Attach briefs if available
  const eids = Array.from(new Set(picks.map(p => p.event_id).filter(Boolean) as string[]))
  let briefsMap: Record<string, string> = {}
  if (eids.length) {
    const { data: briefs } = await supabase.from('event_briefs').select('event_id, text, version').in('event_id', eids)
    const best: Record<string, { v: number; t: string }> = {}
    for (const b of briefs || []) {
      const ev = (b as any).event_id as string
      const v = (b as any).version as number
      if (!best[ev] || v > best[ev].v) best[ev] = { v, t: (b as any).text as string }
    }
    briefsMap = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.t]))
  }

  // Reuse snoozes from earlier (if any) — only applicable when event_id exists
  const snoozedKeys = new Set<string>()
  try {
    const { data: sno } = await supabase
      .from('inspiration_snoozes')
      .select('event_id, date')
      .gte('date', fmt(from))
      .lte('date', fmt(to))
    for (const s of sno || []) snoozedKeys.add(`${(s as any).date}|${(s as any).event_id}`)
  } catch {}

  const out = picks
    .filter(p => !p.event_id || !snoozedKeys.has(`${p.date}|${p.event_id}`))
    .map(p => ({ ...p, hasBrief: p.event_id ? !!briefsMap[p.event_id] : false, brief: p.event_id ? (briefsMap[p.event_id] || null) : null }))
  return NextResponse.json({ ok: true, items: out })
}
