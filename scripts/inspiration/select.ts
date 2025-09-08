#!/usr/bin/env tsx
import { createServiceRoleClient } from '../../lib/supabase/server'
import { scoreOccurrence, diversityForCategory } from '../../lib/inspiration/scoring'

type JoinedOccurrence = {
  id: string
  event_id: string
  start_date: string
  end_date: string
  category: string
  slug: string
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function groupBy<T, K extends string | number>(items: T[], key: (t: T) => K): Record<K, T[]> {
  return items.reduce((acc, item) => {
    const k = key(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {} as Record<K, T[]>)
}

const DIVERSITY_PREF = ['civic', 'seasonal', 'sports', 'food_drink'] as const

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1]
  const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1]

  const now = new Date()
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = fromArg ? new Date(fromArg + 'T00:00:00Z') : firstOfMonth
  const to = toArg ? new Date(toArg + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 0))

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('event_occurrences')
    .select('id, event_id, start_date, end_date, events:events(category, slug)')
    .gte('start_date', formatDate(from))
    .lte('start_date', formatDate(to))

  if (error) {
    console.error('Failed to load occurrences', error)
    process.exit(1)
  }

  const rows = (data || []).map((r: any) => ({
    id: r.id as string,
    event_id: r.event_id as string,
    start_date: r.start_date as string,
    end_date: r.end_date as string,
    category: (r.events?.category || 'civic') as string,
    slug: (r.events?.slug || '') as string,
  })) as JoinedOccurrence[]

  const byDate = groupBy(rows, r => r.start_date)
  const selections: { occurrence_id: string; rank_score: number; diversity_bucket: string; selected: boolean; tags: string[] }[] = []

  for (const date of Object.keys(byDate)) {
    const day = byDate[date]
    const scored = day.map(o => ({
      o,
      score: scoreOccurrence(o.slug, o.category, o.start_date),
      bucket: diversityForCategory(o.category),
    }))

    // Sort by score desc
    scored.sort((a, b) => b.score - a.score)

    // Diversity tie-break when close (±7)
    const pick: typeof scored = []
    for (const s of scored) {
      if (pick.length === 0) {
        pick.push(s)
        continue
      }
      if (pick.length === 1) {
        const top = pick[0]
        const close = Math.abs(top.score - s.score) <= 7
        if (close) {
          // prefer bucket order
          const order = (b: string) => DIVERSITY_PREF.indexOf(b as any)
          const aBetter = order(s.bucket) < order(diversityForCategory(top.o.category))
          pick.push(aBetter ? s : top)
          if (aBetter) pick[0] = s
        } else {
          pick.push(s)
        }
      }
      if (pick.length >= 2) break
    }

    for (const p of pick.slice(0, 2)) {
      selections.push({
        occurrence_id: p.o.id,
        rank_score: Math.round(p.score),
        diversity_bucket: p.bucket,
        selected: true,
        tags: [],
      })
    }
  }

  if (dryRun) {
    console.log(`Would upsert ${selections.length} idea_instances for range ${formatDate(from)} to ${formatDate(to)}.`)
    console.table(selections.slice(0, 10))
    return
  }

  const batchSize = 500
  for (let i = 0; i < selections.length; i += batchSize) {
    const batch = selections.slice(i, i + batchSize)
    const { error: upErr } = await supabase
      .from('idea_instances')
      .upsert(batch as any, { onConflict: 'occurrence_id' })
    if (upErr) {
      console.error('Upsert idea_instances failed', upErr)
      process.exit(1)
    }
  }
  console.log(`Upserted ${selections.length} idea_instances.` )
}

main().catch(err => { console.error(err); process.exit(1) })

