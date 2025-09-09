import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { rrulestr, RRule } from 'rrule'
import { createServiceRoleClient } from '../supabase/server'
import { scoreOccurrence, diversityForCategory } from './scoring'
import { easterSundayUTC, shroveTuesdayUTC, mothersDayUKUTC, addDaysUTC, goodFridayUTC } from './calculators'

type SeedEvent = {
  slug: string
  name: string
  category: string
  alcohol_flag?: boolean
  date_type: string
  rrule?: string | null
  fixed_date?: string | null
  source_url?: string | null
  uk_centric?: boolean
  aliases?: string[]
  notes?: string | null
  active?: boolean
}

function iso(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDateISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function defaultSpanDays(slug: string, date_type: string): number {
  if (slug === 'british-pie-week') return 7
  if (slug === 'royal-ascot') return 5
  if (slug === 'afternoon-tea-week') return 7
  if (slug === 'british-sandwich-week') return 7
  if (slug === 'national-vegetarian-week') return 7
  if (slug === 'notting-hill-carnival') return 2
  if (slug === 'edinburgh-fringe-opening-weekend') return 3
  return 1
}

export async function orchestrateInspiration(opts?: { from?: string; to?: string; dryRun?: boolean; forceBriefs?: boolean }) {
  const from = opts?.from ? parseDateISO(opts.from) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const to = opts?.to ? parseDateISO(opts.to) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 13, 0))
  const dryRun = !!opts?.dryRun
  const forceBriefs = !!opts?.forceBriefs

  const supabase = await createServiceRoleClient()

  // Try advisory lock to avoid overlapping runs
  const { data: gotLock } = await supabase.rpc('acquire_inspiration_lock')
  if (!opts?.dryRun && gotLock === false) {
    return { imported: 0, occurrences: 0, selections: 0, briefs: 0, from: iso(from), to: iso(to), dryRun: !!opts?.dryRun, skipped: 'lock_not_acquired' }
  }

  // 1) Import catalog
  const filePath = path.resolve(process.cwd(), 'data/inspiration/events.yaml')
  const raw = parse(await fs.readFile(filePath, 'utf8')) as SeedEvent[]
  const upsertEvents = raw.map(e => ({
    slug: e.slug,
    name: e.name,
    aliases: e.aliases ?? [],
    category: e.category,
    alcohol_flag: !!e.alcohol_flag,
    date_type: e.date_type,
    rrule: e.rrule ?? null,
    fixed_date: e.fixed_date ?? null,
    source_url: e.source_url ?? null,
    uk_centric: true,
    notes: e.notes ?? null,
    active: e.active ?? true,
  }))
  if (!dryRun) {
    const { error } = await supabase.from('events').upsert(upsertEvents, { onConflict: 'slug' })
    if (error) throw error
  }

  // 1b) Integrate UK bank holidays (England & Wales feed) — open/public
  try {
    const res = await fetch('https://www.gov.uk/bank-holidays.json', { cache: 'no-store' })
    if (res.ok) {
      const json: any = await res.json()
      const feed = json['england-and-wales'] as { events: { title: string; date: string }[] }
      const bhEvents = (feed?.events || []).filter(ev => {
        // Keep those within our horizon +/- 1 year buffer
        const dt = ev.date
        return (!opts?.from || dt >= opts.from) && (!opts?.to || dt <= opts.to)
      })
      const bhUpserts = bhEvents.map(ev => ({
        slug: 'uk-bank-holiday-' + ev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: ev.title,
        aliases: [],
        category: 'civic',
        alcohol_flag: false,
        date_type: 'fixed',
        rrule: null,
        fixed_date: ev.date,
        source_url: 'https://www.gov.uk/bank-holidays',
        uk_centric: true,
        notes: 'Official UK bank holiday (England & Wales feed).',
        active: true,
      }))
      if (!dryRun && bhUpserts.length) {
        await supabase.from('events').upsert(bhUpserts as any, { onConflict: 'slug' })
        const { data: evRows } = await supabase.from('events').select('id, slug').in('slug', bhUpserts.map(e => e.slug))
        const map = new Map<string, string>((evRows || []).map(r => [r.slug as string, r.id as string]))
        const occ = bhEvents.map(ev => ({
          event_id: map.get('uk-bank-holiday-' + ev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))!,
          start_date: ev.date,
          end_date: ev.date,
          country: 'UK',
          certainty: 'confirmed',
          metadata: null,
        })).filter(o => !!o.event_id)
        if (occ.length) await supabase.from('event_occurrences').upsert(occ as any, { onConflict: 'event_id,start_date' })
      }
    }
  } catch {
    // Non-fatal: continue without bank holidays
  }

  // Load events with ids
  const { data: events } = await supabase.from('events').select('id, slug, name, category, date_type, rrule, fixed_date, alcohol_flag').eq('active', true)

  // 2) Expand occurrences (RRULE + calculators)
  const occurrences: { event_id: string; start_date: string; end_date: string; country: string; certainty: string; metadata: any }[] = []
  for (const e of events || []) {
    // Calculator-based
    if (e.slug === 'pancake-day') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = shroveTuesdayUTC(y)
        if (d >= from && d <= to) occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(d), country: 'UK', certainty: 'confirmed', metadata: null })
      }
      continue
    }
    if (e.slug === 'mothers-day-uk') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = mothersDayUKUTC(y)
        if (d >= from && d <= to) occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(d), country: 'UK', certainty: 'confirmed', metadata: null })
      }
      continue
    }
    if (e.slug === 'easter-sunday') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = easterSundayUTC(y)
        if (d >= from && d <= to) occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(d), country: 'UK', certainty: 'confirmed', metadata: null })
      }
      continue
    }
    if (e.slug === 'good-friday') {
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = goodFridayUTC(y)
        if (d >= from && d <= to) occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(d), country: 'UK', certainty: 'confirmed', metadata: null })
      }
      continue
    }

    // Fixed date
    if (e.fixed_date && e.date_type === 'fixed') {
      const base = parseDateISO(e.fixed_date)
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = new Date(Date.UTC(y, base.getUTCMonth(), base.getUTCDate()))
        if (d >= from && d <= to) {
          const span = defaultSpanDays(e.slug, e.date_type)
          occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(addDaysUTC(d, span - 1)), country: 'UK', certainty: 'confirmed', metadata: null })
        }
      }
      continue
    }
    // RRULE
    if (e.rrule) {
      const rule = rrulestr(e.rrule, { forceset: false }) as RRule
      const dates = rule.between(from, to, true)
      for (const d of dates) {
        const span = defaultSpanDays(e.slug, e.date_type)
        occurrences.push({ event_id: e.id, start_date: iso(d), end_date: iso(addDaysUTC(d, span - 1)), country: 'UK', certainty: 'confirmed', metadata: null })
      }
      continue
    }
    // Unknown (announced-late) — skip for now
  }

  if (!dryRun && occurrences.length) {
    const batchSize = 500
    for (let i = 0; i < occurrences.length; i += batchSize) {
      const batch = occurrences.slice(i, i + batchSize)
      const { error: upErr } = await supabase.from('event_occurrences').upsert(batch as any, { onConflict: 'event_id,start_date' })
      if (upErr) throw upErr
    }
  }

  // 3) Selection (top 2/day)
  const { data: occ } = await supabase
    .from('event_occurrences')
    .select('id, start_date, event_id, events:events(slug, category)')
    .gte('start_date', iso(from))
    .lte('start_date', iso(to))

  const byDate = new Map<string, any[]>()
  for (const r of occ || []) {
    const arr = byDate.get(r.start_date) || []
    arr.push(r)
    byDate.set(r.start_date, arr)
  }

  const selections: any[] = []
  const pref = ['civic', 'seasonal', 'sports', 'food_drink']
  for (const [date, rows] of byDate.entries()) {
    const scored = rows.map((r: any) => ({ r, s: scoreOccurrence(r.events?.slug || '', r.events?.category || 'civic', date), b: diversityForCategory(r.events?.category || 'civic') }))
    scored.sort((a: any, b: any) => b.s - a.s)
    const pick: any[] = []
    for (const s of scored) {
      if (pick.length === 0) { pick.push(s); continue }
      if (pick.length === 1) {
        const top = pick[0]
        const close = Math.abs(top.s - s.s) <= 7
        if (close) {
          const order = (x: string) => pref.indexOf(x as any)
          const aBetter = order(s.b) < order(pick[0].b)
          pick.push(aBetter ? s : top)
          if (aBetter) pick[0] = s
        } else {
          pick.push(s)
        }
      }
      if (pick.length >= 2) break
    }
    for (const p of pick.slice(0, 2)) {
      selections.push({ occurrence_id: p.r.id, rank_score: Math.round(p.s), diversity_bucket: p.b, selected: true, tags: [] })
    }
  }

  if (!dryRun && selections.length) {
    const batchSize = 500
    for (let i = 0; i < selections.length; i += batchSize) {
      const batch = selections.slice(i, i + batchSize)
      const { error: upErr } = await supabase.from('idea_instances').upsert(batch as any, { onConflict: 'occurrence_id' })
      if (upErr) throw upErr
    }
  }

  // 4) Briefs (create or refresh when forced)
  const { data: briefs } = await supabase.from('event_briefs').select('event_id, version')
  const have = new Map((briefs || []).map(b => [b.event_id as string, b.version as number]))

  const upserts: any[] = []
  for (const e of events || []) {
    const hasBrief = have.has(e.id)
    if (hasBrief && !forceBriefs) continue
    const text = buildBriefForEvent(e)
    const version = (have.get(e.id) || 0) + 1
    upserts.push({ event_id: e.id, version, text, constraints_applied: ['no_emojis','no_links','no_prices'], drinkaware_applicable: !!e.alcohol_flag })
  }
  if (!dryRun && upserts.length) {
    const { error: upErr } = await supabase.from('event_briefs').upsert(upserts, { onConflict: 'event_id,version' })
    if (upErr) throw upErr
  }

  const result = {
    imported: upsertEvents.length,
    occurrences: occurrences.length,
    selections: selections.length,
    briefs: upserts.length,
    from: iso(from),
    to: iso(to),
    dryRun,
  }

  if (!dryRun) {
    await supabase.rpc('release_inspiration_lock')
  }
  return result
}

function buildBriefForEvent(e: any): string {
  const alcoholNote = e.alcohol_flag ? 'For alcohol-related content, include a responsible-drinking reminder (DrinkAware.co.uk).' : ''
  const bucket = e.category === 'sports' ? 'sports' : e.category === 'drink' ? 'drinks' : e.category

  const dateSpecifics = (() => {
    if (e.fixed_date && e.date_type === 'fixed') {
      const [y, m, d] = String(e.fixed_date).split('-')
      return `Date: ${d}/${m} (annually in the UK).`
    }
    if (e.rrule) return 'Follows a published annual pattern; confirm UK dates each year.'
    if (e.slug === 'pancake-day') return 'Date varies each year (Shrove Tuesday); confirm the exact date from UK calendars.'
    return 'Exact dates/times are announced annually; confirm closer to the event.'
  })()

  const parts = [
    `${e.name} is a UK-centric ${bucket} moment with strong hospitality potential. Use it to drive bookings, footfall, and community engagement. ${dateSpecifics}`,
    'Why it matters: Elevated awareness and social buzz mean guests are primed to plan meals out, try specials, and gather with friends and family. Align your menu and service to the occasion to capture intent and encourage advance bookings.',
    'Activation ideas: Create a limited-time menu or set menu; run themed dishes or tasting flights; suggest pairings; host a viewing party or live activity where relevant; encourage table reservations; offer pre-order options for groups; prompt newsletter sign-ups at the point of interest.',
    'Content angles: Teaser (what to expect and booking prompt), day-of (hero dish/drink, venue vibe, and last-minute availability), recap (photos and highlights with a nudge to follow for the next occasion). Keep copy clear and welcoming; avoid prices or discounts in the caption.',
    'Hashtags: #UKHospitality #LocalVenue #BookNow #FoodAndDrink #WhatsOn #Community #GoodTimes',
    'Asset brief: Shoot a well-lit hero image of the star dish/drink; add a lifestyle shot that shows ambience and happy guests; include a clean menu graphic for stories; prepare alt-text describing the image clearly for accessibility.',
    alcoholNote,
  ]
  let text = parts.filter(Boolean).join(' ')
  const words = text.trim().split(/\s+/)
  if (words.length < 240) {
    text += ' Add a friendly, inclusive tone and a clear call to action (book, message, or visit). Keep details accurate and locally relevant, and confirm final dates and times before publishing.'
  }
  return text.trim()
}
