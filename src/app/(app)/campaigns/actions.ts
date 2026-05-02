'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { generateCampaign } from '@/lib/campaigns/generate';
import { calculateEvergreenPhases, calculateInclusiveDurationDays, calculatePhases } from '@/lib/campaigns/phases';
import {
  createManagementMetaAdsLink,
  ManagementApiError,
  type ManagementMetaAdsLink,
} from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import { isSchemaMissingError } from '@/lib/supabase/errors';
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
  PaidCampaignKind,
  GeoRadiusMiles,
} from '@/types/campaigns';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

interface GenerateCampaignInput {
  campaignKind: PaidCampaignKind;
  promotionName: string;
  problemBrief: string;
  destinationUrl: string;
  geoRadiusMiles: GeoRadiusMiles;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string;
  adsStopTime?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceSnapshot?: Record<string, unknown> | null;
}

interface SaveCampaignMeta {
  campaignKind: PaidCampaignKind;
  promotionName: string;
  budgetAmount: number;
  budgetType: BudgetType;
  geoRadiusMiles: GeoRadiusMiles;
  startDate: string;
  endDate: string;
  adsStopTime?: string;
  problemBrief: string;
  destinationUrl: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceSnapshot?: Record<string, unknown> | null;
}

interface GenerateCampaignSuccess {
  payload: AiCampaignPayload;
  destinationUrl: string;
  sourceSnapshot: Record<string, unknown>;
}

interface PaidDestinationResolution {
  destinationUrl: string;
  sourceSnapshot: Record<string, unknown>;
}

const VALID_GEO_RADII: readonly GeoRadiusMiles[] = [1, 3, 5, 10];

function validateGeoRadiusMiles(value: number): GeoRadiusMiles {
  if ((VALID_GEO_RADII as readonly number[]).includes(value)) {
    return value as GeoRadiusMiles;
  }

  throw new Error('Choose a valid local targeting radius.');
}

function validateDestinationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a valid paid CTA URL before generating the campaign.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Paid CTA URL must use http or https.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'example.com' || hostname === 'www.example.com') {
    throw new Error('Paid CTA URL cannot be the example.com placeholder.');
  }

  return parsed.toString();
}

function validatePaidCampaignMeta(meta: SaveCampaignMeta): void {
  validateDestinationUrl(meta.destinationUrl);
  validateGeoRadiusMiles(meta.geoRadiusMiles);

  if (meta.budgetAmount <= 0) {
    throw new Error('Budget must be greater than 0.');
  }

  if (meta.campaignKind === 'event') {
    if (!meta.adsStopTime) {
      throw new Error('Event campaigns require an ads stop time.');
    }
    calculatePhases(meta.startDate, meta.endDate, meta.adsStopTime);
    return;
  }

  calculateInclusiveDurationDays(meta.startDate, meta.endDate);
  calculateEvergreenPhases(meta.startDate, meta.endDate);
}

async function resolvePaidDestination(input: GenerateCampaignInput): Promise<PaidDestinationResolution> {
  validateDestinationUrl(input.destinationUrl);
  validateGeoRadiusMiles(input.geoRadiusMiles);

  if (input.budgetAmount <= 0) {
    throw new Error('Budget must be greater than 0.');
  }

  if (input.campaignKind === 'event') {
    if (!input.adsStopTime) {
      throw new Error('Event campaigns require an ads stop time.');
    }

    return {
      destinationUrl: validateDestinationUrl(input.destinationUrl),
      sourceSnapshot: {
        ...(input.sourceSnapshot ?? {}),
        campaignKind: 'event',
        sourceType: input.sourceType ?? 'management_event',
        sourceId: input.sourceId ?? null,
        paidCtaUrl: input.destinationUrl,
        geoRadiusMiles: input.geoRadiusMiles,
      },
    };
  }

  calculateEvergreenPhases(input.startDate, input.endDate);

  const config = await getManagementConnectionConfig();
  let link: ManagementMetaAdsLink;

  try {
    link = await createManagementMetaAdsLink(config, {
      destinationUrl: input.destinationUrl,
      campaignName: input.promotionName,
      metadata: {
        campaign_kind: 'evergreen',
        source_type: input.sourceType ?? 'custom_promotion',
        source_id: input.sourceId ?? null,
        geo_radius_miles: input.geoRadiusMiles,
      },
    });
  } catch (error) {
    throw mapPaidLinkError(error);
  }

  return {
    destinationUrl: validateDestinationUrl(link.shortUrl),
    sourceSnapshot: {
      ...(input.sourceSnapshot ?? {}),
      campaignKind: 'evergreen',
      sourceType: input.sourceType ?? 'custom_promotion',
      sourceId: input.sourceId ?? null,
      originalDestinationUrl: input.destinationUrl,
      paidCtaUrl: link.shortUrl,
      utmDestinationUrl: link.utmDestinationUrl,
      shortCode: link.shortCode,
      reusedShortLink: link.alreadyExists,
      geoRadiusMiles: input.geoRadiusMiles,
    },
  };
}

function mapPaidLinkError(error: unknown): Error {
  if (isSchemaMissingError(error)) {
    return new Error('Management connection schema is missing. Run the latest Supabase migrations, then configure it in Settings.');
  }

  if (error instanceof ManagementApiError) {
    if (error.code === 'UNAUTHORIZED') {
      return new Error('Management API rejected the stored credentials. Check the management app connection in Settings.');
    }
    if (error.code === 'FORBIDDEN') {
      return new Error('Management API key is missing read:events/read:menu permissions required for paid Meta links.');
    }
    if (error.code === 'NETWORK') {
      return new Error('Management API is unreachable, so the paid Meta short link could not be created.');
    }
    return new Error(error.message);
  }

  return error instanceof Error ? error : new Error('Failed to create paid Meta short link.');
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
): Promise<GenerateCampaignSuccess | { error: string }> {
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

  const { data: postingDefaults } = await supabase
    .from('posting_defaults')
    .select('venue_location')
    .eq('account_id', accountId)
    .maybeSingle<{ venue_location: string | null }>();

  const venueName = accountRow?.display_name?.trim() || 'our venue';
  const venueLocation = postingDefaults?.venue_location?.trim() || 'Configured local venue';

  try {
    const destination = await resolvePaidDestination(input);
    const phases =
      input.campaignKind === 'event'
        ? calculatePhases(input.startDate, input.endDate, input.adsStopTime ?? '')
        : calculateEvergreenPhases(input.startDate, input.endDate);

    const rawPayload = await generateCampaign({
      campaignKind: input.campaignKind,
      promotionName: input.promotionName,
      problemBrief: input.problemBrief,
      destinationUrl: destination.destinationUrl,
      venueName,
      venueLocation,
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      phases,
    });

    const payload = {
      ...rawPayload,
      ad_sets: rawPayload.ad_sets.map((as, i) =>
        input.campaignKind === 'event' && i === rawPayload.ad_sets.length - 1
          ? { ...as, ads_stop_time: input.adsStopTime }
          : as,
      ),
    };

    return {
      payload,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot: destination.sourceSnapshot,
    };
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
    validatePaidCampaignMeta(meta);

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
        geo_radius_miles: meta.geoRadiusMiles,
        start_date: meta.startDate,
        end_date: meta.endDate,
        status: 'DRAFT',
        special_ad_category: payload.special_ad_category,
        campaign_kind: meta.campaignKind,
        source_type: meta.sourceType ?? null,
        source_id: meta.sourceId ?? null,
        destination_url: meta.destinationUrl,
        source_snapshot: meta.sourceSnapshot ?? {},
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
  campaign_kind: string | null;
  source_type: string | null;
  source_id: string | null;
  destination_url: string | null;
  geo_radius_miles: number | null;
  source_snapshot: Record<string, unknown> | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | null;
  metrics_reach: number | null;
  metrics_clicks: number | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
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
    campaignKind: (row.campaign_kind ?? 'event') as PaidCampaignKind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    destinationUrl: row.destination_url,
    geoRadiusMiles: validateGeoRadiusMiles(row.geo_radius_miles ?? 3),
    sourceSnapshot: row.source_snapshot ?? null,
    performance: {
      spend: Number(row.metrics_spend ?? 0),
      impressions: Number(row.metrics_impressions ?? 0),
      reach: Number(row.metrics_reach ?? 0),
      clicks: Number(row.metrics_clicks ?? 0),
      ctr: Number(row.metrics_ctr ?? 0),
      cpc: Number(row.metrics_cpc ?? 0),
    },
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function dbRowToCampaignWithTree(row: CampaignDbRowWithTree): Campaign {
  const campaign = dbRowToCampaign(row);
  campaign.adSets = row.ad_sets?.map(dbRowToAdSet);
  return campaign;
}
