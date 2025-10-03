import { getOpenAIClient } from '@/lib/openai/client'

const TYPE_RULES = {
  event: { required: ['what', 'when', 'cta_link'], recommended: ['hook_or_benefit', 'price_or_terms', 'scarcity_or_urgency', 'logistics', 'support_link'] },
  offer: { required: ['what', 'price_or_terms', 'cta_link'], recommended: ['hook_or_benefit', 'when', 'scarcity_or_urgency', 'support_link'] },
  menu_highlight: { required: ['what', 'hook_or_benefit'], recommended: ['price_or_terms', 'support_link', 'cta_link'] },
  hours_update: { required: ['what', 'when'], banned: ['scarcity_or_urgency', 'hook_or_benefit'], recommended: ['support_link'] },
  sport_screening: { required: ['what', 'when', 'cta_link'], recommended: ['hook_or_benefit', 'logistics', 'support_link', 'scarcity_or_urgency'] },
  job_post: { required: ['what', 'cta_link'], recommended: ['hook_or_benefit', 'price_or_terms', 'when', 'logistics', 'support_link'] },
  community_note: { required: ['what'], banned: ['price_or_terms', 'scarcity_or_urgency'], recommended: ['support_link'] },
  booking_push: { required: ['what', 'when', 'cta_link'], recommended: ['scarcity_or_urgency', 'hook_or_benefit', 'support_link'] },
  service_change: { required: ['what', 'when'], recommended: ['logistics', 'support_link'] },
} as const

const COPY_MODE_RULES = {
  single: { paragraphs: 1, sentences: 2 },
  'two-line': { paragraphs: 2, sentencesPerParagraph: 1 },
  ultra: { paragraphs: 1, sentences: 1, maxWords: 25 },
} as const

type TypeRuleKey = keyof typeof TYPE_RULES
type CopyMode = keyof typeof COPY_MODE_RULES
type Intent = 'conversion' | 'informational' | 'awareness'

type Policies = {
  britishEnglish: boolean
  allowHashtags: boolean
  allowEmojis: boolean
  allowLightHumour: boolean
  timePolicy: { enforceLowercaseAmPm: boolean; enforceEnDashRanges: boolean }
  length: { maxWords: number; singleMaxSentences: number; twoLineSentencesPerParagraph: number }
  linkPolicy: {
    supportLink: { required: boolean; maxCount: number; notInFinalSentence: boolean }
    ctaLink: { required: boolean; mustEndFinalSentence: boolean }
  }
}

type ContentSlots = {
  what?: string | null
  when?: string | null
  where?: string | null
  price_or_terms?: string | null
  hook_or_benefit?: string | null
  scarcity_or_urgency?: string | null
  logistics?: string | null
  cta_text?: string | null
  cta_link?: string | null
  support_link?: string | null
  relativeLabel?: string | null
  microIdentity?: string | null
}

export type PostInput = {
  intent: Intent
  postType: TypeRuleKey
  platform: 'facebook' | 'instagram' | 'instagram_business' | 'x' | 'tiktok' | 'threads' | 'google_my_business' | string
  copyMode: CopyMode
  brand: {
    voice: string
    microIdentity?: string | null
  }
  content: ContentSlots
  policies: Policies
}

const BANNED_WORDS = ['delightful', 'amazing', 'awesome', 'stunning', 'unreal', 'epic', 'incredible', 'fantastic', 'ultimate', 'unforgettable']

export type GenerateOptions = {
  openai?: ReturnType<typeof getOpenAIClient>
  temperature?: number
  appendSystem?: string
  appendUser?: string
}

export type BuildPromptResult = {
  systemPrompt: string
  userPrompt: string
}

type LintResult = { ok: true; content: string } | { ok: false; reason: string }

export async function generateCompliantPost(input: PostInput, options: GenerateOptions = {}): Promise<string> {
  const initialValidation = preflightInput(input)
  if (!initialValidation.ok) {
    return `NEEDS-REVISION: ${initialValidation.reason}`
  }

  let { systemPrompt, userPrompt } = buildCompliancePrompt(input)
  if (options.appendSystem && options.appendSystem.trim().length) {
    systemPrompt = [systemPrompt, options.appendSystem.trim()].join('\n\n')
  }
  if (options.appendUser && options.appendUser.trim().length) {
    userPrompt = [userPrompt, '', options.appendUser.trim()].join('\n')
  }
  const openai = options.openai ?? getOpenAIClient()
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options.temperature ?? 0.5,
    max_tokens: 400,
  })

  const raw = completion.choices[0]?.message?.content?.trim() ?? ''
  const normalised = normaliseOutput(raw, input)
  const linted = lintOutput(normalised, input)
  if (!linted.ok) {
    return `NEEDS-REVISION: ${linted.reason}`
  }
  return linted.content
}

function preflightInput(input: PostInput): { ok: true } | { ok: false; reason: string } {
  const rules = TYPE_RULES[input.postType]
  if (!rules) return { ok: false, reason: `Unsupported postType: ${input.postType}` }

  const missing: string[] = []
  for (const key of rules.required ?? []) {
    const slot = input.content[key as keyof ContentSlots]
    if (!slot) missing.push(key)
  }
  if (missing.length) {
    return { ok: false, reason: `Missing required slots: ${missing.join(', ')}` }
  }

  if ('banned' in rules && Array.isArray((rules as { banned?: readonly string[] }).banned)) {
    const bannedList = (rules as { banned?: readonly string[] }).banned ?? []
    const bannedPresent = bannedList.filter((key) => input.content[key as keyof ContentSlots])
    if (bannedPresent.length) {
      return { ok: false, reason: `Banned slots provided: ${bannedPresent.join(', ')}` }
    }
  }

  return { ok: true }
}

export function buildCompliancePrompt(input: PostInput): BuildPromptResult {
  const systemLines = [
    'You are an expert UK hospitality copywriter.',
    'Use British English spelling and terminology only.',
    'Never fabricate details—use only the information provided.',
    'Return plain text with no markdown, bullets, emojis, or hashtags unless explicitly allowed.',
    'If you cannot satisfy every required rule, respond exactly with NEEDS-REVISION: <reason>.',
  ]

  const lines: string[] = []
  lines.push('BRAND')
  lines.push(`- Voice: ${input.brand.voice}`)
  if (input.brand.microIdentity) {
    lines.push(`- Micro identity (optional use): ${input.brand.microIdentity}`)
  }

  lines.push('\nPOST CONTEXT')
  lines.push(`- Intent: ${input.intent}`)
  lines.push(`- Post type: ${input.postType}`)
  lines.push(`- Platform: ${input.platform}`)
  lines.push(`- Copy mode: ${input.copyMode}`)

  lines.push('\nSLOTS')
  for (const [key, value] of Object.entries(input.content)) {
    if (!value) continue
    lines.push(`- ${key}: ${value}`)
  }

  lines.push('\nPOLICIES')
  lines.push(`- Max words: ${input.policies.length.maxWords}`)
  lines.push(`- Sentence rules: single=${input.policies.length.singleMaxSentences} sentences max; two-line=${input.policies.length.twoLineSentencesPerParagraph} sentence per paragraph.`)
  lines.push(`- Link policy: CTA link must ${input.policies.linkPolicy.ctaLink.mustEndFinalSentence ? 'end the final sentence' : 'be present'}${input.policies.linkPolicy.ctaLink.required ? ' (required)' : ' (optional)'}.`)
  if (input.content.support_link) {
    lines.push(`- Support link limit: ${input.policies.linkPolicy.supportLink.maxCount} (not in final sentence).`)
  }
  lines.push(`- Hashtags allowed: ${input.policies.allowHashtags ? 'yes' : 'no'}`)
  lines.push(`- Emojis allowed: ${input.policies.allowEmojis ? 'yes' : 'no'}`)
  lines.push(`- Use a light dry humour tone only if it fits; keep it polite and plainspoken.`)
  lines.push(`- Times must use lowercase am/pm (e.g. 7pm) and use an en dash for ranges (e.g. 7pm–9:30pm).`)
  if (input.content.relativeLabel) {
    lines.push(`- Mention the relative timing phrase "${input.content.relativeLabel}" exactly once.`)
  } else {
    lines.push('- Do not invent relative timing phrases such as today or tomorrow if none are supplied.')
  }
  lines.push('- If any required policy would be violated, respond with NEEDS-REVISION and explain why.')

  lines.push('\nOUTPUT REQUIREMENTS')
  switch (input.copyMode) {
    case 'single':
      lines.push('- One paragraph, no more than two sentences, and keep within the max word limit.')
      break
    case 'two-line':
      lines.push('- Two paragraphs, exactly one sentence per paragraph, blank line between paragraphs.')
      break
    case 'ultra':
      lines.push('- Single line, no more than 25 words.')
      break
  }
  lines.push('- Ordering for conversion intent: open with what/when, then price or hook, then CTA ending with the CTA link.')
  lines.push('- Keep the CTA link unchanged and visible as provided.')

  lines.push('\nFAIL CONDITIONS')
  lines.push('- Missing CTA link, required slot, or length/timing rule.')
  lines.push('- Use of hashtags or emojis when not allowed.')
  lines.push('- Final sentence fails to end with CTA link when required.')

  return {
    systemPrompt: systemLines.join('\n'),
    userPrompt: lines.join('\n'),
  }
}

function normaliseOutput(content: string, input: PostInput): string {
  let result = content.trim()
  result = normaliseTimes(result, input.policies.timePolicy)
  result = normaliseWhitespace(result, input.copyMode)
  result = safeguardPunctuation(result)
  return result
}

function normaliseTimes(content: string, policy: PostInput['policies']['timePolicy']): string {
  let output = content
  if (policy.enforceLowercaseAmPm) {
    output = output.replace(/\b(\d{1,2})(?::(\d{2}))?\s?(AM|PM)\b/g, (_, hour: string, minutes: string | undefined, suffix: string) => {
      const lowered = suffix.toLowerCase()
      if (!minutes || minutes === '00') {
        return `${hour}${lowered}`
      }
      return `${hour}:${minutes}${lowered}`
    })
  }
  output = output.replace(/\b(\d{1,2}):00\s?(am|pm)\b/g, (_, hour: string, suffix: string) => `${hour}${suffix}`)
  if (policy.enforceEnDashRanges) {
    output = output.replace(/(\d{1,2}(?::\d{2})? ?[ap]m)\s?-\s?(\d{1,2}(?::\d{2})? ?[ap]m)/gi, (_, start, end) => {
      const cleanStart = start.replace(/\s/g, '')
      const cleanEnd = end.replace(/\s/g, '')
      return `${cleanStart}–${cleanEnd}`
    })
  }
  return output
}

function normaliseWhitespace(content: string, copyMode: CopyMode): string {
  const collapseSpaces = content.replace(/[ \t]+/g, ' ')
  if (copyMode === 'two-line') {
    return collapseSpaces.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n\n').trim()
  }
  return collapseSpaces.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trim()
}

function safeguardPunctuation(content: string): string {
  return content
    .replace(/\s+,/g, ',')
    .replace(/\s+([!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim()
}

function lintOutput(content: string, input: PostInput): LintResult {
  if (!content.length) {
    return { ok: false, reason: 'Empty response' }
  }

  if (!input.policies.allowHashtags && /#[\p{L}\w]+/u.test(content)) {
    return { ok: false, reason: 'Hashtags are not allowed.' }
  }

  if (!input.policies.allowEmojis && /[\u{1F300}-\u{1FAFF}]/u.test(content)) {
    return { ok: false, reason: 'Emojis are not allowed.' }
  }

  if (/(\bAM\b|\bPM\b)/.test(content)) {
    return { ok: false, reason: 'Time uses uppercase AM/PM.' }
  }

  if (/\d{1,2}:00\s?[ap]m/.test(content)) {
    return { ok: false, reason: 'Time includes :00 with am/pm.' }
  }

  if (input.content.relativeLabel) {
    const occurrences = countOccurrences(content, input.content.relativeLabel)
    if (occurrences !== 1) {
      return { ok: false, reason: `Relative label must appear exactly once (${input.content.relativeLabel}).` }
    }
  } else {
    if (/(today|tonight|tomorrow|this\s+\w+)/i.test(content)) {
      return { ok: false, reason: 'Relative timing invented without permission.' }
    }
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  if (wordCount > input.policies.length.maxWords) {
    return { ok: false, reason: `Word limit exceeded (${wordCount}/${input.policies.length.maxWords}).` }
  }

  const paragraphs = content.split(/\n{2,}/)
  const modeRule = COPY_MODE_RULES[input.copyMode]
  if (paragraphs.length !== modeRule.paragraphs) {
    return { ok: false, reason: `Expected ${modeRule.paragraphs} paragraphs.` }
  }

  const sentences = splitSentences(content)
  if (input.copyMode === 'single' && sentences.length > input.policies.length.singleMaxSentences) {
    return { ok: false, reason: 'Too many sentences for single mode.' }
  }
  if (input.copyMode === 'ultra' && wordCount > (COPY_MODE_RULES.ultra.maxWords ?? input.policies.length.maxWords)) {
    return { ok: false, reason: 'Ultra mode exceeds 25 words.' }
  }
  if (input.copyMode === 'two-line') {
    for (const paragraph of paragraphs) {
      const sentenceCount = splitSentences(paragraph).length
      if (sentenceCount !== input.policies.length.twoLineSentencesPerParagraph) {
        return { ok: false, reason: 'Each paragraph in two-line mode must be one sentence.' }
      }
    }
  }

  const rules = TYPE_RULES[input.postType]
  const lowerContent = content.toLowerCase()
  for (const key of rules.required ?? []) {
    const value = input.content[key as keyof ContentSlots]
    if (typeof value === 'string' && value.trim()) {
      if (!lowerContent.includes(value.trim().toLowerCase())) {
        return { ok: false, reason: `Required slot missing in output: ${key}` }
      }
    }
  }

  if ('banned' in rules && Array.isArray((rules as { banned?: readonly string[] }).banned)) {
    for (const key of (rules as { banned?: readonly string[] }).banned ?? []) {
      const value = input.content[key as keyof ContentSlots]
      if (typeof value === 'string' && value.trim()) {
        if (lowerContent.includes(value.trim().toLowerCase())) {
          return { ok: false, reason: `Banned slot detected: ${key}` }
        }
      }
    }
  }

  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(content)) {
      return { ok: false, reason: `Banned wording detected: ${word}` }
    }
  }

  if (input.content.support_link) {
    const supportOccurrences = countOccurrences(content, input.content.support_link)
    if (supportOccurrences > input.policies.linkPolicy.supportLink.maxCount) {
      return { ok: false, reason: 'Support link appears too many times.' }
    }
    if (supportOccurrences > 0 && input.policies.linkPolicy.supportLink.notInFinalSentence) {
      const finalSentence = sentences[sentences.length - 1]
      if (finalSentence?.includes(input.content.support_link)) {
        return { ok: false, reason: 'Support link cannot be in the final sentence.' }
      }
    }
  }

  if (input.policies.linkPolicy.ctaLink.required) {
    const cta = input.content.cta_link ?? ''
    if (!cta || !content.includes(cta)) {
      return { ok: false, reason: 'CTA link is required but missing.' }
    }
    if (input.policies.linkPolicy.ctaLink.mustEndFinalSentence) {
      const finalSentence = sentences[sentences.length - 1]?.trim() ?? ''
      if (!finalSentence.endsWith(cta)) {
        return { ok: false, reason: 'Final sentence must end with CTA link.' }
      }
    }
  }

  return { ok: true, content }
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]/g) ?? []).map((sentence) => sentence.trim())
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  const regex = new RegExp(escapeRegex(needle), 'gi')
  return [...haystack.matchAll(regex)].length
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
