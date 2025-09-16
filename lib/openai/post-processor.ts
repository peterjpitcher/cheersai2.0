import { enforcePlatformLimits } from '@/lib/utils/text'
import { preflight } from '@/lib/preflight'
import { toLocalYMD, formatGbDayMonth } from '@/lib/utils/time'

type PostProcessorInput = {
  content: string
  platform: string
  campaignType?: string | null
  campaignName?: string | null
  eventDate?: string | Date | null
  scheduledFor?: string | Date | null
  brand?: { booking_url?: string | null; website_url?: string | null }
}

export function normalizeLinks(text: string, platform: string, brand?: { booking_url?: string | null; website_url?: string | null }): string {
  const allowedLink = brand?.booking_url || brand?.website_url || ''
  const key = String(platform || '').toLowerCase()
  if (key === 'instagram_business' || key === 'instagram' || key === 'google_my_business') {
    return text.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  if (allowedLink) {
    const hasAllowed = text.includes(allowedLink)
    const hasAnyUrl = /https?:\/\/\S+|www\.[^\s]+/i.test(text)
    if (!hasAllowed && hasAnyUrl) {
      return text.replace(/https?:\/\/\S+|www\.[^\s]+/i, allowedLink)
    } else if (!hasAllowed && !hasAnyUrl) {
      return `${text}\n\n${allowedLink}`.trim()
    }
  }
  return text
}

function computeEndPhrase(scheduledFor?: string | Date | null, eventDate?: string | Date | null): string | null {
  if (!eventDate) return null
  try {
    const ed = new Date(eventDate as any)
    const sd = scheduledFor ? new Date(scheduledFor as any) : null
    const dayName = ed.toLocaleDateString('en-GB', { weekday: 'long' })
    const longDate = formatGbDayMonth(ed)
    if (!sd) return longDate
    // Compare local YMDs
    const eYMD = toLocalYMD(ed)
    const sYMD = toLocalYMD(sd)
    if (sYMD === eYMD) return 'today'
    const oneDay = 24 * 60 * 60 * 1000
    const diffDays = Math.round((ed.getTime() - sd.getTime()) / oneDay)
    if (diffDays === 1) return 'tomorrow'
    if (diffDays <= 7 && diffDays > 1) {
      // Same or next week language
      const sDow = sd.getDay() // 0..6, 0=Sun
      const eDow = ed.getDay()
      // Determine if event is in same Mon-start week
      const startOfWeek = (d: Date) => { const x = new Date(d); const dow = x.getDay(); const back = (dow === 0 ? 6 : dow - 1); x.setDate(x.getDate() - back); x.setHours(0,0,0,0); return x }
      const sMon = startOfWeek(sd)
      const eMon = startOfWeek(ed)
      if (sMon.getTime() === eMon.getTime()) return `this ${dayName.toLowerCase()}`
      return `next ${dayName.toLowerCase()}`
    }
    // Farther out: use numeric date
    return longDate
  } catch { return null }
}

export function enforceOfferRules(text: string, campaignType?: string | null, campaignName?: string | null, eventDate?: string | Date | null, scheduledFor?: string | Date | null): string {
  const isOffer = /offer|special/i.test(String(campaignType || '')) || /offer|special/i.test(String(campaignName || ''))
  if (!isOffer) return text
  let out = text
    // Strip clock times to keep offers evergreen; leave relative day words intact
    .replace(/\b(?:at|from)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
    .replace(/\s{2,}/g, ' ').trim()
  const computed = computeEndPhrase(scheduledFor, eventDate)
  if (computed) {
    // Replace any existing "offer ends ..." fragment with our computed phrase
    if (/offer\s+ends/i.test(out)) {
      out = out.replace(/(?:this\s+)?offer\s+ends[^.!?\n]*(?:[.!?])?/gi, (m) => {
        // Preserve trailing punctuation if present
        const punct = /[.!?]$/.test(m) ? m.slice(-1) : '.'
        return `Offer ends ${computed}${punct}`
      })
    } else {
      out += `\n\nOffer ends ${computed}.`
    }
  }
  // Normalise naming
  out = out.replace(/Manager'?s Special/gi, 'Manager’s Special')
  return out
}

export function normalizeSameDay(text: string, scheduledFor?: string | Date | null): string {
  if (!scheduledFor) return text
  try {
    const today = toLocalYMD(new Date())
    const sched = toLocalYMD(scheduledFor as any)
    if (today && sched && today === sched) {
      return text
        .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, 'today')
        .replace(/\btomorrow(\s+night)?\b/gi, (_m, g1) => g1 ? 'tonight' : 'today')
    }
  } catch {}
  return text
}

export function postProcessContent(input: PostProcessorInput): { content: string } {
  const { platform, brand, campaignType, campaignName, eventDate, scheduledFor } = input
  let content = input.content || ''
  // Enforce platform limits first
  content = enforcePlatformLimits(content, platform)
  // Offer rules
  content = enforceOfferRules(content, campaignType, campaignName, eventDate, scheduledFor)
  // Links
  content = normalizeLinks(content, platform, brand)
  // Same-day normaliser
  content = normalizeSameDay(content, scheduledFor)
  // No Twitter-specific trimming
  return { content }
}
