#!/usr/bin/env tsx
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { createServiceRoleClient } from '../../lib/supabase/server'

type RawEvent = {
  slug: string
  name: string
  category: 'seasonal' | 'civic' | 'food' | 'drink' | 'sports' | string
  alcohol_flag?: boolean
  date_type: 'fixed' | 'recurring' | 'multi_day' | string
  rrule?: string | null
  fixed_date?: string | null
  source_url?: string | null
  uk_centric?: boolean
  aliases?: string[]
  notes?: string | null
  active?: boolean
}

const ALLOWED_CATEGORIES = new Set(['seasonal', 'civic', 'food', 'drink', 'sports'])
const ALLOWED_DATE_TYPES = new Set(['fixed', 'recurring', 'multi_day'])

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: tsx scripts/inspiration/import.ts <events.yaml> [--dry-run]')
    process.exit(1)
  }
  const dryRun = args.includes('--dry-run')
  const fileArg = args.find(a => !a.startsWith('--'))!
  const filePath = path.resolve(process.cwd(), fileArg)

  const content = await fs.readFile(filePath, 'utf8')
  const raw = parse(content) as RawEvent[]
  if (!Array.isArray(raw)) {
    throw new Error('events.yaml must be a YAML array of events')
  }

  // Validate and normalize
  const errors: string[] = []
  const toUpsert = raw.map((e, idx) => {
    if (!e.slug || !e.name) errors.push(`Row ${idx}: missing slug/name`)
    if (!ALLOWED_CATEGORIES.has(e.category)) errors.push(`Row ${idx}: invalid category: ${e.category}`)
    if (!ALLOWED_DATE_TYPES.has(e.date_type)) errors.push(`Row ${idx}: invalid date_type: ${e.date_type}`)
    if (e.uk_centric === false) errors.push(`Row ${idx}: uk_centric=false not allowed in UK catalog`)
    return {
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
    }
  })

  if (errors.length) {
    console.error('Validation errors:')
    for (const err of errors) console.error('- ' + err)
    process.exit(1)
  }

  console.log(`Parsed ${toUpsert.length} events from ${fileArg}. Dry run: ${dryRun}`)
  if (dryRun) {
    console.table(
      toUpsert.map(e => ({ slug: e.slug, name: e.name, category: e.category, date_type: e.date_type }))
    )
    return
  }

  // Ensure env is loaded/validated (only when writing)
  const Env = (await import('../../env.mjs')).default as any
  if (!Env.NEXT_PUBLIC_SUPABASE_URL || !Env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables')
  }

  const supabase = await createServiceRoleClient()

  // Upsert by slug
  const { error } = await supabase
    .from('events')
    .upsert(toUpsert, { onConflict: 'slug' })
    .select('id')

  if (error) {
    console.error('Upsert failed:', error)
    process.exit(1)
  }

  console.log(`Upserted ${toUpsert.length} events into 'events' table.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
