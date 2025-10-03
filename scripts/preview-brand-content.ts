#!/usr/bin/env tsx

import { hideBin } from 'yargs/helpers'
import yargs from 'yargs'
import type { Database } from '@/lib/types/database'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { buildCompliancePrompt, generateCompliantPost, type PostInput } from '@/lib/openai/compliance'
import { deriveToneDescriptors, buildBrandVoiceSummary, toOpeningHoursRecord, getRelativeTimingLabel } from '@/lib/openai/prompts'
import { createPostInput } from '@/lib/openai/post-input'

type Supabase = ReturnType<typeof createSupabaseClient<Database>>
type BrandProfileRow = Database['public']['Tables']['brand_profiles']['Row']
type VoiceProfileRow = Database['public']['Tables']['brand_voice_profiles']['Row']
type CampaignPreviewRow = Pick<Database['public']['Tables']['campaigns']['Row'], 'id' | 'name' | 'campaign_type' | 'event_date' | 'description' | 'primary_cta'>

interface Args {
  tenantId?: string
  campaignId?: string
  platform?: string
  prompt?: string
  dryRun: boolean
}

const argv = yargs(hideBin(process.argv))
  .option('tenantId', {
    type: 'string',
    describe: 'Tenant ID to load brand context from',
  })
  .option('campaignId', {
    type: 'string',
    describe: 'Campaign ID to load timings and brief from',
  })
  .option('platform', {
    type: 'string',
    default: 'facebook',
    describe: 'Platform key (facebook | instagram_business | google_my_business | linkedin)',
  })
  .option('prompt', {
    type: 'string',
    describe: 'Optional extra briefing text to include',
  })
  .option('dryRun', {
    type: 'boolean',
    default: false,
    describe: 'Skip calling OpenAI – just show prompts and exit',
  })
  .demandOption(['tenantId'])
  .help()
  .parseSync()

async function createServiceClient(): Promise<Supabase> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function main() {
  const supabase = await createServiceClient()
  const tenantId = argv.tenantId!
  const platform = argv.platform ?? 'facebook'

  const { data: brandProfile, error: brandError } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (brandError) throw brandError

  if (!brandProfile) {
    throw new Error(`No brand profile found for tenant ${tenantId}`)
  }

  const { data: voiceProfile, error: voiceError } = await supabase
    .from('brand_voice_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (voiceError) throw voiceError

  const guardrails = await supabase
    .from('content_guardrails')
    .select('id,feedback_type,feedback_text')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (guardrails.error) {
    throw guardrails.error
  }

  const guardrailRows = guardrails.data ?? []
  let campaignRow: CampaignPreviewRow | null = null
  if (argv.campaignId) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id,name,campaign_type,event_date,description,primary_cta')
      .eq('tenant_id', tenantId)
      .eq('id', argv.campaignId)
      .maybeSingle()
    if (error) throw error
    campaignRow = data
  }

  const posting = argv.campaignId
    ? await supabase
        .from('campaign_posts')
        .select('scheduled_for,platform,post_timing')
        .eq('campaign_id', argv.campaignId)
        .order('scheduled_for', { ascending: true })
        .limit(1)
    : { data: [], error: null }

  if (posting.error) throw posting.error

  const scheduledDate = posting.data && posting.data.length ? new Date(String(posting.data[0]!.scheduled_for)) : new Date()
  const eventDate = campaignRow?.event_date ? new Date(campaignRow.event_date) : undefined

  const toneDescriptors = deriveToneDescriptors(voiceProfile as VoiceProfileRow | undefined, brandProfile as BrandProfileRow | undefined, null)
  const brandVoiceSummary = buildBrandVoiceSummary(voiceProfile as VoiceProfileRow | undefined, brandProfile as BrandProfileRow | undefined)

  const mergedGuardrails = {
    mustInclude: guardrailRows.filter((row) => row.feedback_type === 'include').map((row) => row.feedback_text),
    mustAvoid: guardrailRows.filter((row) => row.feedback_type === 'avoid').map((row) => row.feedback_text),
    tone: guardrailRows.filter((row) => row.feedback_type === 'tone').map((row) => row.feedback_text),
    style: guardrailRows.filter((row) => row.feedback_type === 'style').map((row) => row.feedback_text),
    format: guardrailRows.filter((row) => row.feedback_type === 'format').map((row) => row.feedback_text),
    legal: guardrailRows.filter((row) => row.feedback_type === 'legal').map((row) => row.feedback_text),
  }

  const business = {
    name: brandProfile.business_name ?? 'Unnamed Venue',
    type: brandProfile.business_type ?? 'hospitality venue',
    servesFood: Boolean(brandProfile.serves_food),
    servesDrinks: Boolean(brandProfile.serves_drinks ?? true),
    brandVoiceSummary,
    targetAudience: brandProfile.target_audience ?? undefined,
    identityHighlights: brandProfile.brand_identity ?? undefined,
    toneDescriptors,
    preferredLink: brandProfile.booking_url || brandProfile.website_url || undefined,
    secondaryLink:
      brandProfile.booking_url && brandProfile.website_url && brandProfile.booking_url !== brandProfile.website_url
        ? brandProfile.website_url
        : undefined,
    phone: brandProfile.phone || brandProfile.phone_e164 || undefined,
    whatsapp: brandProfile.whatsapp || brandProfile.whatsapp_e164 || undefined,
    openingHours: toOpeningHoursRecord(brandProfile.opening_hours),
    menus: { food: brandProfile.menu_food_url ?? undefined, drink: brandProfile.menu_drink_url ?? undefined },
    contentBoundaries: brandProfile.content_boundaries ?? undefined,
    additionalContext: undefined,
    avgSentenceLength: voiceProfile?.avg_sentence_length ?? undefined,
    emojiUsage: voiceProfile?.emoji_usage ?? undefined,
  }

  const campaign = {
    name: campaignRow?.name ?? `${platform} post`,
    type: campaignRow?.campaign_type ?? 'General promotion',
    platform,
    objective: campaignRow?.description ?? argv.prompt ?? 'Drive community engagement for the venue.',
    eventDate,
    scheduledDate,
    relativeTiming: eventDate ? getRelativeTimingLabel(eventDate, scheduledDate) : undefined,
    toneAttributes: toneDescriptors,
    creativeBrief: argv.prompt ?? campaignRow?.description ?? undefined,
    additionalContext: argv.prompt ?? undefined,
    includeHashtags: false,
    includeEmojis: voiceProfile?.emoji_usage ?? false,
    maxLength: platform === 'linkedin' ? 700 : undefined,
    callToAction: campaignRow?.primary_cta ?? undefined,
  }

  const postInput: PostInput = createPostInput({
    brandProfile,
    voiceProfile: voiceProfile ?? undefined,
    guardrails: mergedGuardrails,
    campaign: campaignRow,
    platform,
    eventDate,
    relativeLabel: campaign.relativeTiming ?? undefined,
    promptText: argv.prompt ?? undefined,
    fallbackCallToAction: campaign.callToAction ?? undefined,
  })

  const promptPreview = buildCompliancePrompt(postInput)

  console.log('--- SYSTEM PROMPT ---\n')
  console.log(promptPreview.systemPrompt)
  console.log('\n--- USER PROMPT ---\n')
  console.log(promptPreview.userPrompt)

  if (argv.dryRun) {
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('\n⚠️  OPENAI_API_KEY not set; skipping generation. Re-run without --dryRun after exporting the key.')
    return
  }

  const content = await generateCompliantPost(postInput)

  console.log('\n--- POST OUTPUT ---\n')
  console.log(content.trim())
}

main().catch((error) => {
  console.error('Preview failed:', error)
  process.exit(1)
})
