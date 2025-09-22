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

type OptionalRecord<T> = { [K in keyof T]?: T[K] | null | undefined }

type OpeningHoursRecord = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open?: string | null; close?: string | null; closed?: boolean | null }>> & {
  exceptions?: Array<{ date?: string | null; open?: string | null; close?: string | null; closed?: boolean | null; note?: string | null }>
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
  twitter: {
    displayName: 'Twitter',
    styleGuidance: 'Concise and witty; respect strict character limit.',
    linkPolicy: 'inline',
    hashtagPolicy: 'allow',
    emojiPolicy: 'light',
    lengthHint: 'Stay within 240 characters.',
    defaultCtas: ['Book now', 'Join us'],
  },
}

const SYSTEM_PREAMBLE = [
  'You are the dedicated social media strategist for UK hospitality venues.',
  '- Use British English spelling and UK terminology in every sentence.',
  '- Ground every statement in the supplied context; if a fact is missing, omit it rather than inventing details.',
  '- Output plain text ready for publishing: no markdown, lists, headings, numbering, or surrounding quotes.',
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

function uniqueStrings(values: Array<string | null | undefined>) {
  const set = new Set<string>()
  for (const value of values) {
    const cleaned = normaliseValue(value)
    if (cleaned) set.add(cleaned)
  }
  return Array.from(set)
}

function resolvePlatformMeta(platform: string) {
  return PLATFORM_META[platform] ?? PLATFORM_META.facebook
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

  const lines: string[] = ['CONTEXT', 'business:']
  appendKeyValue(lines, 1, 'name', business.name)
  appendKeyValue(lines, 1, 'type', business.type)
  appendBoolean(lines, 1, 'servesFood', business.servesFood)
  appendBoolean(lines, 1, 'servesDrinks', business.servesDrinks)
  appendKeyValue(lines, 1, 'brandVoice', business.brandVoiceSummary)
  appendKeyValue(lines, 1, 'toneDescriptors', uniqueStrings(business.toneDescriptors ?? []).join(', '))
  appendKeyValue(lines, 1, 'targetAudience', business.targetAudience)
  appendKeyValue(lines, 1, 'identityHighlights', business.identityHighlights)
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

  appendList(lines, 1, 'contentBoundaries', business.contentBoundaries)

  lines.push('campaign:')
  appendKeyValue(lines, 1, 'name', campaign.name)
  appendKeyValue(lines, 1, 'type', campaign.type)
  appendKeyValue(lines, 1, 'platform', platformMeta.displayName)
  appendKeyValue(lines, 1, 'objective', campaign.objective)
  appendKeyValue(lines, 1, 'toneDesired', uniqueStrings(campaign.toneAttributes ?? []).join(', '))
  appendKeyValue(lines, 1, 'creativeBrief', campaign.creativeBrief)
  appendKeyValue(lines, 1, 'additionalContext', campaign.additionalContext)
  if (campaign.eventDate) {
    const dateLabel = formatDate(campaign.eventDate, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' })
    const timeLabel = formatTime(campaign.eventDate, 'Europe/London').replace(/:00(?=[ap]m$)/, '')
    appendKeyValue(lines, 1, 'eventDate', dateLabel)
    appendKeyValue(lines, 1, 'eventTime', timeLabel || null)
  }
  if (campaign.scheduledDate) {
    const scheduleDate = formatDate(campaign.scheduledDate, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' })
    appendKeyValue(lines, 1, 'scheduledFor', scheduleDate)
  }
  appendKeyValue(lines, 1, 'relativeTiming', campaign.relativeTiming)

  if (guardrails) {
    lines.push('guardrails:')
    appendList(lines, 1, 'mustInclude', guardrails.mustInclude)
    appendList(lines, 1, 'mustAvoid', guardrails.mustAvoid)
    appendList(lines, 1, 'toneGuidance', guardrails.tone)
    appendList(lines, 1, 'styleGuidance', guardrails.style)
    appendList(lines, 1, 'formatRules', guardrails.format)
    appendList(lines, 1, 'legal', guardrails.legal)
  }

  const tasks: string[] = [
    `1. Produce a ${platformMeta.displayName} post that promotes "${campaign.name}" for ${business.name}.`,
    '2. Align the message with the business context, brand voice, and campaign objective.',
    '3. Use only the facts provided above—if something is missing, leave it out.',
  ]

  const outputRules: string[] = []
  const paragraphCount = options?.paragraphCount ?? 2
  outputRules.push(`- Structure: ${paragraphCount} short paragraphs separated by a single blank line.`)
  outputRules.push('- Use relative timing language (today, tonight, tomorrow, this Friday, next Friday) rather than numeric dates unless more than two weeks away.')
  outputRules.push('- Format any times in 12-hour clock with lowercase am/pm and no leading zeros (e.g., 7pm, 8:30pm).')

  if (platformMeta.lengthHint) outputRules.push(`- Length guidance: ${platformMeta.lengthHint}`)
  if (campaign.maxLength && campaign.maxLength > 0) outputRules.push(`- Do not exceed ${campaign.maxLength} characters.`)

  const linkRule = (() => {
    switch (platformMeta.linkPolicy) {
      case 'bio':
        return "Links: do not include URLs; direct followers to 'link in bio'."
      case 'cta':
        return "Links: do not paste URLs in the text; refer to 'click the link below' as the action button provides it."
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

  const allowEmojis = campaign.includeEmojis !== false && platformMeta.emojiPolicy !== 'forbid'
  if (!allowEmojis) {
    outputRules.push('- Do not use emojis.')
  } else if (platformMeta.emojiPolicy === 'light') {
    outputRules.push('- Use emojis sparingly to emphasise key ideas; avoid excess.')
  }

  outputRules.push('- Respect any content boundaries and guardrails exactly as stated.')
  outputRules.push('- Deliver plain text ready to publish (no surrounding quotes, no bullet lists, no numbering beyond the structure above).')

  const userPrompt = [
    lines.join('\n'),
    '',
    'TASK',
    ...tasks,
    '',
    'OUTPUT RULES',
    ...outputRules,
  ].join('\n')

  return {
    systemPrompt,
    userPrompt,
    relativeTiming: campaign.relativeTiming,
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
