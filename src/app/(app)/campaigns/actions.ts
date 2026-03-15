'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { generateCampaign } from '@/lib/campaigns/generate';
import { calculatePhases } from '@/lib/campaigns/phases';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type {
  AiCampaignPayload,
  BudgetType,
  Campaign,
  CampaignObjective,
  CampaignStatus,
  SpecialAdCategory,
  AdSet,
  AdSetStatus,
  Ad,
  AdStatus,
  CtaType,
} from '@/types/campaigns';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

interface GenerateCampaignInput {
  problemBrief: string;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string;
  adsStopTime: string;
}

interface SaveCampaignMeta {
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string;
  adsStopTime: string;
  problemBrief: string;
}

// ---------------------------------------------------------------------------
// generateCampaignAction
// ---------------------------------------------------------------------------

/**
 * Generates an AI campaign payload for the authenticated account.
 * Checks that the Meta Ads account is connected and setup is complete before
 * calling OpenAI. Returns { error } if the account is not ready.
 */
export async function generateCampaignAction(
  input: GenerateCampaignInput,
): Promise<{ payload: AiCampaignPayload } | { error: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // 1. Verify Meta Ads account is connected and setup_complete
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('setup_complete, meta_account_id')
    .eq('account_id', accountId)
    .maybeSingle<{ setup_complete: boolean; meta_account_id: string }>();

  if (!adAccount?.setup_complete) {
    return {
      error:
        'Meta Ads account not connected. Please complete the Meta Ads setup in Connections before generating a campaign.',
    };
  }

  // 2. Fetch venue name from the accounts table for AI context
  const { data: accountRow } = await supabase
    .from('accounts')
    .select('display_name')
    .eq('id', accountId)
    .single<{ display_name: string | null }>();

  const venueName = accountRow?.display_name?.trim() || 'our venue';

  // 3. Calculate phases from dates (deterministic — AI does not decide these)
  const phases = calculatePhases(input.startDate, input.endDate, input.adsStopTime);

  try {
    const rawPayload = await generateCampaign({
      problemBrief: input.problemBrief,
      venueName,
      // We do not store a separate city column on accounts — use a sensible default.
      venueLocation: 'UK',
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      phases,
    });

    // Annotate the Day Of ad set (last phase) with ads_stop_time.
    // generateCampaign returns adsets in phase order; the last one is always Day Of.
    // This bridges the gap between the form input and the AiCampaignPayload shape
    // that saveCampaignDraft reads from (adSetInput.ads_stop_time).
    const payload = {
      ...rawPayload,
      ad_sets: rawPayload.ad_sets.map((as, i) =>
        i === rawPayload.ad_sets.length - 1
          ? { ...as, ads_stop_time: input.adsStopTime }
          : as,
      ),
    };

    return { payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate campaign.';
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// saveCampaignDraft
// ---------------------------------------------------------------------------

/**
 * Persists an AI-generated campaign payload as a DRAFT across the campaigns,
 * ad_sets and ads tables. Returns the new campaign's UUID, or { error } on failure.
 */
export async function saveCampaignDraft(
  payload: AiCampaignPayload,
  meta: SaveCampaignMeta,
): Promise<{ campaignId: string } | { error: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  try {
    // Insert campaign row
    const { data: campaignRow, error: campaignError } = await supabase
      .from('meta_campaigns')
      .insert({
        account_id: accountId,
        name: payload.campaign_name,
        objective: payload.objective,
        problem_brief: meta.problemBrief,
        ai_rationale: payload.rationale,
        budget_type: meta.budgetType,
        budget_amount: meta.budgetAmount,
        start_date: meta.startDate,
        end_date: meta.endDate,
        status: 'DRAFT',
        special_ad_category: payload.special_ad_category,
      })
      .select('id')
      .single<{ id: string }>();

    if (campaignError) return { error: campaignError.message };
    if (!campaignRow) return { error: 'Campaign insert returned no data' };

    const campaignId = campaignRow.id;

    // Insert ad_sets and their ads
    for (const adSetInput of payload.ad_sets) {
      const { data: adSetRow, error: adSetError } = await supabase
        .from('ad_sets')
        .insert({
          campaign_id: campaignId,
          name: adSetInput.name,
          phase_start: adSetInput.phase_start ?? null,
          phase_end: adSetInput.phase_end ?? null,
          targeting: adSetInput.targeting,
          placements: adSetInput.placements,
          optimisation_goal: adSetInput.optimisation_goal,
          bid_strategy: adSetInput.bid_strategy,
          adset_media_asset_id: adSetInput.adset_media_asset_id ?? null,
          adset_image_url: adSetInput.adset_image_url ?? null,
          ads_stop_time: adSetInput.ads_stop_time ?? null,
          status: 'DRAFT',
        })
        .select('id')
        .single<{ id: string }>();

      if (adSetError) return { error: adSetError.message };
      if (!adSetRow) return { error: 'Ad set insert returned no data' };

      const adSetId = adSetRow.id;

      for (const adInput of adSetInput.ads) {
        const { error: adError } = await supabase.from('ads').insert({
          adset_id: adSetId,
          name: adInput.name,
          headline: adInput.headline,
          primary_text: adInput.primary_text,
          description: adInput.description,
          cta: adInput.cta,
          creative_brief: adInput.creative_brief,
          angle: adInput.angle ?? null,
          media_asset_id: adInput.media_asset_id ?? null,
          status: 'DRAFT',
        });

        if (adError) return { error: adError.message };
      }
    }

    revalidatePath('/campaigns');
    return { campaignId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save campaign draft.';
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// saveAndPublishCampaign
// ---------------------------------------------------------------------------

/**
 * Saves a campaign draft then immediately publishes it to Meta Ads Manager.
 *
 * - Save failure: returns { error } — nothing written to DB.
 * - Save success + publish failure: returns { campaignId } — campaign saved as DRAFT.
 *   publishCampaign writes publish_error to DB internally.
 * - Save success + publish success: returns { campaignId } — campaign is ACTIVE.
 *
 * Always redirect to /campaigns/[campaignId] unless { error } is returned.
 */
export async function saveAndPublishCampaign(
  payload: AiCampaignPayload,
  meta: SaveCampaignMeta,
): Promise<{ campaignId: string } | { error: string }> {
  // saveCampaignDraft re-verifies auth via requireAuthContext internally.
  const saveResult = await saveCampaignDraft(payload, meta);

  if ('error' in saveResult) {
    return { error: saveResult.error };
  }

  const { campaignId } = saveResult;

  // Publish inline. publishCampaign owns publish_error writes on both failure
  // and success, so no additional DB write is needed here.
  await publishCampaign(campaignId);

  return { campaignId };
}

// ---------------------------------------------------------------------------
// getCampaigns
// ---------------------------------------------------------------------------

/**
 * Returns all campaigns for the authenticated account, ordered newest-first.
 */
export async function getCampaigns(): Promise<Campaign[]> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('meta_campaigns')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return data.map(dbRowToCampaign);
}

// ---------------------------------------------------------------------------
// getCampaignWithTree
// ---------------------------------------------------------------------------

/**
 * Returns a single campaign with nested ad_sets and ads.
 */
export async function getCampaignWithTree(campaignId: string): Promise<Campaign | null> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('meta_campaigns')
    .select('*, ad_sets ( *, ads (*) )')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single<CampaignDbRowWithTree>();

  if (error) throw error;
  if (!data) return null;

  return dbRowToCampaignWithTree(data);
}

// ---------------------------------------------------------------------------
// deleteCampaign
// ---------------------------------------------------------------------------

/**
 * Deletes a campaign (and its cascaded ad_sets/ads) by ID.
 * Only permits deletion of campaigns belonging to the authenticated account.
 */
export async function deleteCampaign(
  campaignId: string,
): Promise<{ success: true } | { error: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from('meta_campaigns')
    .delete()
    .eq('id', campaignId)
    .eq('account_id', accountId);

  if (error) return { error: error.message };

  revalidatePath('/campaigns');
  return { success: true };
}

// ---------------------------------------------------------------------------
// DB → TypeScript mappers
// ---------------------------------------------------------------------------

interface CampaignDbRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  name: string;
  objective: string;
  problem_brief: string;
  ai_rationale: string | null;
  budget_type: string;
  budget_amount: number;
  start_date: string;
  end_date: string | null;
  status: string;
  meta_status: string | null;
  publish_error: string | null;
  special_ad_category: string;
  last_synced_at: string | null;
  created_at: string;
}

interface AdDbRow {
  id: string;
  adset_id: string;
  meta_ad_id: string | null;
  meta_creative_id: string | null;
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  angle: string | null;
  media_asset_id: string | null;
  creative_brief: string | null;
  preview_url: string | null;
  status: string;
  created_at: string;
}

interface AdSetDbRow {
  id: string;
  campaign_id: string;
  meta_adset_id: string | null;
  name: string;
  phase_start: string | null;
  phase_end: string | null;
  targeting: object;
  placements: object | string;
  budget_amount: number | null;
  optimisation_goal: string;
  bid_strategy: string;
  adset_media_asset_id: string | null;
  adset_image_url: string | null;
  ads_stop_time: string | null;
  status: string;
  created_at: string;
  ads?: AdDbRow[];
}

interface CampaignDbRowWithTree extends CampaignDbRow {
  ad_sets?: AdSetDbRow[];
}

function dbRowToAd(row: AdDbRow): Ad {
  return {
    id: row.id,
    adsetId: row.adset_id,
    metaAdId: row.meta_ad_id,
    metaCreativeId: row.meta_creative_id,
    name: row.name,
    headline: row.headline,
    primaryText: row.primary_text,
    description: row.description,
    cta: row.cta as CtaType,
    angle: row.angle ?? null,
    mediaAssetId: row.media_asset_id,
    creativeBrief: row.creative_brief,
    previewUrl: row.preview_url,
    status: row.status as AdStatus,
    createdAt: new Date(row.created_at),
  };
}

function dbRowToAdSet(row: AdSetDbRow): AdSet {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    metaAdsetId: row.meta_adset_id,
    name: row.name,
    phaseLabel: null,
    phaseStart: row.phase_start,
    phaseEnd: row.phase_end,
    targeting: row.targeting as AdSet['targeting'],
    placements: row.placements as AdSet['placements'],
    budgetAmount: row.budget_amount,
    optimisationGoal: row.optimisation_goal,
    bidStrategy: row.bid_strategy,
    adsetMediaAssetId: row.adset_media_asset_id ?? null,
    adsetImageUrl: row.adset_image_url ?? null,
    adsStopTime: row.ads_stop_time ?? null,
    status: row.status as AdSetStatus,
    createdAt: new Date(row.created_at),
    ads: row.ads?.map(dbRowToAd),
  };
}

function dbRowToCampaign(row: CampaignDbRow): Campaign {
  return {
    id: row.id,
    accountId: row.account_id,
    metaCampaignId: row.meta_campaign_id,
    name: row.name,
    objective: row.objective as CampaignObjective,
    problemBrief: row.problem_brief,
    aiRationale: row.ai_rationale,
    budgetType: row.budget_type as BudgetType,
    budgetAmount: Number(row.budget_amount),
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as CampaignStatus,
    metaStatus: row.meta_status,
    publishError: row.publish_error ?? null,
    specialAdCategory: row.special_ad_category as SpecialAdCategory,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function dbRowToCampaignWithTree(row: CampaignDbRowWithTree): Campaign {
  const campaign = dbRowToCampaign(row);
  campaign.adSets = row.ad_sets?.map(dbRowToAdSet);
  return campaign;
}
