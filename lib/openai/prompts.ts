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

type TimingStage = 'evergreen' | 'teaser' | 'build_up' | 'final_call' | 'day_of'

type OptionalRecord<T> = ({ [K in keyof T]?: T[K] | null | undefined }) | null | undefined

type CampaignVariant = 'event_build_up' | 'offer_countdown' | 'recurring_weekly'

type StageRule = (ctx: StageContext) => string | null
type StageSuggestionRule = (ctx: StageContext) => string[] | null

interface StageMeta {
  paragraphCount?: number
  structureRule?: StageRule
  openingRule?: StageRule
  paragraphRules?: StageRule[]
  closingRule?: StageRule
  extraRules?: StageRule[]
  tasks?: StageRule[]
  ctaToneRule?: StageRule
  ctaSuggestionsRule?: StageSuggestionRule
}

interface StageContext {
  focus: string | null
  relativeLabel: string | null
  explicitDate: string | null
  campaignName: string
  platformName: string
  objective?: string | null
  variant: CampaignVariant
  paragraphCount: number
  isOffer: boolean
  callToAction?: string | null
}

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
  variant?: string | null
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
  callToAction?: string | null
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
  '- Treat brand voice and guardrail guidance as non-negotiable—if they forbid buzzwords or sales patter, keep the language plain.',
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

function deriveVoiceGuidance(brandVoiceSummary?: string | null, toneDescriptors?: string[] | null) {
  const guidance = { rules: [] as string[], tasks: [] as string[] }
  const sourceText = [brandVoiceSummary ?? '', ...(toneDescriptors ?? [])]
    .map((entry) => (typeof entry === 'string' ? entry.toLowerCase() : ''))
    .join(' ')
    .trim()

  if (!sourceText) return guidance

  const addRule = (value?: string | null) => {
    const cleaned = normaliseValue(value)
    if (cleaned) guidance.rules.push(cleaned)
  }

  const addTask = (value?: string | null) => {
    const cleaned = normaliseValue(value)
    if (cleaned) guidance.tasks.push(cleaned)
  }

  if (/(no\s+(?:buzzwords|sales\s+patter|fluff|hard\s+sell)|avoid\s+(?:buzzwords|sales\s+patter|fluff))/i.test(sourceText)) {
    addRule('Language: Keep it plainspoken—no buzzwords, sales patter, or marketing fluff.')
  }

  if (/(straight\s*to\s*the\s*point|no\s*fuss|no[-\s]*nonsense|plain[-\s]*spoken|down[-\s]*to[-\s]*earth)/i.test(sourceText)) {
    addRule('Structure: Get to the point quickly with short, direct sentences that cover the essentials first.')
  }

  if (/(dry\s+humour|dry\s+humor|wry\s+humour|wry\s+humor)/i.test(sourceText)) {
    addRule('Tone: A hint of dry humour is welcome when it fits naturally—keep it light and good-natured.')
  }

  if (/(word\s+across\s+the\s+bar|across\s+the\s+bar|chat\s+across\s+(?:the\s+)?counter|regulars\s+at\s+the\s+pub)/i.test(sourceText)) {
    addTask("Write as if you're chatting with regulars across the bar—use friendly second-person language.")
  }

  if (/(look\s*after|fair\s+dealing|genuine\s+welcome|respectful\s+service)/i.test(sourceText)) {
    addRule('Tone: Keep it respectful, welcoming, and grounded in genuine hospitality.')
  }

  guidance.rules = uniqueStrings(guidance.rules)
  guidance.tasks = uniqueStrings(guidance.tasks)
  return guidance
}

function resolveCampaignVariant(campaign: CampaignContext): CampaignVariant {
  const mapHint = (hint?: string | null): CampaignVariant | null => {
    const cleaned = normaliseValue(hint)
    if (!cleaned) return null
    const lower = cleaned.toLowerCase()
    if (/(offer|discount|deal|special)/.test(lower)) return 'offer_countdown'
    if (/(weekly|every week|recurring|seasonal|regular)/.test(lower)) return 'recurring_weekly'
    if (/(event|launch|party|opening|festival|build)/.test(lower)) return 'event_build_up'
    return null
  }

  const hints: Array<string | null | undefined> = [
    campaign.variant,
    campaign.type,
    campaign.objective,
    campaign.name,
    campaign.creativeBrief,
    campaign.additionalContext,
  ]

  for (const hint of hints) {
    const resolved = mapHint(hint)
    if (resolved) return resolved
  }

  return 'event_build_up'
}

function deriveCallToAction(campaign: CampaignContext): string | null {
  const preferred = normaliseValue(campaign.callToAction)
  if (preferred) return preferred

  const sources = [campaign.creativeBrief, campaign.additionalContext]
  for (const source of sources) {
    const text = normaliseValue(source)
    if (!text) continue
    const lines = text
      .split(/\r?\n|[•\u2022]/)
      .map((line) => normaliseValue(line))
      .filter((line): line is string => Boolean(line))

    for (const line of lines) {
      const lower = line.toLowerCase()
      if (/(call\s*to\s*action|what do you want people to do|how do people get it|cta)/.test(lower)) {
        const [, value] = line.split(/:\s*/)
        if (value) return normaliseValue(value)
        return line
      }
    }
  }

  return null
}

function resolveTimingStage(
  variant: CampaignVariant,
  eventDate?: Date | null,
  scheduledDate?: Date | null,
): TimingStage {
  if (variant === 'recurring_weekly') return 'evergreen'
  if (!eventDate || !scheduledDate) return 'evergreen'
  const eventMidnight = toLondonDate(eventDate).getTime()
  const scheduledMidnight = toLondonDate(scheduledDate).getTime()
  const diffDays = Math.round((eventMidnight - scheduledMidnight) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) return 'day_of'
  if (diffDays <= 2) return 'final_call'
  if (diffDays <= 14) return 'build_up'
  return 'teaser'
}

function mergeStageMeta(base: StageMeta, override?: StageMeta | null): StageMeta {
  if (!override) return base
  return {
    paragraphCount: override.paragraphCount ?? base.paragraphCount,
    structureRule: override.structureRule ?? base.structureRule,
    openingRule: override.openingRule ?? base.openingRule,
    paragraphRules: override.paragraphRules ?? base.paragraphRules,
    closingRule: override.closingRule ?? base.closingRule,
    extraRules: [...(base.extraRules ?? []), ...(override.extraRules ?? [])],
    tasks: override.tasks ?? base.tasks,
    ctaToneRule: override.ctaToneRule ?? base.ctaToneRule,
    ctaSuggestionsRule: override.ctaSuggestionsRule ?? base.ctaSuggestionsRule,
  }
}

const EVENT_STAGE_META: Record<TimingStage, StageMeta> = {
  teaser: {
    paragraphCount: 2,
    structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
    openingRule: (ctx) => (ctx.focus
      ? `Opening: Lead with a sensory hook that spotlights ${ctx.focus} and builds anticipation.`
      : 'Opening: Lead with a sensory hook that builds anticipation.'),
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Build excitement for the experience and mention that it lands ${ctx.relativeLabel}.`
        : 'Paragraph 1: Build excitement for the experience and call out what makes it special.'),
      (ctx) => (ctx.explicitDate
        ? `Paragraph 2: Share a key detail plus the date ${ctx.explicitDate}, then invite guests to plan ahead.`
        : 'Paragraph 2: Share a key detail plus the practical next step and invite guests to plan ahead.'),
    ],
    closingRule: () => 'Closing sentence: Encourage early bookings or RSVPs with a warm nudge.',
    extraRules: [
      () => 'Keep the tone upbeat and avoid repeating the same phrasing across paragraphs.',
    ],
    tasks: [
      (ctx) => (ctx.focus
        ? `Introduce ${ctx.focus} in the first paragraph so the post feels unmistakably on-brand.`
        : 'Introduce a distinctive on-brand detail in the first paragraph so the post feels bespoke.'),
      (ctx) => (ctx.relativeLabel
        ? `Reference the timing (${ctx.relativeLabel}) within the narrative rather than as a separate sentence.`
        : null),
      () => 'Make the second paragraph focus on practical or social proof details so each paragraph has a distinct role.',
    ],
  },
  build_up: {
    paragraphCount: 2,
    structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
    openingRule: (ctx) => (ctx.focus
      ? `Opening: Spotlight ${ctx.focus} and show why this specific event is worth planning for.`
      : 'Opening: Spotlight what makes this event worth planning for and lead with energy.'),
    paragraphRules: [
      (ctx) => {
        if (ctx.relativeLabel && ctx.explicitDate) {
          return `Paragraph 1: Share what guests can expect and reinforce that it happens ${ctx.relativeLabel} on ${ctx.explicitDate}.`
        }
        if (ctx.relativeLabel) {
          return `Paragraph 1: Share what guests can expect and reinforce that it happens ${ctx.relativeLabel}.`
        }
        return 'Paragraph 1: Share what guests can expect and emphasise the standout highlights.'
      },
      () => 'Paragraph 2: Give reassurance on logistics (booking, arrival time, menu) and nudge people to secure their spot.',
    ],
    closingRule: () => 'Closing sentence: Add a friendly prompt to book or reserve before places fill up.',
    extraRules: [
      () => 'Balance atmosphere with detail so the post feels both exciting and useful.',
    ],
    tasks: [
      () => 'Answer why the event matters now and what guests gain by securing a spot early.',
      (ctx) => (ctx.explicitDate ? `Work ${ctx.explicitDate} into the copy once so readers know the exact day.` : null),
    ],
  },
  final_call: {
    paragraphCount: 2,
    structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
    openingRule: (ctx) => (ctx.focus
      ? `Opening: Lead with an urgent hook that highlights ${ctx.focus} and makes it clear the event is almost here.`
      : 'Opening: Lead with an urgent hook that makes it clear the event is almost here.'),
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Emphasise this is the final chance and mention ${ctx.relativeLabel} to anchor the timing.`
        : 'Paragraph 1: Emphasise this is the final chance and highlight what they’ll miss if they skip it.'),
      () => 'Paragraph 2: Share the key logistics (time, booking method, availability) and make the CTA impossible to miss.',
    ],
    closingRule: () => 'Closing sentence: Finish with a decisive line that pushes readers to confirm now.',
    extraRules: [
      () => 'Use confident, friendly urgency—avoid sounding panicked.',
    ],
    tasks: [
      () => 'Make clear that availability is limited or that this is the last reminder.',
      (ctx) => (ctx.explicitDate ? `State the date ${ctx.explicitDate} once so readers know exactly when to show up.` : null),
    ],
  },
  day_of: {
    paragraphCount: 2,
    structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
    openingRule: (ctx) => (ctx.focus
      ? `Opening: Bring the venue to life right now—describe ${ctx.focus} and make it feel like the doors are open.`
      : 'Opening: Bring the venue to life right now so it feels like the doors are open.'),
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Say it’s happening ${ctx.relativeLabel} and share a sensory snapshot of the atmosphere waiting for them.`
        : 'Paragraph 1: Say it’s happening today/tonight and share a sensory snapshot of the atmosphere waiting for them.'),
      () => 'Paragraph 2: Share any last-minute details (arrive early, booking link, specials) and invite them over straight away.',
    ],
    closingRule: () => 'Closing sentence: End with a welcoming line that makes readers feel expected this evening.',
    extraRules: [
      () => 'Keep sentences punchy so the copy reads quickly on the day.',
    ],
    tasks: [
      () => 'Make it explicitly clear that the event is happening today or tonight—no ambiguous phrasing.',
      () => 'Encourage immediate action (swing by, book, call) with a friendly urgency.',
    ],
  },
  evergreen: {
    paragraphCount: 2,
    structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
    openingRule: (ctx) => (ctx.focus
      ? `Opening: Highlight ${ctx.focus} to cement the venue’s personality before covering practical info.`
      : 'Opening: Highlight a signature detail to cement the venue’s personality before covering practical info.'),
    paragraphRules: [
      () => 'Paragraph 1: Shine a light on the experience and what makes it feel special at this venue.',
      () => 'Paragraph 2: Offer the essential next steps (timings, booking, who it suits) so people can act.',
    ],
    closingRule: () => 'Closing sentence: Finish with a warm, welcoming CTA.',
    extraRules: [
      () => 'Avoid repetition by giving each paragraph a distinct job (feel vs action).',
    ],
    tasks: [
      () => 'Anchor the copy in what the venue does best so it never reads like a template.',
    ],
  },
}

const OFFER_STAGE_META_OVERRIDES: Partial<Record<TimingStage, StageMeta>> = {
  teaser: {
    openingRule: () => 'Opening: Start with the hero benefit (discount or price) so the value is instantly clear.',
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Describe the flavour or experience and make it clear the offer ends ${ctx.relativeLabel}.`
        : 'Paragraph 1: Describe the flavour or experience and make it clear the offer is time-limited.'),
      (ctx) => (ctx.explicitDate
        ? `Paragraph 2: Remind guests the offer ends on ${ctx.explicitDate} and explain how to claim it.`
        : 'Paragraph 2: Explain how to claim the offer and spell out the availability window.'),
    ],
    closingRule: () => 'Closing sentence: Reinforce that it ends soon and point directly to the CTA.',
    extraRules: [
      () => 'Mention the price or saving numerically so the value lands.',
      () => 'Keep the countdown language clear so people plan before it ends.',
    ],
    tasks: [
      () => 'Make the discount/price explicit in the first paragraph (e.g., “25% off” or “now £3”).',
      (ctx) => (ctx.relativeLabel ? `Frame the timing as a countdown by saying “Offer ends ${ctx.relativeLabel}” once.` : null),
      () => 'Pair the offer with the venue atmosphere so it feels like an experience, not just a sale.',
    ],
    ctaToneRule: () => 'CTA tone: Encourage immediate action so guests secure the offer before it ends.',
    ctaSuggestionsRule: () => ['Book now', 'Reserve today', 'Call us'],
  },
  build_up: {
    openingRule: () => 'Opening: Pair the headline offer with a sensory detail so it feels like more than just a discount.',
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Make it clear there are only ${ctx.relativeLabel} left to enjoy it and celebrate the taste or vibe.`
        : 'Paragraph 1: Emphasise that the offer is live now and celebrate the taste or vibe.'),
      (ctx) => (ctx.explicitDate
        ? `Paragraph 2: Spell out how to claim it and remind followers it ends on ${ctx.explicitDate}.`
        : 'Paragraph 2: Spell out how to claim it and when the offer wraps up.'),
    ],
    closingRule: () => 'Closing sentence: Push readers to claim it before the window closes.',
    extraRules: [
      () => 'Highlight scarcity or limited stock without sounding alarmist.',
    ],
    tasks: [
      () => 'Balance the offer mechanics with atmosphere so it still feels like a hospitality moment.',
      (ctx) => (ctx.relativeLabel ? `Spell out that the offer ends ${ctx.relativeLabel} so the countdown is obvious.` : null),
    ],
    ctaToneRule: () => 'CTA tone: Confident and time-sensitive.',
    ctaSuggestionsRule: () => ['Book now', 'Reserve a table', 'Call us'],
  },
  final_call: {
    openingRule: () => 'Opening: Announce that this is the last chance to get the offer and restate the key saving.',
    paragraphRules: [
      (ctx) => (ctx.relativeLabel
        ? `Paragraph 1: Emphasise urgency—spell out that it ends ${ctx.relativeLabel} and what they miss if they skip it.`
        : 'Paragraph 1: Emphasise urgency—make it clear this is the final hours to claim it and what they miss if they skip it.'),
      (ctx) => (ctx.explicitDate
        ? `Paragraph 2: Give the practical steps to claim and restate the end date ${ctx.explicitDate}.`
        : 'Paragraph 2: Give the practical steps to claim and restate when the offer stops.'),
    ],
    closingRule: () => 'Closing sentence: Finish with a decisive nudge to book or pop in right away.',
    extraRules: [
      () => 'Keep sentences tight so the urgency feels punchy.',
    ],
    tasks: [
      () => 'Make the dwindling availability or cut-off explicit.',
      (ctx) => (ctx.relativeLabel ? `Write a single line that sounds like “Offer ends ${ctx.relativeLabel}” to drive urgency.` : null),
    ],
    ctaToneRule: () => 'CTA tone: Last-call urgency.',
    ctaSuggestionsRule: () => ['Book now', 'Call to claim', 'Pop in today'],
  },
  day_of: {
    openingRule: () => 'Opening: Celebrate that the offer is live today and that it ends tonight with one punchy line.',
    paragraphRules: [
      () => 'Paragraph 1: Invite followers in right now—make it feel like the perfect day or night to enjoy the offer before it disappears.',
      (ctx) => (ctx.explicitDate
        ? `Paragraph 2: Remind them it ends today (or by ${ctx.explicitDate}) and explain how to claim before the day is out.`
        : 'Paragraph 2: Remind them it ends today and explain how to claim before the day is out.'),
    ],
    closingRule: () => 'Closing sentence: Urge them to swing by while it’s still available.',
    tasks: [
      () => 'Use present-tense language so it reads like a live update.',
      () => 'Make it explicit that today is the last chance to claim the offer.',
    ],
    ctaToneRule: () => 'CTA tone: Immediate and welcoming.',
    ctaSuggestionsRule: () => ['Join us today', 'Call us now', 'Pop in tonight'],
  },
  evergreen: {
    openingRule: () => 'Opening: Pair the hero offer with the reason it suits the current season or vibe.',
    paragraphRules: [
      () => 'Paragraph 1: Highlight the sensory appeal of the drink or dish and state the offer clearly.',
      () => 'Paragraph 2: Explain availability (days, times, how to claim) and underline that it’s a limited-time offer.',
    ],
    closingRule: () => 'Closing sentence: Emphasise it’s limited and invite guests to claim it soon.',
    extraRules: [
      () => 'Avoid overly promotional language—keep it hospitable while still sales-driven.',
    ],
    tasks: [
      () => 'Keep the copy anchored in the venue experience so it doesn’t read like a flyer.',
      () => 'Remind readers that the offer ends soon even when writing evergreen copy.',
    ],
    ctaToneRule: () => 'CTA tone: Warm but clearly time-bound.',
    ctaSuggestionsRule: () => ['Book a table', 'Reserve now', 'Call us'],
  },
}

const WEEKLY_SHARED_STAGE_META: StageMeta = {
  paragraphCount: 2,
  structureRule: (ctx) => `Structure: ${ctx.paragraphCount} short paragraphs separated by a single blank line.`,
  openingRule: (ctx) => (ctx.focus
    ? `Opening: Celebrate ${ctx.focus} and position it as the weekly ritual everyone looks forward to.`
    : 'Opening: Celebrate the weekly ritual and why guests love it.'),
  paragraphRules: [
    () => 'Paragraph 1: Paint the vibe of this week’s edition so people can picture themselves there.',
    (ctx) => (ctx.relativeLabel
      ? `Paragraph 2: Remind readers when it happens (${ctx.relativeLabel} or specify the day) and spell out how to join or book.`
      : 'Paragraph 2: Remind readers when it happens and spell out how to join or book.'),
  ],
  closingRule: () => 'Closing sentence: End with a friendly nudge to make this week’s visit.',
  extraRules: [
    () => 'Make it obvious this happens every week—avoid implying it’s a one-off.',
  ],
  tasks: [
    () => 'State that it runs every week and keep the tone welcoming to regulars and newcomers.',
    (ctx) => (ctx.focus
      ? `Tie ${ctx.focus} back to the weekly routine so the copy feels connected to the venue’s personality.`
      : 'Tie a signature detail back to the weekly routine so the copy feels connected to the venue’s personality.'),
  ],
  ctaToneRule: () => 'CTA tone: Friendly reminder to plan their visit this week.',
  ctaSuggestionsRule: () => ['Book a table', 'Join us this week', 'Call us'],
}

const WEEKLY_DAY_OF_META: StageMeta = mergeStageMeta(WEEKLY_SHARED_STAGE_META, {
  openingRule: (ctx) => (ctx.focus
    ? `Opening: Let readers know tonight’s edition of ${ctx.focus} is ready to host them.`
    : 'Opening: Let readers know tonight’s edition is ready to host them.'),
  paragraphRules: [
    () => 'Paragraph 1: Make it feel live—describe what’s happening or being served today.',
    (ctx) => (ctx.relativeLabel
      ? `Paragraph 2: Mention it’s happening ${ctx.relativeLabel} and point directly to how to join (walk in, book, call).`
      : 'Paragraph 2: Mention it’s happening today or tonight and point directly to how to join (walk in, book, call).'),
  ],
  closingRule: () => 'Closing sentence: Invite them to drop in tonight with a warm sign-off.',
})

const WEEKLY_STAGE_META_OVERRIDES: Partial<Record<TimingStage, StageMeta>> = {
  teaser: WEEKLY_SHARED_STAGE_META,
  build_up: WEEKLY_SHARED_STAGE_META,
  final_call: WEEKLY_SHARED_STAGE_META,
  day_of: WEEKLY_DAY_OF_META,
  evergreen: WEEKLY_SHARED_STAGE_META,
}

function getStageMeta(variant: CampaignVariant, stage: TimingStage): StageMeta {
  const base = EVENT_STAGE_META[stage] ?? EVENT_STAGE_META.teaser
  if (variant === 'offer_countdown') {
    return mergeStageMeta(base, OFFER_STAGE_META_OVERRIDES[stage] ?? null)
  }
  if (variant === 'recurring_weekly') {
    return mergeStageMeta(base, WEEKLY_STAGE_META_OVERRIDES[stage] ?? WEEKLY_SHARED_STAGE_META)
  }
  return base
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
  const variant = resolveCampaignVariant(campaign)
  const identityHighlights = normaliseValue(business.identityHighlights)
  const identityHighlightTokens = identityHighlights ? extractHighlights(identityHighlights) : []
  const targetAudience = normaliseValue(business.targetAudience)
  const toneDescriptorList = uniqueStrings(business.toneDescriptors ?? [])
  const toneDescriptorText = toneDescriptorList.join(', ')
  const voiceGuidance = deriveVoiceGuidance(business.brandVoiceSummary, toneDescriptorList)
  const callToAction = deriveCallToAction(campaign)
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
  if (eventDateLabel) {
    appendKeyValue(lines, 1, 'eventDate', eventDateLabel)
    if (variant === 'offer_countdown') {
      appendKeyValue(lines, 1, 'offerEndsOn', eventDateLabel)
    }
  }
  if (eventDayLabel) {
    appendKeyValue(lines, 1, 'eventDay', eventDayLabel)
    if (variant === 'offer_countdown') {
      appendKeyValue(lines, 1, 'offerEndDay', eventDayLabel)
    }
  }
  if (eventTimeLabel) {
    appendKeyValue(lines, 1, 'eventTime', eventTimeLabel)
    if (variant === 'offer_countdown') {
      appendKeyValue(lines, 1, 'offerEndTime', eventTimeLabel)
    }
  }

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

  const hookFocusCandidate = identityHighlightTokens[0] || toneDescriptorList[0] || business.brandVoiceSummary || business.name
  const hookFocus = normaliseValue(hookFocusCandidate)

  const explicitDate = formatAbsoluteDate(campaign.eventDate, false)
  const eventAbsolute = formatAbsoluteDate(campaign.eventDate)
  const scheduledAbsolute = formatAbsoluteDate(campaign.scheduledDate)
  const sameDay = campaign.eventDate && campaign.scheduledDate
    ? isSameCalendarDayZoned(campaign.eventDate, campaign.scheduledDate, LONDON_TIME_ZONE)
    : false
  const scheduledEvening = campaign.scheduledDate
    ? isBetweenLocalTime(campaign.scheduledDate, '16:00', '23:59', LONDON_TIME_ZONE)
    : false

  const timingStage = resolveTimingStage(variant, campaign.eventDate ?? null, campaign.scheduledDate ?? null)
  const stageMeta = getStageMeta(variant, timingStage)
  const paragraphCount = stageMeta.paragraphCount ?? options?.paragraphCount ?? 2

  const stageContext: StageContext = {
    focus: hookFocus ?? null,
    relativeLabel: finalRelativeLabel,
    explicitDate,
    campaignName: campaign.name,
    platformName: platformMeta.displayName,
    objective: campaign.objective ?? null,
    variant,
    paragraphCount,
    isOffer: variant === 'offer_countdown',
    callToAction,
  }

  const tasks: string[] = []
  const addTask = (instruction?: string | null) => {
    const cleaned = normaliseValue(instruction)
    if (!cleaned) return
    tasks.push(`${tasks.length + 1}. ${cleaned}`)
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
  voiceGuidance.tasks.forEach((instruction) => addTask(instruction))
  stageMeta.tasks?.forEach((rule) => {
    addTask(rule(stageContext))
  })

  const outputRules: string[] = []
  const pushRule = (rule?: string | null) => {
    const cleaned = normaliseValue(rule)
    if (!cleaned) return
    outputRules.push(`- ${cleaned}`)
  }

  pushRule(stageMeta.structureRule?.(stageContext) ?? `Structure: ${paragraphCount} short paragraphs separated by a single blank line.`)
  if (stageMeta.openingRule) pushRule(stageMeta.openingRule(stageContext))
  stageMeta.paragraphRules?.forEach((rule) => pushRule(rule(stageContext)))
  if (stageMeta.closingRule) pushRule(stageMeta.closingRule(stageContext))
  stageMeta.extraRules?.forEach((rule) => pushRule(rule(stageContext)))

  pushRule('Format any times using the 12-hour clock with lowercase am/pm (e.g. 7pm, 8:30pm).')
  pushRule('Keep claims grounded in the CONTEXT and GUARDRAILS; omit anything that is not provided.')
  pushRule(`Style: Write in the voice: ${voiceBaton}. Avoid generic hype words (e.g. "epic", "unreal") unless they appear in those notes.`)

  if (typeof business.avgSentenceLength === 'number' && business.avgSentenceLength > 0) {
    pushRule(`Sentence length: mirror the brand guidance (~${Math.round(business.avgSentenceLength)} words per sentence).`)
  } else {
    pushRule('Sentence length: keep to one or two short sentences per paragraph.')
  }

  if (finalRelativeLabel && explicitDate) {
    if (variant === 'offer_countdown') {
      pushRule(`Relative timing: Say “Offer ends ${finalRelativeLabel}” once and mention that it ends on ${explicitDate} once.`)
    } else {
      pushRule(`Relative timing: Mention ${finalRelativeLabel} once and "${explicitDate}" once—keep other day references consistent.`)
    }
  } else if (finalRelativeLabel) {
    if (variant === 'offer_countdown') {
      pushRule(`Relative timing: Phrase it as a countdown (e.g. “Offer ends ${finalRelativeLabel}”) and only say it once.`)
    } else {
      pushRule(`Relative timing: Mention ${finalRelativeLabel} once without inventing alternate phrasing.`)
    }
  } else if (explicitDate && variant === 'offer_countdown') {
    pushRule(`Timing: Make it clear the offer ends on ${explicitDate} once.`)
  } else if (explicitDate) {
    pushRule(`Timing: Mention the date ${explicitDate} once to ground the post.`)
  }

  if (identityHighlights) {
    pushRule(`Let the tone reflect these brand identity notes: ${identityHighlights}.`)
  }
  if (identityHighlightTokens.length) {
    pushRule(`Weave in at least one of: ${identityHighlightTokens.slice(0, 3).join('; ')} so the copy feels unmistakably on-brand.`)
  }
  if (targetAudience) {
    pushRule(`Speak directly to ${targetAudience} using inclusive, second-person language.`)
  }

  voiceGuidance.rules.forEach((rule) => pushRule(rule))

  pushRule('Avoid repeating identical sentences or filler phrases—keep each line purposeful.')

  if (platformMeta.lengthHint) pushRule(`Length guidance: ${platformMeta.lengthHint}`)
  if (campaign.maxLength && campaign.maxLength > 0) pushRule(`Do not exceed ${campaign.maxLength} characters.`)

  if (business.phone) {
    pushRule(`If you mention a phone number, use exactly ${business.phone}. Do not invent or alter digits.`)
  } else {
    pushRule('Do not mention a phone number (none provided).')
  }
  if (business.whatsapp) {
    pushRule(`If you mention WhatsApp or SMS, use the number ${business.whatsapp} and specify the channel.`)
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
  pushRule(linkRule)

  const stageCtaSuggestions = stageMeta.ctaSuggestionsRule?.(stageContext)
  const preferredCtas = callToAction ? [callToAction] : null
  const ctaOptions = uniqueStrings(
    preferredCtas ?? (stageCtaSuggestions && stageCtaSuggestions.length ? stageCtaSuggestions : options?.ctaOptions ?? platformMeta.defaultCtas),
  )
  if (ctaOptions.length) {
    if (preferredCtas) {
      pushRule(`Use the exact call-to-action "${ctaOptions[0]}" to close the post—do not invent alternatives.`)
    } else {
      pushRule(`Include a clear call-to-action using one of: ${ctaOptions.join('; ')}.`)
    }
  }
  const stageCtaTone = stageMeta.ctaToneRule?.(stageContext)
  pushRule(stageCtaTone)

  if (campaign.includeHashtags === false || platformMeta.hashtagPolicy === 'forbid') {
    pushRule('Do not include hashtags.')
  } else if (platformMeta.hashtagPolicy === 'discourage') {
    pushRule('Avoid hashtags unless explicitly required by guardrails or context.')
  }

  const emojiToneFriendly = toneDescriptorList
    .map((desc) => desc.toLowerCase())
    .some((desc) => /(playful|fun|cheeky|joyful|energetic|lively|vibrant|whimsical|light|cheery)/.test(desc))
  const emojiUsagePermitted = business.emojiUsage !== false
  const allowEmojis = campaign.includeEmojis !== false && platformMeta.emojiPolicy !== 'forbid' && emojiToneFriendly && emojiUsagePermitted
  if (!allowEmojis) {
    pushRule('Do not use emojis.')
  } else {
    pushRule('Use emojis sparingly to reinforce the playful tone; avoid overusing them.')
  }

  pushRule('Respect any content boundaries and guardrails exactly as stated.')
  pushRule('Deliver plain text ready to publish (no surrounding quotes, no bullet lists, no numbering beyond the structure above).')

  const timingLines: string[] = []
  if (scheduledAbsolute || eventAbsolute || finalRelativeLabel) {
    timingLines.push('TIMING')
    if (scheduledAbsolute) timingLines.push(`- scheduledFor (authoring time): ${scheduledAbsolute}`)
    if (eventAbsolute) {
      timingLines.push(
        variant === 'offer_countdown'
          ? `- offerEnds (final day): ${eventAbsolute}`
          : `- eventDate (start time): ${eventAbsolute}`,
      )
    }
    if (finalRelativeLabel) timingLines.push(`- relativeLabel: ${finalRelativeLabel}`)
    timingLines.push('')
    timingLines.push('TIMING RULES')
    if (finalRelativeLabel) {
      if (variant === 'offer_countdown') {
        timingLines.push(`- Use the countdown phrase “Offer ends ${finalRelativeLabel}” once and keep other timing language aligned.`)
      } else {
        timingLines.push(`- Mention "${finalRelativeLabel}" exactly once and keep other timing language consistent with it.`)
      }
    }
    if (explicitDate) {
      if (variant === 'offer_countdown') {
        timingLines.push(`- Mention that the offer ends on ${explicitDate} exactly once.`)
      } else {
        timingLines.push(`- Mention the explicit date "${explicitDate}" exactly once.`)
      }
    }
    if (finalRelativeLabel) timingLines.push('- Do not contradict the supplied relativeLabel.')
    if (explicitDate) timingLines.push('- Keep any extra date references aligned with the details above.')
    if (finalRelativeLabel && sameDay) {
      timingLines.push(`- Because this post is scheduled on the day, favour ${scheduledEvening ? '"tonight"' : '"today"'} over weekday phrasing.`)
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
