'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { buildCampaignDashboard, type CampaignDashboardModel } from '@/lib/campaigns/dashboard';
import { generateCampaign } from '@/lib/campaigns/generate';
import { applyDeterministicCampaignNames } from '@/lib/campaigns/naming';
import { calculateEvergreenPhases, calculateInclusiveDurationDays, calculatePhases } from '@/lib/campaigns/phases';
import {
  normaliseAudienceKeywords,
  normaliseResolvedInterests,
  resolveMetaInterestsForKeywords,
} from '@/lib/campaigns/interest-targeting';
import {
  searchMetaInterests,
} from '@/lib/meta/marketing';
import {
  createManagementMetaAdsLink,
  ManagementApiError,
  type ManagementMetaAdsLink,
} from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import { runMetaCampaignOptimisation } from '@/lib/campaigns/optimisation';
import { syncMetaCampaignPerformance } from '@/lib/campaigns/performance-sync';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type {
  AiCampaignPayload,
  BudgetType,
  Campaign,
  CampaignPerformanceMetrics,
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
  AudienceMode,
  ResolvedMetaInterest,
  OptimisationActionSummary,
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
  audienceMode: AudienceMode;
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
  audienceMode: AudienceMode;
  audienceInterestKeywords?: string[];
  resolvedInterests?: ResolvedMetaInterest[];
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
  audienceInterestKeywords: string[];
  resolvedInterests: ResolvedMetaInterest[];
  interestResolutionWarning: string | null;
}

interface PaidDestinationResolution {
  destinationUrl: string;
  sourceSnapshot: Record<string, unknown>;
}

const VALID_GEO_RADII: readonly GeoRadiusMiles[] = [1, 3, 5, 10];
const VALID_AUDIENCE_MODES: readonly AudienceMode[] = ['local_only', 'local_interests'];
const DEFAULT_META_PIXEL_ID = '757659911002159';
const TRACKABLE_BOOKING_HOSTS = new Set(['the-anchor.pub', 'www.the-anchor.pub']);

interface ConversionOptimisationConfig {
  enabled: boolean;
  pixelId: string | null;
  eventName: string;
}

interface ConversionRuleResult {
  payload: AiCampaignPayload;
  bookingOptimised: boolean;
}

function validateGeoRadiusMiles(value: number): GeoRadiusMiles {
  if ((VALID_GEO_RADII as readonly number[]).includes(value)) {
    return value as GeoRadiusMiles;
  }

  throw new Error('Choose a valid local targeting radius.');
}

function validateAudienceMode(value: string | null | undefined): AudienceMode {
  if ((VALID_AUDIENCE_MODES as readonly string[]).includes(value ?? '')) {
    return value as AudienceMode;
  }

  throw new Error('Choose a valid audience mode.');
}

function buildConversionOptimisationConfig(row: {
  meta_pixel_id?: string | null;
  conversion_event_name?: string | null;
  conversion_optimisation_enabled?: boolean | null;
} | null | undefined): ConversionOptimisationConfig {
  const pixelId = row?.meta_pixel_id?.trim() || DEFAULT_META_PIXEL_ID;
  return {
    enabled: row?.conversion_optimisation_enabled !== false,
    pixelId,
    eventName: row?.conversion_event_name?.trim() || 'Purchase',
  };
}

async function getConversionOptimisationConfig(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
): Promise<ConversionOptimisationConfig> {
  const { data, error } = await supabase
    .from('meta_ad_accounts')
    .select('meta_pixel_id, conversion_event_name, conversion_optimisation_enabled')
    .eq('account_id', accountId)
    .maybeSingle<{
      meta_pixel_id: string | null;
      conversion_event_name: string | null;
      conversion_optimisation_enabled: boolean | null;
    }>();

  if (error) throw error;
  return buildConversionOptimisationConfig(data);
}

function applyDeterministicPaidRules(
  payload: AiCampaignPayload,
  meta: {
    campaignKind: PaidCampaignKind;
    destinationUrl: string;
    sourceSnapshot?: Record<string, unknown> | null;
    conversionConfig: ConversionOptimisationConfig;
  },
): ConversionRuleResult {
  const bookingOptimised = shouldUseBookingOptimisation({
    campaignKind: meta.campaignKind,
    destinationUrl: meta.destinationUrl,
    sourceSnapshot: meta.sourceSnapshot,
    conversionConfig: meta.conversionConfig,
  });

  return {
    bookingOptimised,
    payload: {
      ...payload,
      objective: bookingOptimised ? 'OUTCOME_SALES' : payload.objective,
      ad_sets: payload.ad_sets.map((adSet) => ({
        ...adSet,
        optimisation_goal: bookingOptimised ? 'OFFSITE_CONVERSIONS' : adSet.optimisation_goal,
        ads: adSet.ads.map((ad) => ({
          ...ad,
          cta: meta.campaignKind === 'event' ? 'BOOK_NOW' : ad.cta,
        })),
      })),
    },
  };
}

function shouldUseBookingOptimisation(args: {
  campaignKind: PaidCampaignKind;
  destinationUrl: string;
  sourceSnapshot?: Record<string, unknown> | null;
  conversionConfig: ConversionOptimisationConfig;
}): boolean {
  return Boolean(
    args.conversionConfig.enabled &&
      args.conversionConfig.pixelId &&
      isTrackableBookingDestination(args.campaignKind, args.destinationUrl, args.sourceSnapshot),
  );
}

function isTrackableBookingDestination(
  campaignKind: PaidCampaignKind,
  destinationUrl: string,
  sourceSnapshot?: Record<string, unknown> | null,
): boolean {
  if (campaignKind === 'event') return true;

  const candidateUrls = [
    destinationUrl,
    sourceSnapshot?.originalDestinationUrl,
    sourceSnapshot?.utmDestinationUrl,
    sourceSnapshot?.paidCtaUrl,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return candidateUrls.some((candidate) => {
    try {
      return TRACKABLE_BOOKING_HOSTS.has(new URL(candidate).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
}

function buildConversionSourceSnapshot(args: {
  sourceSnapshot: Record<string, unknown>;
  bookingOptimised: boolean;
  conversionConfig: ConversionOptimisationConfig;
}): Record<string, unknown> {
  return {
    ...args.sourceSnapshot,
    bookingConversionOptimised: args.bookingOptimised,
    conversionEventName: args.conversionConfig.eventName,
    metaPixelId: args.bookingOptimised ? args.conversionConfig.pixelId : null,
  };
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
  const audienceMode = validateAudienceMode(meta.audienceMode);

  if (meta.budgetAmount <= 0) {
    throw new Error('Budget must be greater than 0.');
  }

  if (audienceMode === 'local_interests' && normaliseResolvedInterests(meta.resolvedInterests ?? []).length === 0) {
    throw new Error('No Meta interests were resolved. Switch Audience to Local only and regenerate before publishing.');
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
  validateAudienceMode(input.audienceMode);

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
        audienceMode: input.audienceMode,
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
        audience_mode: input.audienceMode,
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
      audienceMode: input.audienceMode,
    },
  };
}

function buildInterestResolutionWarning(args: {
  audienceMode: AudienceMode;
  keywords: string[];
  resolvedInterests: ResolvedMetaInterest[];
  hadLookupError: boolean;
}): string | null {
  if (args.audienceMode !== 'local_interests') return null;
  if (args.resolvedInterests.length > 0) return null;

  if (args.keywords.length === 0) {
    return 'No audience keywords were generated. Switch Audience to Local only and regenerate before publishing.';
  }

  if (args.hadLookupError) {
    return 'Meta interest lookup failed. Switch Audience to Local only and regenerate before publishing.';
  }

  return 'No Meta interests matched the generated audience keywords. Switch Audience to Local only and regenerate before publishing.';
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
    .select('setup_complete, meta_account_id, access_token, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled')
    .eq('account_id', accountId)
    .maybeSingle<{
      setup_complete: boolean;
      meta_account_id: string;
      access_token: string | null;
      meta_pixel_id?: string | null;
      conversion_event_name?: string | null;
      conversion_optimisation_enabled?: boolean | null;
    }>();

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
    const audienceMode = validateAudienceMode(input.audienceMode);
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
    const conversionConfig = buildConversionOptimisationConfig(adAccount);
    const ruledPayload = applyDeterministicPaidRules(rawPayload, {
      campaignKind: input.campaignKind,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot: destination.sourceSnapshot,
      conversionConfig,
    });

    const interestResolution = audienceMode === 'local_interests' && adAccount.access_token
      ? await resolveMetaInterestsForKeywords(
          adAccount.access_token,
          normaliseAudienceKeywords(rawPayload.audience_keywords),
          searchMetaInterests,
        )
      : {
          keywords: normaliseAudienceKeywords(rawPayload.audience_keywords),
          resolvedInterests: [],
          unresolvedKeywords: [],
          hadLookupError: audienceMode === 'local_interests' && !adAccount.access_token,
        };
    const interestResolutionWarning = buildInterestResolutionWarning({
      audienceMode,
      keywords: interestResolution.keywords,
      resolvedInterests: interestResolution.resolvedInterests,
      hadLookupError: interestResolution.hadLookupError,
    });
    const payload = applyDeterministicCampaignNames({
      ...ruledPayload.payload,
      ad_sets: ruledPayload.payload.ad_sets.map((as, i) =>
        input.campaignKind === 'event' && i === ruledPayload.payload.ad_sets.length - 1
          ? { ...as, ads_stop_time: input.adsStopTime }
          : as,
      ),
    }, {
      audienceMode,
      geoRadiusMiles: input.geoRadiusMiles,
      resolvedInterests: interestResolution.resolvedInterests,
    });
    const sourceSnapshot = {
      ...buildConversionSourceSnapshot({
        sourceSnapshot: destination.sourceSnapshot,
        bookingOptimised: ruledPayload.bookingOptimised,
        conversionConfig,
      }),
      audienceMode,
      audienceInterestKeywords: interestResolution.keywords,
      resolvedInterests: interestResolution.resolvedInterests,
      interestResolutionWarning,
    };

    return {
      payload,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot,
      audienceInterestKeywords: interestResolution.keywords,
      resolvedInterests: interestResolution.resolvedInterests,
      interestResolutionWarning,
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
    const audienceMode = validateAudienceMode(meta.audienceMode);
    const audienceInterestKeywords = normaliseAudienceKeywords(meta.audienceInterestKeywords ?? []);
    const resolvedInterests = normaliseResolvedInterests(meta.resolvedInterests ?? []);
    const conversionConfig = await getConversionOptimisationConfig(supabase, accountId);
    const ruledPayload = applyDeterministicPaidRules(payload, {
      campaignKind: meta.campaignKind,
      destinationUrl: meta.destinationUrl,
      sourceSnapshot: meta.sourceSnapshot,
      conversionConfig,
    });
    const namedPayload = applyDeterministicCampaignNames(ruledPayload.payload, {
      audienceMode,
      geoRadiusMiles: meta.geoRadiusMiles,
      resolvedInterests,
    });
    const { data: campaignRow, error: campaignError } = await supabase
      .from('meta_campaigns')
      .insert({
        account_id: accountId,
        name: namedPayload.campaign_name,
        objective: namedPayload.objective,
        problem_brief: meta.problemBrief,
        ai_rationale: namedPayload.rationale,
        budget_type: meta.budgetType,
        budget_amount: meta.budgetAmount,
        geo_radius_miles: meta.geoRadiusMiles,
        audience_mode: audienceMode,
        audience_interest_keywords: audienceInterestKeywords,
        resolved_interests: resolvedInterests,
        start_date: meta.startDate,
        end_date: meta.endDate,
        status: 'DRAFT',
        special_ad_category: namedPayload.special_ad_category,
        campaign_kind: meta.campaignKind,
        source_type: meta.sourceType ?? null,
        source_id: meta.sourceId ?? null,
        destination_url: meta.destinationUrl,
        source_snapshot: {
          ...buildConversionSourceSnapshot({
            sourceSnapshot: meta.sourceSnapshot ?? {},
            bookingOptimised: ruledPayload.bookingOptimised,
            conversionConfig,
          }),
          audienceMode,
          audienceInterestKeywords,
          resolvedInterests,
        },
      })
      .select('id')
      .single<{ id: string }>();

    if (campaignError) return { error: campaignError.message };
    if (!campaignRow) return { error: 'Campaign insert returned no data' };

    const campaignId = campaignRow.id;

    // Insert ad_sets and their ads
    for (const adSetInput of namedPayload.ad_sets) {
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

export async function getCampaignOptimisationActions(campaignId: string): Promise<OptimisationActionSummary[]> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from('meta_optimisation_actions')
    .select('id, run_id, campaign_id, adset_id, ad_id, action_type, reason, status, error, metrics_snapshot, applied_at, created_at, meta_campaigns(name), ad_sets(name), ads(name)')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []).map((row) => dbRowToOptimisationActionSummary(row as OptimisationActionDbRow));
}

// ---------------------------------------------------------------------------
// getCampaignDashboard
// ---------------------------------------------------------------------------

export async function getCampaignDashboard(): Promise<CampaignDashboardModel> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const [{ data: campaignsData, error: campaignsError }, { data: actionsData, error: actionsError }] =
    await Promise.all([
      supabase
        .from('meta_campaigns')
        .select('*, ad_sets ( *, ads (*) )')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase
        .from('meta_optimisation_actions')
        .select('id, run_id, campaign_id, adset_id, ad_id, action_type, reason, status, error, metrics_snapshot, applied_at, created_at, meta_campaigns(name), ad_sets(name), ads(name)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  if (campaignsError) throw campaignsError;
  if (actionsError) throw actionsError;

  const campaigns = (campaignsData ?? []).map((row) => dbRowToCampaignWithTree(row as CampaignDbRowWithTree));
  const actions = (actionsData ?? []).map((row) => dbRowToOptimisationActionSummary(row as OptimisationActionDbRow));

  return buildCampaignDashboard(campaigns, actions);
}

export async function syncCampaignDashboardPerformance(): Promise<{ success: true; synced: number; failed: number } | { error: string; synced: number; failed: number }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: campaigns, error } = await supabase
    .from('meta_campaigns')
    .select('id')
    .eq('account_id', accountId)
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  if (error) {
    return { error: error.message, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const campaign of campaigns ?? []) {
    try {
      await syncMetaCampaignPerformance(campaign.id, { accountId, supabase });
      synced++;
    } catch (syncError) {
      failed++;
      console.error('[syncCampaignDashboardPerformance] Failed to sync campaign:', campaign.id, syncError);
    }
  }

  revalidatePath('/campaigns');

  if (failed > 0) {
    return { error: `${failed} campaign${failed === 1 ? '' : 's'} failed to sync.`, synced, failed };
  }

  return { success: true, synced, failed };
}

export async function runCampaignDashboardOptimisation(
  modeOrFormData: 'apply' | 'dry_run' | FormData = 'apply',
): Promise<
  | { success: true; evaluatedAdSets: number; plannedActions: number; appliedActions: number; failedActions: number }
  | { error: string }
> {
  try {
    const { accountId } = await requireAuthContext();
    const mode = modeOrFormData === 'dry_run' ? 'dry_run' : 'apply';
    const result = await runMetaCampaignOptimisation({ accountId, mode });

    revalidatePath('/campaigns');
    return {
      success: true,
      evaluatedAdSets: result.evaluatedAdSets,
      plannedActions: result.plannedActions,
      appliedActions: result.appliedActions,
      failedActions: result.failedActions,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
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
  audience_mode: string | null;
  audience_interest_keywords: string[] | null;
  resolved_interests: unknown;
  source_snapshot: Record<string, unknown> | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | null;
  metrics_reach: number | null;
  metrics_clicks: number | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions: number | string | null;
  metrics_cost_per_conversion: number | string | null;
  metrics_conversion_rate: number | string | null;
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
  meta_status: string | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | null;
  metrics_reach: number | null;
  metrics_clicks: number | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions: number | string | null;
  metrics_cost_per_conversion: number | string | null;
  metrics_conversion_rate: number | string | null;
  last_synced_at: string | null;
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
  meta_status: string | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | null;
  metrics_reach: number | null;
  metrics_clicks: number | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions: number | string | null;
  metrics_cost_per_conversion: number | string | null;
  metrics_conversion_rate: number | string | null;
  last_synced_at: string | null;
  status: string;
  created_at: string;
  ads?: AdDbRow[];
}

interface CampaignDbRowWithTree extends CampaignDbRow {
  ad_sets?: AdSetDbRow[];
}

interface OptimisationActionDbRow {
  id: string;
  run_id: string;
  campaign_id: string;
  adset_id: string | null;
  ad_id: string | null;
  action_type: string;
  reason: string;
  status: string;
  error: string | null;
  metrics_snapshot: Record<string, unknown> | null;
  applied_at: string | null;
  created_at: string;
  meta_campaigns?: { name?: string | null } | Array<{ name?: string | null }> | null;
  ad_sets?: { name?: string | null } | Array<{ name?: string | null }> | null;
  ads?: { name?: string | null } | Array<{ name?: string | null }> | null;
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
    metaStatus: row.meta_status,
    performance: dbRowToPerformance(row),
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
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
    metaStatus: row.meta_status,
    performance: dbRowToPerformance(row),
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
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
    audienceMode: row.audience_mode ? validateAudienceMode(row.audience_mode) : 'local_only',
    audienceInterestKeywords: normaliseAudienceKeywords(row.audience_interest_keywords ?? []),
    resolvedInterests: normaliseResolvedInterests(row.resolved_interests),
    sourceSnapshot: row.source_snapshot ?? null,
    performance: dbRowToPerformance(row),
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function dbRowToPerformance(row: {
  metrics_spend: number | string | null;
  metrics_impressions: number | null;
  metrics_reach: number | null;
  metrics_clicks: number | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions?: number | string | null;
  metrics_cost_per_conversion?: number | string | null;
  metrics_conversion_rate?: number | string | null;
}): CampaignPerformanceMetrics {
  return {
    spend: Number(row.metrics_spend ?? 0),
    impressions: Number(row.metrics_impressions ?? 0),
    reach: Number(row.metrics_reach ?? 0),
    clicks: Number(row.metrics_clicks ?? 0),
    ctr: Number(row.metrics_ctr ?? 0),
    cpc: Number(row.metrics_cpc ?? 0),
    conversions: Number(row.metrics_conversions ?? 0),
    costPerConversion: Number(row.metrics_cost_per_conversion ?? 0),
    conversionRate: Number(row.metrics_conversion_rate ?? 0),
  };
}

function dbRowToCampaignWithTree(row: CampaignDbRowWithTree): Campaign {
  const campaign = dbRowToCampaign(row);
  campaign.adSets = row.ad_sets?.map(dbRowToAdSet);
  return campaign;
}

function dbRowToOptimisationActionSummary(row: OptimisationActionDbRow): OptimisationActionSummary {
  return {
    id: row.id,
    runId: row.run_id,
    campaignId: row.campaign_id,
    campaignName: nestedName(row.meta_campaigns),
    adSetId: row.adset_id,
    adSetName: nestedName(row.ad_sets),
    adId: row.ad_id,
    adName: nestedName(row.ads),
    actionType: row.action_type as OptimisationActionSummary['actionType'],
    reason: row.reason,
    status: row.status as OptimisationActionSummary['status'],
    error: row.error,
    metricsSnapshot: row.metrics_snapshot ?? {},
    appliedAt: row.applied_at ? new Date(row.applied_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function nestedName(value: OptimisationActionDbRow['meta_campaigns']): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate?.name === 'string' ? candidate.name : null;
}
