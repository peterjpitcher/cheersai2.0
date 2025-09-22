import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { ok, unauthorized } from '@/lib/http'
// DB-only mode: no YAML/runtime fallbacks

export const runtime = 'nodejs'

function fmt(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type EventOccurrenceRow = {
  start_date: string
  end_date: string | null
  event_id: string
  events: {
    id: string
    name: string | null
    category: string | null
    alcohol_flag: boolean | null
    dedupe_key: string | null
    slug: string | null
  } | null
  ideas: {
    rank_score: number | null
    selected: boolean | null
  } | null
}

type SnoozeRow = { event_id: string; date: string }

type EventBriefRow = { event_id: string; text: string | null; version: number | null }

type BaseItem = {
  date: string
  event_id: string
  name: string
  category: string
  alcohol: boolean
  rank: number
  dedupe_key: string
  slug: string
}

type InspirationItem = {
  date: string
  event_id: string
  name: string
  category: string
  alcohol: boolean
  rank: number
  hasBrief: boolean
  brief: string | null
}

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return unauthorized('Authentication required', undefined, request)

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
    // Future: consult tenant-level preferences when available in schema
    tenantAlcoholFree = false
  }
  const showAlcohol = tenantAlcoholFree ? false : showAlcoholPref

  // Query selected ideas in range, joining events
  // Fetch occurrences that OVERLAP the requested window:
  // (start_date <= to) AND ((end_date >= from) OR end_date IS NULL AND start_date >= from)
  const { data, error } = await supabase
    .from('event_occurrences')
    .select('start_date, end_date, event_id, events:events(id, name, category, alcohol_flag, dedupe_key, slug), ideas:idea_instances!inner(rank_score, selected)')
    .lte('start_date', fmt(to))
    .or(`and(end_date.gte.${fmt(from)}),and(end_date.is.null,start_date.gte.${fmt(from)})`)
    .eq('ideas.selected', true)
    .returns<EventOccurrenceRow[]>()
  // If the primary selection query errors (e.g., tables not migrated yet),
  // continue and return an empty set in DB-only mode.
  if (error) {
    reqLogger.warn('Inspiration selection query failed', {
      area: 'inspiration',
      op: 'select',
      status: 'warn',
      details: error.message,
    })
    logger.warn('[inspiration] selection query failed', {
      area: 'inspiration',
      op: 'select',
      status: 'warn',
      details: error.message,
    })
  }

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

  const baseRaw: BaseItem[] = (data ?? [])
    .filter((row) => {
      if (row.events?.category === 'sports' && !showSports) return false
      if (row.events?.alcohol_flag && !showAlcohol) return false
      return true
    })
    .flatMap((row) => {
      const endDate = row.end_date ?? row.start_date
      const event = row.events
      const idea = row.ideas
      const days = expandDays(row.start_date, endDate)
      return days.map<BaseItem>((day) => ({
        date: day,
        event_id: event?.id ?? row.event_id,
        name: event?.name ?? 'Event',
        category: event?.category ?? 'civic',
        alcohol: Boolean(event?.alcohol_flag),
        rank: idea?.rank_score ?? 0,
        dedupe_key: event?.dedupe_key ?? event?.slug ?? row.event_id ?? 'unknown',
        slug: event?.slug ?? '',
      }))
    })

  // De-duplicate by (date, dedupe_key), preferring curated (non bank-holiday slugs)
  const grouped = new Map<string, BaseItem[]>()
  for (const it of baseRaw) {
    const k = `${it.date}|${it.dedupe_key}`
    const arr = grouped.get(k) || []
    arr.push(it)
    grouped.set(k, arr)
  }
  const base: BaseItem[] = []
  for (const [, arr] of grouped.entries()) {
    arr.sort((a, b) => {
      const aBH = String(a.slug || '').startsWith('uk-bank-holiday-') ? 1 : 0
      const bBH = String(b.slug || '').startsWith('uk-bank-holiday-') ? 1 : 0
      if (aBH !== bBH) return aBH - bBH
      return b.rank - a.rank
    })
    base.push(arr[0])
  }

  // Exclude snoozed items for this user in range
  const { data: snoozes } = await supabase
    .from('inspiration_snoozes')
    .select('event_id, date')
    .gte('date', fmt(from))
    .lte('date', fmt(to))
    .returns<SnoozeRow[]>()

  const snoozed = new Set<string>((snoozes ?? []).map((s) => `${s.date}|${s.event_id}`))

  const filteredBase = base.filter((item) => !snoozed.has(`${item.date}|${item.event_id}`))

  // Fetch latest briefs for involved events
  const eventIds = Array.from(new Set(filteredBase.map((item) => item.event_id)))
  const briefByEvent: Record<string, { text: string; version: number }> = {}
  if (eventIds.length > 0) {
    const { data: briefs } = await supabase
      .from('event_briefs')
      .select('event_id, text, version')
      .in('event_id', eventIds)
      .returns<EventBriefRow[]>()
    for (const brief of briefs ?? []) {
      const eventId = brief.event_id
      const version = brief.version ?? 0
      const current = briefByEvent[eventId]
      if (!current || version > current.version) {
        briefByEvent[eventId] = { text: brief.text ?? '', version }
      }
    }
  }

  const items: InspirationItem[] = filteredBase.map((item) => ({
    date: item.date,
    event_id: item.event_id,
    name: item.name,
    category: item.category,
    alcohol: item.alcohol,
    rank: item.rank,
    hasBrief: Boolean(briefByEvent[item.event_id]),
    brief: briefByEvent[item.event_id]?.text ?? null,
  }))

  // Return up to 2 per day (the selector enforces this, but re-guard here)
  const byDate: Record<string, InspirationItem[]> = {}
  for (const it of items) {
    (byDate[it.date] ||= []).push(it)
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => b.rank - a.rank)
    byDate[d] = byDate[d].slice(0, 2)
  }
  const flattened = Object.values(byDate).flat()

  if (flattened.length > 0) {
    reqLogger.info('Inspiration items returned', {
      area: 'inspiration',
      op: 'fetch',
      status: 'ok',
      meta: { count: flattened.length },
    })
    return ok({ items: flattened }, request)
  }

  reqLogger.info('Inspiration returned empty set', {
    area: 'inspiration',
    op: 'fetch',
    status: 'ok',
    meta: { count: 0 },
  })

  // DB-only: no runtime fallback — return empty set when no selections exist
  return ok({ items: [] }, request)
}
