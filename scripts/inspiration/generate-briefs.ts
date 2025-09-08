#!/usr/bin/env tsx
import { createServiceRoleClient } from '../../lib/supabase/server'

type EventRow = {
  id: string
  slug: string
  name: string
  category: string
  alcohol_flag: boolean
  date_type: string
  rrule: string | null
  fixed_date: string | null
}

function estimateDateSpecifics(e: EventRow): string {
  if (e.fixed_date && e.date_type === 'fixed') {
    const [y, m, d] = e.fixed_date.split('-')
    return `Date: ${d}/${m} (annually in the UK).`
  }
  if (e.rrule) {
    // Give a plain-language summary for common RRULE patterns
    if (e.rrule.includes('BYMONTHDAY')) {
      const m = /BYMONTH=(\d+)/.exec(e.rrule)?.[1]
      const md = /BYMONTHDAY=(\-?\d+)/.exec(e.rrule)?.[1]
      if (m && md) return `Typically observed on ${md.padStart(2, '0')}/${m.padStart(2, '0')} each year in the UK.`
    }
    if (e.rrule.includes('BYSETPOS') && e.rrule.includes('BYDAY')) {
      const month = /BYMONTH=(\d+)/.exec(e.rrule)?.[1]
      const day = /BYDAY=([A-Z]{2})/.exec(e.rrule)?.[1]
      const pos = /BYSETPOS=([-\d]+)/.exec(e.rrule)?.[1]
      const posText = pos === '-1' ? 'the last' : pos === '1' ? 'the first' : `position ${pos}`
      const dayMap: Record<string,string> = { MO:'Monday', TU:'Tuesday', WE:'Wednesday', TH:'Thursday', FR:'Friday', SA:'Saturday', SU:'Sunday' }
      return `Typically falls on ${posText} ${dayMap[day||'MO']} of month ${month} in the UK (confirm exact date each year).`
    }
    return 'Dates follow a published annual pattern; confirm exact UK dates each year.'
  }
  return 'Exact dates/times are announced annually; confirm closer to the event.'
}

function buildBrief(e: EventRow): string {
  const dateLine = estimateDateSpecifics(e)
  const alcoholNote = e.alcohol_flag ? 'For alcohol-related content, include a responsible-drinking reminder (DrinkAware.co.uk).' : ''
  const bucket = e.category === 'sports' ? 'sports' : e.category === 'drink' ? 'drinks' : e.category

  const parts = [
    `${e.name} is a UK-centric ${bucket} moment with strong hospitality potential. Use it to drive bookings, footfall, and community engagement. ${dateLine}`,
    'Why it matters: Elevated awareness and social buzz mean guests are primed to plan meals out, try specials, and gather with friends and family. Align your menu and service to the occasion to capture intent and encourage advance bookings.',
    'Activation ideas: Create a limited-time menu or set menu; run themed dishes or tasting flights; suggest pairings; host a viewing party or live activity where relevant; encourage table reservations; offer pre-order options for groups; prompt newsletter sign-ups at the point of interest.',
    'Content angles: Teaser (what to expect and booking prompt), day-of (hero dish/drink, venue vibe, and last-minute availability), recap (photos and highlights with a nudge to follow for the next occasion). Keep copy clear and welcoming; avoid prices or discounts in the caption.',
    'Hashtags: #UKHospitality #LocalVenue #BookNow #FoodAndDrink #WhatsOn #Community #GoodTimes',
    'Asset brief: Shoot a well-lit hero image of the star dish/drink; add a lifestyle shot that shows ambience and happy guests; include a clean menu graphic for stories; prepare alt-text describing the image clearly for accessibility.',
    alcoholNote,
  ]

  // Aim for ~250 words by adding neutral filler if needed
  let text = parts.filter(Boolean).join(' ')
  const words = text.trim().split(/\s+/)
  if (words.length < 240) {
    const filler = ' Add a friendly, inclusive tone and a clear call to action (book, message, or visit). Keep details accurate and locally relevant, and confirm final dates and times before publishing.'
    text += filler
  }
  return text.trim()
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  const supabase = await createServiceRoleClient()
  const { data: events, error } = await supabase
    .from('events')
    .select('id, slug, name, category, alcohol_flag, date_type, rrule, fixed_date')
    .eq('active', true)

  if (error) {
    console.error('Failed to load events', error)
    process.exit(1)
  }

  // Load existing briefs
  const { data: briefs } = await supabase.from('event_briefs').select('event_id, version')
  const have = new Map((briefs || []).map(b => [b.event_id as string, b.version as number]))

  const upserts: any[] = []
  for (const e of (events as EventRow[])) {
    const hasBrief = have.has(e.id)
    if (hasBrief && !force) continue

    const text = buildBrief(e)
    const version = (have.get(e.id) || 0) + 1
    const drinkaware = !!e.alcohol_flag
    upserts.push({ event_id: e.id, version, text, constraints_applied: ['no_emojis','no_links','no_prices'], drinkaware_applicable: drinkaware })
  }

  if (dryRun) {
    console.log(`Would upsert ${upserts.length} event_briefs.`)
    console.table(upserts.slice(0, 5).map(u => ({ event_id: u.event_id, version: u.version, words: u.text.split(/\s+/).length })))
    return
  }

  if (upserts.length) {
    const { error: upErr } = await supabase.from('event_briefs').upsert(upserts, { onConflict: 'event_id,version' })
    if (upErr) {
      console.error('Upsert event_briefs failed', upErr)
      process.exit(1)
    }
  }

  console.log(`Upserted ${upserts.length} event_briefs.`)
}

main().catch(err => { console.error(err); process.exit(1) })

