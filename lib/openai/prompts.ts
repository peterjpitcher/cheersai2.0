import { formatDate, formatTime } from '@/lib/datetime'

type TimingKey =
  | 'six_weeks'
  | 'five_weeks'
  | 'month_before'
  | 'three_weeks'
  | 'two_weeks'
  | 'two_days_before'
  | 'week_before'
  | 'day_before'
  | 'day_of'
  | 'hour_before'
  | 'custom'

type OptionalRecord<T> = ({ [K in keyof T]?: T[K] | null | undefined }) | null | undefined

export type OpeningHoursRecord = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open?: string | null; close?: string | null; closed?: boolean | null }>> & {
  exceptions?: Array<{ date?: string | null; open?: string | null; close?: string | null; closed?: boolean | null; note?: string | null }>
}

export function toOpeningHoursRecord(value: unknown): OpeningHoursRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as OpeningHoursRecord
}

export interface BusinessContext {
  name: string
  type: string
  servesFood?: boolean
  servesDrinks?: boolean
  brandVoiceSummary?: string | null
  targetAudience?: string | null
  identityHighlights?: string | null
  toneDescriptors?: string[] | null
  preferredLink?: string | null
  secondaryLink?: string | null
  phone?: string | null
  whatsapp?: string | null
  openingHours?: OpeningHoursRecord | null
  menus?: { food?: string | null; drink?: string | null }
  contentBoundaries?: string[] | null
  additionalContext?: string | null
  avgSentenceLength?: number | null
  emojiUsage?: boolean | null
}

export interface CampaignContext {
  name: string
  type: string
  objective?: string | null
  platform: string
  eventDate?: Date | null
  scheduledDate?: Date | null
  relativeTiming?: string | null
  toneAttributes?: string[] | null
  creativeBrief?: string | null
  additionalContext?: string | null
  includeHashtags?: boolean
  includeEmojis?: boolean
  maxLength?: number | null
}

export interface GuardrailInstructions {
  mustInclude?: string[]
  mustAvoid?: string[]
  tone?: string[]
  style?: string[]
  format?: string[]
  legal?: string[]
}

export interface PostPromptOptions {
  paragraphCount?: number
  ctaOptions?: string[]
}

export interface BuildPostPromptArgs {
  business: BusinessContext
  campaign: CampaignContext
  guardrails?: GuardrailInstructions
  options?: PostPromptOptions
}

export interface StructuredPrompt {
  systemPrompt: string
  userPrompt: string
  relativeTiming?: string | null
  voiceBaton?: string | null
  explicitDate?: string | null
}

const PLATFORM_META: Record<string, {
  displayName: string
  styleGuidance: string
  linkPolicy: 'inline' | 'bio' | 'cta'
  hashtagPolicy: 'allow' | 'discourage' | 'forbid'
  emojiPolicy: 'allow' | 'light' | 'forbid'
  lengthHint?: string
  defaultCtas: string[]
}> = {
  facebook: {
    displayName: 'Facebook',
    styleGuidance: 'Warm, community-driven tone. Up to roughly 500 characters.',
    linkPolicy: 'inline',
    hashtagPolicy: 'discourage',
    emojiPolicy: 'allow',
    defaultCtas: ['Book a table', 'Reserve now', 'Call us'],
  },
  instagram_business: {
    displayName: 'Instagram',
    styleGuidance: 'Visual-first caption with punchy opening. Keep to roughly 125 characters where possible.',
    linkPolicy: 'bio',
    hashtagPolicy: 'discourage',
    emojiPolicy: 'light',
    defaultCtas: ['Tap the link in bio', 'Send us a DM'],
  },
  google_my_business: {
    displayName: 'Google Business Profile',
    styleGuidance: 'Informative, concise, and focused on local discovery.',
    linkPolicy: 'cta',
    hashtagPolicy: 'forbid',
    emojiPolicy: 'forbid',
    lengthHint: 'Aim for 750 characters or fewer.',
    defaultCtas: ['Call now', 'Book a table', 'Learn more'],
  },
  linkedin: {
    displayName: 'LinkedIn',
    styleGuidance: 'Professional and insight-led while retaining warmth.',
    linkPolicy: 'inline',
    hashtagPolicy: 'discourage',
    emojiPolicy: 'forbid',
    defaultCtas: ['Discover more', 'Book a visit'],
  },
}

const SYSTEM_PREAMBLE = [
  'You are the dedicated social media strategist for UK hospitality venues.',
  '- Use British English spelling and UK terminology in every sentence.',
  '- Ground every statement in the supplied context; if a fact is missing, omit it rather than inventing details.',
  '- Output plain text ready for publishing: no markdown, lists, headings, numbering, or surrounding quotes.',
  '- Match the brand’s voice using ONLY the supplied fields: brandVoice, toneAttributes, and targetAudience.',
  '- If brand voice cues are vague or missing, default to neutral, concise hospitality copy without inventing slang or personality.',
  '- Keep the tone consistent across the copy—no sudden shifts between sentences.',
].join('\n')

const OFFSETS: Record<TimingKey, { days?: number; hours?: number }> = {
  six_weeks: { days: -42 },
  five_weeks: { days: -35 },
  month_before: { days: -30 },
  three_weeks: { days: -21 },
  two_weeks: { days: -14 },
  two_days_before: { days: -2 },
  week_before: { days: -7 },
  day_before: { days: -1 },
  day_of: { days: 0 },
  hour_before: { hours: -1 },
  custom: {},
}

const TIMING_LABELS: Record<TimingKey, string> = {
  six_weeks: '6 weeks before',
  five_weeks: '5 weeks before',
  month_before: '1 month before',
  three_weeks: '3 weeks before',
  two_weeks: '2 weeks before',
  two_days_before: '2 days before',
  week_before: '1 week before',
  day_before: 'day before',
  day_of: 'day of event',
  hour_before: '1 hour before',
  custom: 'custom date',
}

const TIMING_KEYS = Object.keys(OFFSETS) as TimingKey[]

export const POST_TIMINGS = TIMING_KEYS.map((id) => ({
  id,
  label: TIMING_LABELS[id],
  days: OFFSETS[id]?.days ?? 0,
  hours: OFFSETS[id]?.hours,
}))

function indent(level: number) {
  return '  '.repeat(level)
}

function normaliseValue(value?: string | null) {
  if (!value) return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length ? cleaned : null
}

function appendKeyValue(lines: string[], level: number, key: string, value?: string | null) {
  const cleaned = normaliseValue(value)
  if (!cleaned) return
  lines.push(`${indent(level)}${key}: ${cleaned}`)
}

function appendBoolean(lines: string[], level: number, key: string, value?: boolean | null) {
  if (typeof value !== 'boolean') return
  lines.push(`${indent(level)}${key}: ${value ? 'yes' : 'no'}`)
}

function appendList(lines: string[], level: number, key: string, values?: Array<string | null | undefined>) {
  const filtered = (values ?? []).map((item) => normaliseValue(item)).filter((item): item is string => Boolean(item))
  if (!filtered.length) return
  lines.push(`${indent(level)}${key}:`)
  filtered.forEach((entry) => lines.push(`${indent(level + 1)}- ${entry}`))
}

function formatOpeningHours(hours?: OpeningHoursRecord | null) {
  if (!hours || typeof hours !== 'object') return [] as string[]
  const order: Array<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const names: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
  const results: string[] = []
  for (const key of order) {
    const info = hours[key]
    if (!info) continue
    if (info.closed) {
      results.push(`${names[key]}: Closed`)
    } else if (info.open && info.close) {
      results.push(`${names[key]}: ${info.open}–${info.close}`)
    }
  }
  return results
}

function formatExceptions(hours?: OpeningHoursRecord | null) {
  if (!hours || !Array.isArray(hours.exceptions)) return [] as string[]
  const list: string[] = []
  for (const entry of hours.exceptions) {
    if (!entry?.date) continue
    const date = normaliseValue(entry.date)
    if (!date) continue
    if (entry.closed) {
      list.push(`${date}: Closed`)
    } else if (entry.open && entry.close) {
      list.push(`${date}: ${entry.open}–${entry.close}`)
    }
  }
  return list
}

function describeRelativeTiming(eventDate?: Date | null, scheduledDate?: Date | null) {
  if (!eventDate || !scheduledDate) return null
  const sd = toLondonDate(scheduledDate)
  const ed = toLondonDate(eventDate)
  const sameDay = sd.toISOString().slice(0, 10) === ed.toISOString().slice(0, 10)
  if (sameDay) return 'today'
  const tomorrow = new Date(sd)
  tomorrow.setDate(sd.getDate() + 1)
  if (tomorrow.toISOString().slice(0, 10) === ed.toISOString().slice(0, 10)) return 'tomorrow'
  if (isSameWeek(sd, ed)) {
    return `this ${formatDate(ed, 'Europe/London', { weekday: 'long' }).toLowerCase()}`
  }
  const nextWeek = new Date(sd)
  nextWeek.setDate(sd.getDate() + 7)
  if (isSameWeek(nextWeek, ed)) {
    return `next ${formatDate(ed, 'Europe/London', { weekday: 'long' }).toLowerCase()}`
  }
  return formatDate(ed, 'Europe/London', { weekday: 'long' }).toLowerCase()
}

export function getRelativeTimingLabel(eventDate?: Date | null, scheduledDate?: Date | null) {
  return describeRelativeTiming(eventDate, scheduledDate)
}

function toLondonDate(date: Date) {
  const utc = date.getTime()
  const tzDate = new Date(utc + getTimeZoneOffsetMs(date, 'Europe/London'))
  tzDate.setHours(0, 0, 0, 0)
  return tzDate
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const data: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') data[part.type] = Number(part.value)
  }
  const tzTime = Date.UTC(data.year, data.month - 1, data.day, data.hour, data.minute, data.second)
  return tzTime - date.getTime()
}

function isSameWeek(a: Date, b: Date) {
  const monday = (date: Date) => {
    const result = new Date(date)
    const day = result.getUTCDay() || 7
    if (day !== 1) result.setUTCDate(result.getUTCDate() - (day - 1))
    result.setUTCHours(0, 0, 0, 0)
    return result
  }
  return monday(a).getTime() === monday(b).getTime()
}

function uniqueStrings(values?: Array<string | null | undefined> | null) {
  const set = new Set<string>()
  for (const value of values ?? []) {
    const cleaned = normaliseValue(value)
    if (cleaned) set.add(cleaned)
  }
  return Array.from(set)
}

function resolvePlatformMeta(platform: string) {
  return PLATFORM_META[platform] ?? PLATFORM_META.facebook
}

const LONDON_TIME_ZONE = 'Europe/London'

function extractHighlights(value?: string | null) {
  if (!value) return [] as string[]
  const raw = value.replace(/\r/g, '\n')
  const primary = raw
    .split(/[\n•\-\u2022|]+/)
    .map((entry) => normaliseValue(entry))
    .filter((entry): entry is string => Boolean(entry))
  if (primary.length) return primary
  const fallback = raw
    .split(/[;,.]/)
    .map((entry) => normaliseValue(entry))
    .filter((entry): entry is string => Boolean(entry))
  return fallback
}

function toZonedDate(date: Date, timeZone: string) {
  const offset = getTimeZoneOffsetMs(date, timeZone)
  return new Date(date.getTime() + offset)
}

function isSameCalendarDayZoned(a: Date, b: Date, timeZone: string) {
  const aZoned = toZonedDate(a, timeZone)
  const bZoned = toZonedDate(b, timeZone)
  return (
    aZoned.getUTCFullYear() === bZoned.getUTCFullYear() &&
    aZoned.getUTCMonth() === bZoned.getUTCMonth() &&
    aZoned.getUTCDate() === bZoned.getUTCDate()
  )
}

function parseTimeToMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number.parseInt(hoursRaw, 10)
  const minutes = Number.parseInt(minutesRaw ?? '0', 10)
  if (!Number.isFinite(hours) || hours < 0) return 0
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0
  return hours * 60 + safeMinutes
}

function isBetweenLocalTime(date: Date, start: string, end: string, timeZone: string) {
  const zoned = toZonedDate(date, timeZone)
  const minutes = zoned.getUTCHours() * 60 + zoned.getUTCMinutes()
  const startMinutes = parseTimeToMinutes(start)
  const endMinutes = parseTimeToMinutes(end)
  if (endMinutes <= startMinutes) return minutes >= startMinutes
  return minutes >= startMinutes && minutes <= endMinutes
}

function formatAbsoluteDate(date?: Date | null, includeTime = true) {
  if (!date) return null
  const dayLabel = formatDate(date, LONDON_TIME_ZONE, { weekday: 'long', day: 'numeric', month: 'long' })
  if (!includeTime) return dayLabel
  const timeLabel = formatTime(date, LONDON_TIME_ZONE).replace(/:00(?=[ap]m$)/, '')
  if (!timeLabel || timeLabel === '12:00 am') return dayLabel
  return `${dayLabel}, ${timeLabel}`
}

function resolveRelativeLabel(eventDate?: Date | null, scheduledDate?: Date | null, fallback?: string | null) {
  const base = normaliseValue(fallback)
  if (!eventDate || !scheduledDate) return base ?? null

  if (isSameCalendarDayZoned(eventDate, scheduledDate, LONDON_TIME_ZONE)) {
    const evening = isBetweenLocalTime(scheduledDate, '16:00', '23:59', LONDON_TIME_ZONE)
    return evening ? 'tonight' : 'today'
  }

  const eventMidnight = toLondonDate(eventDate).getTime()
  const scheduledMidnight = toLondonDate(scheduledDate).getTime()
  const diffDays = Math.round((eventMidnight - scheduledMidnight) / (24 * 60 * 60 * 1000))
  const weekdayName = formatDate(eventDate, LONDON_TIME_ZONE, { weekday: 'long' })

  if (diffDays === 1) {
    return 'tomorrow'
  }

  if (diffDays > 1 && diffDays <= 7) {
    if (isSameWeek(scheduledDate, eventDate)) {
      return `this ${weekdayName}`
    }
  }

  if (diffDays > 1 && diffDays <= 14) {
    const nextWeek = new Date(scheduledDate)
    nextWeek.setDate(nextWeek.getDate() + 7)
    if (isSameWeek(nextWeek, eventDate)) {
      return `next ${weekdayName}`
    }
  }

  if (diffDays > 7 && diffDays <= 28) {
    const weeks = Math.round(diffDays / 7)
    if (weeks > 1) {
      return `in ${weeks} weeks`
    }
  }

  if (diffDays > 1 && diffDays <= 30) {
    return `in ${diffDays} days`
  }

  return base ?? weekdayName
}

export function computeScheduledDate(eventDate?: Date | null, timing?: TimingKey | 'custom', custom?: Date | null) {
  if (timing === 'custom' && custom) return custom
  if (!eventDate || !timing) return eventDate ?? null
  const offset = OFFSETS[timing as TimingKey]
  if (!offset) return eventDate
  const result = new Date(eventDate)
  if (typeof offset.days === 'number') result.setDate(result.getDate() + offset.days)
  if (typeof offset.hours === 'number') result.setHours(result.getHours() + offset.hours)
  return result
}

export function buildStructuredPostPrompt({ business, campaign, guardrails, options }: BuildPostPromptArgs): StructuredPrompt {
  const platformMeta = resolvePlatformMeta(campaign.platform)
  const systemPrompt = SYSTEM_PREAMBLE
  const identityHighlights = normaliseValue(business.identityHighlights)
  const identityHighlightTokens = identityHighlights ? extractHighlights(identityHighlights) : []
  const targetAudience = normaliseValue(business.targetAudience)
  const toneDescriptorList = uniqueStrings(business.toneDescriptors ?? [])
  const toneDescriptorText = toneDescriptorList.join(', ')
  const batonComponents: string[] = []
  if (business.brandVoiceSummary) batonComponents.push(`brandVoice: ${business.brandVoiceSummary}`)
  if (toneDescriptorText) batonComponents.push(`toneAttributes: ${toneDescriptorText}`)
  if (identityHighlightTokens.length) batonComponents.push(`identity: ${identityHighlightTokens.slice(0, 3).join(' / ')}`)
  if (targetAudience) batonComponents.push(`audience: ${targetAudience}`)
  if (!batonComponents.length) batonComponents.push('tone: warm, welcoming, community-led')
  const voiceBaton = batonComponents.join(' | ')

  const lines: string[] = ['CONTEXT', 'business:']
  appendKeyValue(lines, 1, 'name', business.name)
  appendKeyValue(lines, 1, 'type', business.type)
  appendBoolean(lines, 1, 'servesFood', business.servesFood)
  appendBoolean(lines, 1, 'servesDrinks', business.servesDrinks)
  appendKeyValue(lines, 1, 'brandVoice', business.brandVoiceSummary)
  appendKeyValue(lines, 1, 'toneDescriptors', toneDescriptorText)
  appendKeyValue(lines, 1, 'targetAudience', targetAudience)
  appendKeyValue(lines, 1, 'identityHighlights', identityHighlights)
  appendKeyValue(lines, 1, 'additionalContext', business.additionalContext)
  appendKeyValue(lines, 1, 'preferredLink', business.preferredLink)
  appendKeyValue(lines, 1, 'secondaryLink', business.secondaryLink)
  appendKeyValue(lines, 1, 'phone', business.phone)
  appendKeyValue(lines, 1, 'whatsapp', business.whatsapp)

  const openingHours = formatOpeningHours(business.openingHours)
  const exceptions = formatExceptions(business.openingHours)
  appendList(lines, 1, 'openingHours', openingHours)
  appendList(lines, 1, 'openingExceptions', exceptions)

  if (business.menus) {
    const menuLines: string[] = []
    if (business.menus.food) menuLines.push(`food: ${normaliseValue(business.menus.food)}`)
    if (business.menus.drink) menuLines.push(`drink: ${normaliseValue(business.menus.drink)}`)
    if (menuLines.length) {
      lines.push(`${indent(1)}menus:`)
      menuLines.forEach((entry) => lines.push(`${indent(2)}${entry}`))
    }
  }

  appendList(lines, 1, 'contentBoundaries', business.contentBoundaries ?? undefined)

  lines.push('style:')
  lines.push(`${indent(1)}voice: ${voiceBaton}`)
  if (identityHighlightTokens.length) {
    lines.push(`${indent(1)}identityFocus: ${identityHighlightTokens.slice(0, 3).join('; ')}`)
  }

  lines.push('campaign:')
  appendKeyValue(lines, 1, 'name', campaign.name)
  appendKeyValue(lines, 1, 'type', campaign.type)
  appendKeyValue(lines, 1, 'platform', platformMeta.displayName)
  appendKeyValue(lines, 1, 'objective', campaign.objective)
  const campaignTone = uniqueStrings(campaign.toneAttributes ?? [])
  appendKeyValue(lines, 1, 'toneDesired', campaignTone.join(', '))
  appendKeyValue(lines, 1, 'creativeBrief', campaign.creativeBrief)
  appendKeyValue(lines, 1, 'additionalContext', campaign.additionalContext)

  const eventDateLabel = campaign.eventDate ? formatDate(campaign.eventDate, LONDON_TIME_ZONE, { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const eventDayLabel = campaign.eventDate ? formatDate(campaign.eventDate, LONDON_TIME_ZONE, { weekday: 'long' }) : null
  const eventTimeLabel = campaign.eventDate ? formatTime(campaign.eventDate, LONDON_TIME_ZONE).replace(/:00(?=[ap]m$)/, '') : null
  if (eventDateLabel) appendKeyValue(lines, 1, 'eventDate', eventDateLabel)
  if (eventDayLabel) appendKeyValue(lines, 1, 'eventDay', eventDayLabel)
  if (eventTimeLabel) appendKeyValue(lines, 1, 'eventTime', eventTimeLabel)

  const scheduledDateLabel = campaign.scheduledDate ? formatDate(campaign.scheduledDate, LONDON_TIME_ZONE, { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const scheduledDayLabel = campaign.scheduledDate ? formatDate(campaign.scheduledDate, LONDON_TIME_ZONE, { weekday: 'long' }) : null
  if (scheduledDateLabel) appendKeyValue(lines, 1, 'scheduledFor', scheduledDateLabel)
  if (scheduledDayLabel) appendKeyValue(lines, 1, 'scheduledDay', scheduledDayLabel)

  const baselineRelative = normaliseValue(campaign.relativeTiming)
  const resolvedRelative = resolveRelativeLabel(campaign.eventDate ?? null, campaign.scheduledDate ?? null, baselineRelative)
  const finalRelativeLabel = normaliseValue(resolvedRelative) ?? baselineRelative
  appendKeyValue(lines, 1, 'relativeTiming', finalRelativeLabel)

  if (guardrails) {
    lines.push('guardrails:')
    appendList(lines, 1, 'mustInclude', guardrails.mustInclude)
    appendList(lines, 1, 'mustAvoid', guardrails.mustAvoid)
    appendList(lines, 1, 'toneGuidance', guardrails.tone)
    appendList(lines, 1, 'styleGuidance', guardrails.style)
    appendList(lines, 1, 'formatRules', guardrails.format)
    appendList(lines, 1, 'legal', guardrails.legal)
  }

  const tasks: string[] = []
  const addTask = (instruction: string) => {
    tasks.push(`${tasks.length + 1}. ${instruction}`)
  }

  addTask(`Produce a ${platformMeta.displayName} post that promotes "${campaign.name}" for ${business.name}.`)
  addTask('Align the message with the business context, brand voice, and campaign objective.')
  addTask('Use only the facts provided above—if something is missing, leave it out.')
  if (identityHighlights) {
    addTask(`Weave in the brand identity highlights: ${identityHighlights}.`)
  }
  if (targetAudience) {
    addTask(`Write in a way that speaks directly to ${targetAudience}.`)
  }
  const hookFocus = identityHighlightTokens[0] || toneDescriptorList[0] || business.brandVoiceSummary || business.name
  if (hookFocus) {
    addTask(`Open with an energetic hook that spotlights ${hookFocus} in the very first sentence—avoid generic invitations like "Join us".`)
  } else {
    addTask('Open with an energetic, on-brand hook rather than a generic invitation such as "Join us".')
  }
  addTask('Make each paragraph focus on a distinct angle (atmosphere, activity, food & drink, incentives) so the copy stays fresh and non-repetitive.')

  const paragraphCount = options?.paragraphCount ?? 2
  const outputRules: string[] = []
  outputRules.push(`- Structure: ${paragraphCount} short paragraphs separated by a single blank line.`)
  outputRules.push('- Opening sentence: lead with an on-brand, sensory hook tied to the venue—avoid phrases like "Join us" or "Come along".')
  outputRules.push('- Format any times using the 12-hour clock with lowercase am/pm (e.g. 7pm, 8:30pm).')
  outputRules.push('- Keep claims grounded in the CONTEXT and GUARDRAILS; omit anything that is not provided.')
  outputRules.push(`- Style: Write in the voice: ${voiceBaton}. Avoid generic hype words (e.g. "epic", "unreal") unless they appear in those notes.`)

  if (typeof business.avgSentenceLength === 'number' && business.avgSentenceLength > 0) {
    outputRules.push(`- Sentence length: mirror the brand guidance (~${Math.round(business.avgSentenceLength)} words per sentence).`)
  } else {
    outputRules.push('- Sentence length: keep to one or two short sentences per paragraph.')
  }

  const explicitDate = formatAbsoluteDate(campaign.eventDate, false)
  const eventAbsolute = formatAbsoluteDate(campaign.eventDate)
  const scheduledAbsolute = formatAbsoluteDate(campaign.scheduledDate)
  const sameDay = campaign.eventDate && campaign.scheduledDate ? isSameCalendarDayZoned(campaign.eventDate, campaign.scheduledDate, LONDON_TIME_ZONE) : false
  const scheduledEvening = campaign.scheduledDate ? isBetweenLocalTime(campaign.scheduledDate, '16:00', '23:59', LONDON_TIME_ZONE) : false

  if (finalRelativeLabel && explicitDate) {
    outputRules.push(`- Relative timing: Use ${finalRelativeLabel} once and "${explicitDate}" once; do not introduce other dates or day names.`)
  } else if (finalRelativeLabel) {
    outputRules.push(`- Relative timing: Use ${finalRelativeLabel} once; do not invent alternate phrasing.`)
  }
  if (identityHighlights) {
    outputRules.push(`- Let the tone reflect these brand identity notes: ${identityHighlights}.`)
  }
  if (identityHighlightTokens.length) {
    outputRules.push(`- Weave in at least one of: ${identityHighlightTokens.slice(0, 3).join('; ')} so the copy feels unmistakably on-brand.`)
  }
  if (targetAudience) {
    outputRules.push(`- Speak directly to ${targetAudience} using inclusive, second-person language.`)
  }

  outputRules.push('- Avoid repeating identical sentences or filler phrases—keep each line purposeful.')

  if (platformMeta.lengthHint) outputRules.push(`- Length guidance: ${platformMeta.lengthHint}`)
  if (campaign.maxLength && campaign.maxLength > 0) outputRules.push(`- Do not exceed ${campaign.maxLength} characters.`)

  if (business.phone) {
    outputRules.push(`- If you mention a phone number, use exactly ${business.phone}. Do not invent or alter digits.`)
  } else {
    outputRules.push('- Do not mention a phone number (none provided).')
  }
  if (business.whatsapp) {
    outputRules.push(`- If you mention WhatsApp or SMS, use the number ${business.whatsapp} and specify the channel.`)
  }

  const linkRule = (() => {
    switch (platformMeta.linkPolicy) {
      case 'bio':
        return "Links: do not include URLs; direct followers to 'link in bio'."
      case 'cta':
        return "Links: do not paste URLs in the text; refer to 'click the link below'—the action button provides it."
      default:
        return business.preferredLink
          ? `Links: include ${business.preferredLink} exactly once. Do not invent alternative domains.`
          : 'Links: only include a URL if one is provided in context; otherwise omit links.'
    }
  })()
  outputRules.push(`- ${linkRule}`)

  const ctaOptions = uniqueStrings(options?.ctaOptions ?? platformMeta.defaultCtas)
  if (ctaOptions.length) {
    outputRules.push(`- Include a clear call-to-action using one of: ${ctaOptions.join('; ')}.`)
  }

  if (campaign.includeHashtags === false || platformMeta.hashtagPolicy === 'forbid') {
    outputRules.push('- Do not include hashtags.')
  } else if (platformMeta.hashtagPolicy === 'discourage') {
    outputRules.push('- Avoid hashtags unless explicitly required by guardrails or context.')
  }

  const emojiToneFriendly = toneDescriptorList
    .map((desc) => desc.toLowerCase())
    .some((desc) => /(playful|fun|cheeky|joyful|energetic|lively|vibrant|whimsical|light|cheery)/.test(desc))
  const emojiUsagePermitted = business.emojiUsage !== false
  const allowEmojis = campaign.includeEmojis !== false && platformMeta.emojiPolicy !== 'forbid' && emojiToneFriendly && emojiUsagePermitted
  if (!allowEmojis) {
    outputRules.push('- Do not use emojis.')
  } else {
    outputRules.push('- Use emojis sparingly to reinforce the playful tone; avoid overusing them.')
  }

  outputRules.push('- Respect any content boundaries and guardrails exactly as stated.')
  outputRules.push('- Deliver plain text ready to publish (no surrounding quotes, no bullet lists, no numbering beyond the structure above).')

  const timingLines: string[] = []
  if (scheduledAbsolute || eventAbsolute || finalRelativeLabel) {
    timingLines.push('TIMING')
    if (scheduledAbsolute) timingLines.push(`- scheduledFor (authoring time): ${scheduledAbsolute}`)
    if (eventAbsolute) timingLines.push(`- eventDate (start time): ${eventAbsolute}`)
    if (finalRelativeLabel) timingLines.push(`- relativeLabel: ${finalRelativeLabel}`)
    timingLines.push('')
    timingLines.push('STRICT DATE RULES')
    if (finalRelativeLabel) timingLines.push('- Use the relativeLabel EXACTLY ONCE.')
    if (explicitDate) timingLines.push(`- Also include the explicit date "${explicitDate}" EXACTLY ONCE.`)
    if (finalRelativeLabel) timingLines.push('- Do NOT contradict the supplied relativeLabel.')
    if (explicitDate) timingLines.push('- Do not output any additional dates or day names beyond those above.')
    if (finalRelativeLabel && sameDay) {
      timingLines.push(`- Because this post is scheduled on the day, prefer ${scheduledEvening ? '"tonight"' : '"today"'} instead of day-name phrasing.`)
    }
  }

  const promptSections = [lines.join('\n')]
  if (timingLines.length) {
    promptSections.push('', timingLines.join('\n'))
  }
  promptSections.push('', 'TASK', ...tasks, '', 'OUTPUT RULES', ...outputRules)

  const userPrompt = promptSections.join('\n')

  return {
    systemPrompt,
    userPrompt,
    relativeTiming: finalRelativeLabel,
    voiceBaton,
    explicitDate,
  }
}

export function deriveToneDescriptors(
  voiceProfile?: OptionalRecord<{ tone_attributes?: string[] | null; characteristics?: string[] | null }>,
  brandProfile?: OptionalRecord<{ tone_attributes?: string[] | null; brand_voice?: string | null }>,
  explicitTone?: string | null
) {
  const descriptors = uniqueStrings([
    ...(voiceProfile?.tone_attributes ?? []),
    ...(brandProfile?.tone_attributes ?? []),
    explicitTone ?? null,
  ])
  return descriptors
}

export function buildBrandVoiceSummary(
  voiceProfile?: OptionalRecord<{ characteristics?: string[] | null; avg_sentence_length?: number | null; emoji_usage?: boolean | null; emoji_frequency?: string | null }>,
  brandProfile?: OptionalRecord<{ brand_voice?: string | null }>
) {
  const parts: string[] = []
  if (brandProfile?.brand_voice) parts.push(brandProfile.brand_voice)
  if (voiceProfile?.characteristics?.length) parts.push(`Characteristics: ${uniqueStrings(voiceProfile.characteristics).join(', ')}`)
  if (typeof voiceProfile?.avg_sentence_length === 'number') parts.push(`Average sentence length: ${voiceProfile.avg_sentence_length} words`)
  if (typeof voiceProfile?.emoji_usage === 'boolean') {
    parts.push(`Emojis allowed: ${voiceProfile.emoji_usage ? `yes (${voiceProfile.emoji_frequency ?? 'moderate'})` : 'no'}`)
  }
  return normaliseValue(parts.join(' | '))
}

export function defaultCtasForPlatform(platform: string) {
  return PLATFORM_META[platform]?.defaultCtas ?? PLATFORM_META.facebook.defaultCtas
}

export type { TimingKey }
