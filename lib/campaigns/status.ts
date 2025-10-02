import type { SupabaseClient } from '@supabase/supabase-js'

type CampaignSupabaseClient = SupabaseClient<unknown, 'public'>

const normalizeStatus = (value: string | null | undefined): string => {
  if (!value) return 'draft'
  return value.trim().toLowerCase()
}

type RecomputeResult = {
  status: 'draft' | 'active' | 'completed'
  changed: boolean
}

const QUEUE_ACTIVE_STATUSES = new Set(['pending', 'processing'])

type StatusComputationInput = {
  currentStatus: string | null | undefined
  postStatuses: Array<string | null | undefined>
  queueStatuses: Array<string | null | undefined>
}

export const computeCampaignStatus = ({
  currentStatus,
  postStatuses,
  queueStatuses,
}: StatusComputationInput): RecomputeResult['status'] => {
  const normalizedCurrent = normalizeStatus(currentStatus)
  const normalizedPosts = postStatuses.map(normalizeStatus)
  const normalizedQueue = queueStatuses.map(normalizeStatus)

  const hasPosts = normalizedPosts.length > 0
  const hasNonDraftPost = normalizedPosts.some((status) => status !== 'draft')
  const allPublished = hasPosts && normalizedPosts.every((status) => status === 'published')
  const queueActive = normalizedQueue.some((status) => QUEUE_ACTIVE_STATUSES.has(status))

  if (allPublished && !queueActive) {
    return 'completed'
  }
  if (hasNonDraftPost || queueActive) {
    return 'active'
  }
  return normalizedCurrent === 'completed' ? 'completed' : 'draft'
}

export async function recomputeCampaignStatus(
  supabase: CampaignSupabaseClient,
  campaignId: string,
): Promise<RecomputeResult> {
  const { data: campaign, error: fetchCampaignError } = await supabase
    .from('campaigns')
    .select('status')
    .eq('id', campaignId)
    .maybeSingle()

  if (fetchCampaignError) {
    throw fetchCampaignError
  }

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`)
  }

  const { data: posts, error: postsError } = await supabase
    .from('campaign_posts')
    .select('status')
    .eq('campaign_id', campaignId)

  if (postsError) {
    throw postsError
  }

  const postStatuses = (posts ?? []).map((row) => normalizeStatus(row.status))

  const { data: queueEntries, error: queueError } = await supabase
    .from('publishing_queue')
    .select('status, campaign_posts!inner(campaign_id)')
    .eq('campaign_posts.campaign_id', campaignId)

  if (queueError) {
    throw queueError
  }

  const queueStatuses = (queueEntries ?? []).map((row) => normalizeStatus(row.status))
  const nextStatus = computeCampaignStatus({
    currentStatus: campaign.status,
    postStatuses,
    queueStatuses,
  })

  if (campaign.status === nextStatus) {
    return { status: nextStatus, changed: false }
  }

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: nextStatus })
    .eq('id', campaignId)

  if (updateError) {
    throw updateError
  }

  return { status: nextStatus, changed: true }
}

export async function recomputeCampaignStatusSafe(
  supabase: CampaignSupabaseClient,
  campaignId: string,
): Promise<RecomputeResult | null> {
  try {
    return await recomputeCampaignStatus(supabase, campaignId)
  } catch {
    return null
  }
}
