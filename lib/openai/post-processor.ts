import { enforcePlatformLimits } from '@/lib/utils/text'
import { toLocalYMD, formatGbDayMonth } from '@/lib/utils/time'

type PostProcessorInput = {
  content: string
  platform: string
  campaignType?: string | null
  campaignName?: string | null
  eventDate?: string | Date | null
  scheduledFor?: string | Date | null
  relativeTiming?: string | null
  brand?: { booking_url?: string | null; website_url?: string | null }
  voiceBaton?: string | null
  explicitDate?: string | null
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return new Date(value)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const DEFAULT_TIME_ZONE = 'Europe/London'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getLocalTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return { hour, minute }
}

function enforceVoiceHints(content: string, voiceBaton?: string | null) {
  if (!voiceBaton) return content

  const hypePattern = /\b(epic|insane|lit|unreal|awesome|mind[-\s]?blowing)\b/gi
  if (!hypePattern.test(voiceBaton)) {
    content = content.replace(hypePattern, 'brilliant')
  }

  return content
}

function ensureSingleMention(content: string, phrase?: string | null, options?: { fallbackLine?: string }) {
  if (!phrase) return content
  const trimmed = phrase.trim()
  if (!trimmed) return content
  const regex = new RegExp(`\b${escapeRegExp(trimmed)}\b`, 'gi')
  const matches = content.match(regex)?.length ?? 0
  if (matches === 0) {
    const fallback = options?.fallbackLine ?? trimmed
    const separator = content.trim().length ? '\n\n' : ''
    content = `${content.trim()}${separator}${fallback.endsWith('.') ? fallback : `${fallback}.`}`.trim()
    return content
  }
  if (matches > 1) {
    let seen = false
    content = content.replace(regex, () => {
      if (!seen) {
        seen = true
        return trimmed
      }
      return ''
    })
    content = content.replace(/\s{2,}/g, ' ').replace(/\s([,.;!?])/g, '$1')
  }
  return content
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
  const ed = parseDate(eventDate)
  if (!ed) return null
  try {
    const sd = parseDate(scheduledFor)
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

const OFFER_KEYWORDS = /offer|deal|discount|promotion|promo|bundle|two[-\s]?for[-\s]?one|happy hour|manager'?s special/i

export function enforceOfferRules(text: string, campaignType?: string | null, campaignName?: string | null, eventDate?: string | Date | null, scheduledFor?: string | Date | null): string {
  const isOffer = OFFER_KEYWORDS.test(String(campaignType || '')) || OFFER_KEYWORDS.test(String(campaignName || ''))
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

export function normalizeSameDay(
  text: string,
  scheduledFor?: string | Date | null,
  eventDate?: string | Date | null,
): string {
  if (!scheduledFor) return text

  try {
    const schedDate = parseDate(scheduledFor)
    if (!schedDate) return text

    let output = text
    const today = toLocalYMD(new Date())
    const schedYMD = toLocalYMD(schedDate)
    if (today && schedYMD && today === schedYMD) {
      output = output
        .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, 'today')
        .replace(/\btomorrow(\s+night)?\b/gi, (_m, g1) => (g1 ? 'tonight' : 'today'))
    }

    const event = parseDate(eventDate ?? null)
    if (event) {
      const eventYMD = toLocalYMD(event)
      if (eventYMD === schedYMD) {
        const { hour } = getLocalTimeParts(schedDate, DEFAULT_TIME_ZONE)
        const replacement = hour >= 16 ? 'tonight' : 'today'
        output = output
          .replace(/\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, replacement)
          .replace(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, replacement)
          .replace(/\btomorrow(\s+night)?\b/gi, () => replacement)
      }
    }

    return output
  } catch {
    return text
  }
}

function tidyGeneratedContent(text: string): string {
  if (!text) return text

  const normalisedLines = text
    .split('\n')
    .map((line) => {
      let current = line
      current = current.replace(/\s+,/g, ',')
      current = current.replace(/\s+\.(?=\s|$)/g, '.')
      current = current.replace(/\s+([!?;:])/g, '$1')
      current = current.replace(/\s{2,}/g, ' ')
      current = current.replace(/\bto\s+\./gi, '.')
      current = current.replace(/\b(?:to|from|until|till)\s+(?=[,.;!?])/gi, '')
      current = current.replace(/\bto\s+for\b/gi, 'for')
      return current.replace(/\s+$/g, '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  return normalisedLines
    .replace(/\s+,/g, ',')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/([.!?])(?!\s)([A-Za-z])/g, '$1 $2')
    .replace(/\s+$/gm, '')
    .trim()
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
  content = normalizeSameDay(content, scheduledFor, eventDate)
  // Brand voice hygiene
  content = enforceVoiceHints(content, input.voiceBaton)
  // Remove placeholder artefacts and tidy whitespace
  content = tidyGeneratedContent(content)
  // Enforce timing mentions
  if (input.relativeTiming) {
    content = ensureSingleMention(content, input.relativeTiming, {
      fallbackLine: `Happening ${input.relativeTiming}.`,
    })
  }
  if (input.explicitDate) {
    content = ensureSingleMention(content, input.explicitDate, {
      fallbackLine: `Event date: ${input.explicitDate}.`,
    })
  }
  content = tidyGeneratedContent(content)
  // No Twitter-specific trimming
  return { content }
}
