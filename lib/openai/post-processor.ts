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

export function enforceOfferRules(text: string, campaignType?: string | null, campaignName?: string | null, eventDate?: string | Date | null): string {
  const isOffer = /offer|special/i.test(String(campaignType || '')) || /offer|special/i.test(String(campaignName || ''))
  if (!isOffer) return text
  let out = text
    .replace(/\b(?:at|from)\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, '')
    .replace(/\b(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\btonight\b/gi, '')
    .replace(/\btomorrow(\s+night)?\b/gi, '')
    .replace(/\s{2,}/g, ' ').trim()
  if (eventDate) {
    const endStr = formatGbDayMonth(eventDate)
    if (!/offer ends/i.test(out) && endStr) {
      out += `\n\nOffer ends ${endStr}.`
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
  content = enforceOfferRules(content, campaignType, campaignName, eventDate)
  // Links
  content = normalizeLinks(content, platform, brand)
  // Same-day normaliser
  content = normalizeSameDay(content, scheduledFor)
  // No Twitter-specific trimming
  return { content }
}
