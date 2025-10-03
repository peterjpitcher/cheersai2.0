import type { Database } from '@/lib/types/database'
import { formatDate, formatTime } from '@/lib/datetime'
import { defaultCtasForPlatform } from '@/lib/openai/prompts'
import type { PostInput } from '@/lib/openai/compliance'

type BrandProfileRow = Database['public']['Tables']['brand_profiles']['Row']
type VoiceProfileRow = Database['public']['Tables']['brand_voice_profiles']['Row']
type CampaignRow = Pick<Database['public']['Tables']['campaigns']['Row'], 'id' | 'name' | 'campaign_type' | 'event_date' | 'description' | 'primary_cta'> | null

type Intent = PostInput['intent']
type CopyMode = PostInput['copyMode']
type TypeRuleKey = PostInput['postType']

type GuardrailBuckets = {
  mustInclude: string[]
  mustAvoid: string[]
  tone: string[]
  style: string[]
  format: string[]
  legal: string[]
}

type BuildPostInputArgs = {
  brandProfile: BrandProfileRow
  voiceProfile?: VoiceProfileRow
  guardrails: GuardrailBuckets
  campaign: CampaignRow
  platform: string
  eventDate?: Date
  relativeLabel?: string
  promptText?: string
  fallbackCallToAction?: string
}

export function createPostInput(args: BuildPostInputArgs): PostInput {
  const { brandProfile, voiceProfile, guardrails, campaign, platform, eventDate, relativeLabel, promptText, fallbackCallToAction } = args

  const intent: Intent = 'conversion'
  const postType = mapCampaignTypeToPostType(campaign?.campaign_type)
  const copyMode: CopyMode = intent === 'conversion' ? 'two-line' : 'single'

  const microIdentity = toMicroIdentity(brandProfile.brand_identity)
  const brandVoice = buildVoiceDescription(brandProfile, voiceProfile)

  const sources = collectSources([
    campaign?.description,
    promptText,
    brandProfile.brand_identity,
    guardrails.mustInclude.join(' | '),
    guardrails.mustAvoid.join(' | '),
    campaign?.primary_cta,
  ])

  const what = campaign?.name ?? 'Upcoming event'
  const when = buildWhenSlot(eventDate)
  const where = brandProfile.business_name ?? 'Our venue'
  const priceOrTerms = extractFirstMatch(sources, /(£\d|per\s|cash|book)/i)
  const hookOrBenefit = extractFirstMatch(sources, /(jackpot|prize|benefit|special|snowball|deal|highlight)/i)
  const scarcity = extractFirstMatch(sources, /(limited|sell out|few|last)/i)
  const logistics = extractFirstMatch(sources, /(arrive|kitchen|serving|doors|open|walk)/i)

  const preferredLink = brandProfile.booking_url || brandProfile.website_url || undefined
  const secondaryLink = brandProfile.website_url && brandProfile.website_url !== preferredLink ? brandProfile.website_url : undefined

  const ctaLink = chooseCtaLink(platform, preferredLink, secondaryLink)
  const supportLink = secondaryLink && secondaryLink !== ctaLink ? secondaryLink : undefined
  const ctaText = campaign?.primary_cta ?? fallbackCallToAction ?? defaultCtasForPlatform(platform)[0]

  const postInput: PostInput = {
    intent,
    postType,
    platform: platform as PostInput['platform'],
    copyMode,
    brand: {
      voice: brandVoice,
      microIdentity,
    },
    content: {
      what,
      when,
      where,
      price_or_terms: priceOrTerms,
      hook_or_benefit: hookOrBenefit,
      scarcity_or_urgency: scarcity,
      logistics,
      cta_text: ctaText,
      cta_link: ctaLink ?? undefined,
      support_link: supportLink,
      relativeLabel,
    },
    policies: {
      britishEnglish: true,
      allowHashtags: false,
      allowEmojis: false,
      allowLightHumour: true,
      timePolicy: { enforceLowercaseAmPm: true, enforceEnDashRanges: true },
      length: { maxWords: 60, singleMaxSentences: 2, twoLineSentencesPerParagraph: 1 },
      linkPolicy: {
        supportLink: { required: false, maxCount: 1, notInFinalSentence: true },
        ctaLink: { required: true, mustEndFinalSentence: true },
      },
    },
  }

  return postInput
}

export function buildGuardrailAppend(guardrails: GuardrailBuckets): string | undefined {
  const lines: string[] = []
  if (guardrails.mustInclude.length) {
    lines.push(`Must include: ${guardrails.mustInclude.join('; ')}`)
  }
  if (guardrails.mustAvoid.length) {
    lines.push(`Forbidden: ${guardrails.mustAvoid.join('; ')}`)
  }
  if (guardrails.tone.length) {
    lines.push(`Tone guidance: ${guardrails.tone.join('; ')}`)
  }
  if (guardrails.style.length) {
    lines.push(`Style guidance: ${guardrails.style.join('; ')}`)
  }
  if (guardrails.format.length) {
    lines.push(`Formatting notes: ${guardrails.format.join('; ')}`)
  }
  if (guardrails.legal.length) {
    lines.push(`Legal boundaries: ${guardrails.legal.join('; ')}`)
  }
  return lines.length ? `GUARDRAILS:\n- ${lines.join('\n- ')}` : undefined
}

function collectSources(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function extractFirstMatch(sources: string[], pattern: RegExp): string | undefined {
  for (const source of sources) {
    const segments = source.split(/\r?\n|[.]/).map((segment) => segment.trim()).filter(Boolean)
    for (const segment of segments) {
      if (pattern.test(segment)) {
        return segment.replace(/\s+/g, ' ').trim()
      }
    }
  }
  return undefined
}

function mapCampaignTypeToPostType(value?: string | null): TypeRuleKey {
  const lower = (value ?? '').toLowerCase()
  if (lower.includes('offer') || lower.includes('deal')) return 'offer'
  if (lower.includes('menu')) return 'menu_highlight'
  if (lower.includes('hour')) return 'hours_update'
  if (lower.includes('job')) return 'job_post'
  if (lower.includes('community')) return 'community_note'
  if (lower.includes('booking')) return 'booking_push'
  if (lower.includes('service')) return 'service_change'
  if (lower.includes('sport')) return 'sport_screening'
  return 'event'
}

function buildWhenSlot(eventDate?: Date): string | undefined {
  if (!eventDate) return undefined
  const day = formatDate(eventDate, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' })
  const time = formatTime(eventDate, 'Europe/London').replace(/\s/g, '')
  return `${day}, ${time}`
}

function chooseCtaLink(platform: string, preferred?: string, secondary?: string): string | undefined {
  if (platform === 'instagram' || platform === 'instagram_business') {
    return secondary ?? preferred ?? undefined
  }
  return preferred ?? secondary ?? undefined
}

function toMicroIdentity(text?: string | null): string | undefined {
  if (!text) return undefined
  const words = text.split(/\s+/).slice(0, 8)
  if (!words.length) return undefined
  return words.join(' ')
}

function buildVoiceDescription(brandProfile: BrandProfileRow, voiceProfile?: VoiceProfileRow): string {
  if (brandProfile.brand_voice && brandProfile.brand_voice.trim().length > 0) {
    return brandProfile.brand_voice
  }
  if (voiceProfile?.characteristics && voiceProfile.characteristics.length > 0) {
    return `Characteristics: ${voiceProfile.characteristics.join(', ')}`
  }
  return 'Warm, polite, straight to the point; dry humour when it fits. No buzzwords.'
}
