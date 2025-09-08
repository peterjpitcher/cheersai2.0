#!/usr/bin/env tsx
import { createServiceRoleClient } from '../../lib/supabase/server'

type BHEvent = { title: string; date: string; notes: string; bunting?: boolean }

async function fetchBankHolidays(): Promise<{ division: string; events: BHEvent[] }> {
  const url = 'https://www.gov.uk/bank-holidays.json'
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch bank holidays: ${res.status}`)
  const json = await res.json()
  // Use England and Wales as default division for UK-wide relevance
  return json['england-and-wales'] as { division: string; events: BHEvent[] }
}

function slugify(title: string): string {
  return 'uk-bank-holiday-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function withinRange(dateISO: string, from?: string, to?: string): boolean {
  if (from && dateISO < from) return false
  if (to && dateISO > to) return false
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const from = args.find(a => a.startsWith('--from='))?.split('=')[1]
  const to = args.find(a => a.startsWith('--to='))?.split('=')[1]

  let feed: { division: string; events: BHEvent[] }
  try {
    feed = await fetchBankHolidays()
  } catch (e) {
    console.error('Network fetch failed. You can vendor a local snapshot and extend this script to read it as a fallback.')
    throw e
  }

  const items = feed.events.filter(ev => withinRange(ev.date, from, to)).map(ev => ({
    slug: slugify(ev.title),
    name: ev.title,
    date: ev.date,
  }))

  console.log(`Fetched ${items.length} bank holiday events in range.`)
  if (dry) {
    console.table(items.slice(0, 10))
    return
  }

  const supabase = await createServiceRoleClient()

  // Upsert events (category civic, alcohol_flag false, date_type fixed)
  const upsertEvents = items.map(it => ({
    slug: it.slug,
    name: it.name,
    aliases: [],
    category: 'civic',
    alcohol_flag: false,
    date_type: 'fixed',
    rrule: null,
    fixed_date: it.date, // base day; we'll also create occurrences per year
    source_url: 'https://www.gov.uk/bank-holidays',
    uk_centric: true,
    notes: 'Official UK bank holiday (England & Wales feed).',
    active: true,
  }))

  const { error: evErr } = await supabase.from('events').upsert(upsertEvents, { onConflict: 'slug' })
  if (evErr) { console.error('Event upsert failed', evErr); process.exit(1) }

  // Map event_id by slug
  const { data: evRows, error: selErr } = await supabase.from('events').select('id, slug').in('slug', upsertEvents.map(e => e.slug))
  if (selErr) { console.error('Event select failed', selErr); process.exit(1) }
  const idBySlug = new Map<string, string>((evRows || []).map(r => [r.slug as string, r.id as string]))

  // Upsert occurrences
  const occ = items.map(it => ({
    event_id: idBySlug.get(it.slug)!,
    start_date: it.date,
    end_date: it.date,
    country: 'UK',
    certainty: 'confirmed',
    metadata: null,
  })).filter(o => !!o.event_id)

  const batchSize = 500
  for (let i = 0; i < occ.length; i += batchSize) {
    const batch = occ.slice(i, i + batchSize)
    const { error } = await supabase.from('event_occurrences').upsert(batch as any, { onConflict: 'event_id,start_date' })
    if (error) { console.error('Occurrence upsert failed', error); process.exit(1) }
  }

  console.log(`Upserted ${occ.length} bank holiday occurrences.`)
}

main().catch(err => { console.error(err); process.exit(1) })

