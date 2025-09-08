#!/usr/bin/env tsx
import { RRule, rrulestr } from 'rrule'
import { createServiceRoleClient } from '../../lib/supabase/server'

type EventRow = {
  id: string
  slug: string
  name: string
  category: string
  date_type: string
  rrule: string | null
  fixed_date: string | null
}

function parseDate(dateStr: string): Date {
  // dateStr expected as YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function defaultSpanDays(slug: string, date_type: string): number {
  if (slug === 'british-pie-week') return 7
  if (slug === 'royal-ascot') return 5
  // default single-day
  return 1
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1]
  const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1]

  const now = new Date()
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = fromArg ? parseDate(fromArg) : firstOfMonth
  const to = toArg
    ? parseDate(toArg)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 0))

  const supabase = await createServiceRoleClient()
  const { data: events, error } = await supabase
    .from('events')
    .select('id, slug, name, category, date_type, rrule, fixed_date')
    .eq('active', true)

  if (error) {
    console.error('Failed to load events', error)
    process.exit(1)
  }

  const occurrences: { event_id: string; start_date: string; end_date: string; country: string; certainty: string; metadata: any }[] = []

  for (const e of (events as EventRow[])) {
    // Skip items with no recurrence and no fixed date
    if (!e.rrule && !e.fixed_date) {
      // movable or announced-late items: skip for now, handled by calculators in later PRs
      continue
    }

    if (e.fixed_date && e.date_type === 'fixed') {
      // Generate each year within window based on month/day of fixed_date
      const base = parseDate(e.fixed_date)
      for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
        const d = new Date(Date.UTC(y, base.getUTCMonth(), base.getUTCDate()))
        if (d >= from && d <= to) {
          const span = defaultSpanDays(e.slug, e.date_type)
          occurrences.push({
            event_id: e.id,
            start_date: formatDate(d),
            end_date: formatDate(addDays(d, span - 1)),
            country: 'UK',
            certainty: 'confirmed',
            metadata: null,
          })
        }
      }
      continue
    }

    if (e.rrule) {
      const rule = rrulestr(e.rrule, { forceset: false }) as RRule
      const dates = rule.between(from, to, true)
      for (const d of dates) {
        const span = defaultSpanDays(e.slug, e.date_type)
        occurrences.push({
          event_id: e.id,
          start_date: formatDate(d),
          end_date: formatDate(addDays(d, span - 1)),
          country: 'UK',
          certainty: 'confirmed',
          metadata: null,
        })
      }
      continue
    }
  }

  // Idempotent upsert by (event_id, start_date)
  if (dryRun) {
    console.log(`Would upsert ${occurrences.length} occurrences between ${formatDate(from)} and ${formatDate(to)}.`)
    console.table(occurrences.slice(0, 10))
    return
  }

  // Upsert in batches
  const supabase2 = await createServiceRoleClient()
  const batchSize = 500
  for (let i = 0; i < occurrences.length; i += batchSize) {
    const batch = occurrences.slice(i, i + batchSize)
    const { error: upErr } = await supabase2
      .from('event_occurrences')
      .upsert(batch as any, { onConflict: 'event_id,start_date' })
    if (upErr) {
      console.error('Upsert error', upErr)
      process.exit(1)
    }
  }

  console.log(`Upserted ${occurrences.length} event_occurrences.`)
}

main().catch(err => { console.error(err); process.exit(1) })

