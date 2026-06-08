'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAuthContext } from '@/lib/auth/server';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { featureFlags } from '@/env';
import { MEDIA_BUCKET } from '@/lib/constants';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import type { CampaignPhase } from '@/lib/campaigns/phases';
import { buildCampaignDashboard, type CampaignDashboardModel } from '@/lib/campaigns/dashboard';
import {
  EMPTY_EVENT_BOOKING_INSIGHTS,
  fetchEventBookingInsights,
  formatEventBookingInsightsForCampaignPrompt,
} from '@/lib/campaigns/event-booking-insights';
import { generateCampaign } from '@/lib/campaigns/generate';
import { applyDeterministicCampaignNames } from '@/lib/campaigns/naming';
import {
  buildAdUtmContentKey,
  buildCreativeVariantKey,
  normaliseCreativeFormat,
} from '@/lib/campaigns/ad-attribution';
import {
  buildAudienceStrategy,
  buildCampaignQualitySnapshot,
} from '@/lib/campaigns/quality-score';
import {
  collectManagementMetaAdVariantsFromPayload,
  ensureManagementMetaAdVariantLinks,
} from '@/lib/campaigns/management-tracking';
import { buildEventMediaPlan } from '@/lib/campaigns/media-plan';
import {
  calculateEvergreenPhases,
  calculateInclusiveDurationDays,
  calculatePhases,
} from '@/lib/campaigns/phases';
import {
  buildConversionReadiness,
  type ConversionReadiness,
} from '@/lib/campaigns/conversion-readiness';
import {
  normaliseAudienceKeywords,
  normaliseResolvedInterests,
  resolveMetaInterestsForKeywords,
} from '@/lib/campaigns/interest-targeting';
import {
  createMetaAd,
  createMetaAdCreative,
  searchMetaInterests,
  uploadMetaImage,
} from '@/lib/meta/marketing';
import {
  createManagementMetaAdsLink,
  ManagementApiError,
  type ManagementMetaAdsLink,
} from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import {
  buildBlendedBookingSignals,
  runMetaCampaignOptimisation,
  type BookingConversionEventForOptimisation,
  type OptimisationCampaignRow,
} from '@/lib/campaigns/optimisation';
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
  FoodAdWindow,
  FoodBookingBrief,
  FoodServiceHours,
  RunDay,
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
const TRACKABLE_BOOKING_HOSTS = new Set(['the-anchor.pub', 'www.the-anchor.pub']);
const TRACKABLE_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'vip-club.uk', 'www.vip-club.uk']);
const ATTRIBUTION_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'short_code',
] as const;

type ConversionOptimisationConfig = ConversionReadiness;
type CampaignEffectivenessConfig = ConversionReadiness & { capiReady: boolean };

interface ConversionRuleResult {
  payload: AiCampaignPayload;
  bookingOptimised: boolean;
}

const OPTIMISATION_ACTION_SELECT =
  'id, run_id, campaign_id, adset_id, ad_id, action_type, reason, status, severity, error, metrics_snapshot, recommendation_payload, replacement_ad_id, applied_at, created_at, meta_campaigns(name,status,meta_status,end_date), ad_sets(name), ads:ads!meta_optimisation_actions_ad_id_fkey(name)';
const LEGACY_OPTIMISATION_ACTION_SELECT =
  'id, run_id, campaign_id, adset_id, ad_id, action_type, reason, status, error, metrics_snapshot, applied_at, created_at, meta_campaigns(name,status,meta_status,end_date), ad_sets(name), ads:ads!meta_optimisation_actions_ad_id_fkey(name)';

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
  conversions_api_access_token?: string | null;
} | null | undefined): CampaignEffectivenessConfig {
  const readiness = buildConversionReadiness(row);
  return {
    ...readiness,
    capiReady: Boolean(row?.conversions_api_access_token?.trim()),
  };
}

async function getConversionOptimisationConfig(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
): Promise<CampaignEffectivenessConfig> {
  const { data, error } = await supabase
    .from('meta_ad_accounts')
    .select('meta_pixel_id, conversion_event_name, conversion_optimisation_enabled, conversions_api_access_token')
    .eq('account_id', accountId)
    .maybeSingle<{
      meta_pixel_id: string | null;
      conversion_event_name: string | null;
      conversion_optimisation_enabled: boolean | null;
      conversions_api_access_token?: string | null;
    }>();

  if (error) throw error;
  return buildConversionOptimisationConfig(data);
}

function applyCampaignEffectivenessMetadata(payload: AiCampaignPayload): AiCampaignPayload {
  return {
    ...payload,
    ad_sets: payload.ad_sets.map((adSet) => ({
      ...adSet,
      ads: adSet.ads.map((ad, index) => {
        const creativeFormat = normaliseCreativeFormat(ad.creative_format, index);
        const creativeVariantKey = ad.creative_variant_key?.trim() || buildCreativeVariantKey({
          campaignName: payload.campaign_name,
          adSetName: adSet.name,
          adName: ad.name,
          angle: ad.angle,
          creativeFormat,
        });
        const utmContentKey = ad.utm_content_key?.trim() || buildAdUtmContentKey({
          campaignName: payload.campaign_name,
          adSetName: adSet.name,
          adName: ad.name,
          angle: ad.angle,
          creativeFormat,
        });

        return {
          ...ad,
          creative_format: creativeFormat,
          creative_variant_key: creativeVariantKey,
          utm_content_key: utmContentKey,
        };
      }),
    })),
  };
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
      objective: bookingOptimised ? 'OUTCOME_SALES' : 'OUTCOME_TRAFFIC',
      ad_sets: payload.ad_sets.map((adSet) => ({
        ...adSet,
        optimisation_goal: bookingOptimised ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
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
    args.conversionConfig.ready &&
      isTrackableBookingDestination(args.campaignKind, args.destinationUrl, args.sourceSnapshot),
  );
}

function isTrackableBookingDestination(
  campaignKind: PaidCampaignKind,
  destinationUrl: string,
  sourceSnapshot?: Record<string, unknown> | null,
): boolean {
  if (campaignKind === 'event') return true;
  if (typeof sourceSnapshot?.shortCode === 'string' && sourceSnapshot.shortCode.trim()) return true;

  const candidateUrls = [
    destinationUrl,
    sourceSnapshot?.originalDestinationUrl,
    sourceSnapshot?.utmDestinationUrl,
    sourceSnapshot?.paidCtaUrl,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return candidateUrls.some((candidate) => {
    try {
      const hostname = new URL(candidate).hostname.toLowerCase();
      return TRACKABLE_BOOKING_HOSTS.has(hostname) || TRACKABLE_SHORT_LINK_HOSTS.has(hostname);
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
    bookingConversionReady: args.conversionConfig.ready,
    bookingConversionIssues: args.conversionConfig.issues,
    conversionEventName: args.conversionConfig.eventName,
    metaPixelId: args.bookingOptimised ? args.conversionConfig.pixelId : null,
  };
}

async function getEventBookingInsightsForGeneration(
  accountId: string,
  supabase: ReturnType<typeof createServiceSupabaseClient>,
) {
  try {
    return await fetchEventBookingInsights(accountId, { supabase });
  } catch (error) {
    console.error('[campaigns] Failed to load event booking insights for generation', error);
    return EMPTY_EVENT_BOOKING_INSIGHTS;
  }
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

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isTrustedShortLink(parsed: URL): boolean {
  return TRACKABLE_SHORT_LINK_HOSTS.has(parsed.hostname.toLowerCase());
}

function isAnchorUrlWithAttribution(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (!TRACKABLE_BOOKING_HOSTS.has(hostname)) return false;
  return ATTRIBUTION_QUERY_KEYS.some((key) => Boolean(parsed.searchParams.get(key)));
}

function candidateUrlHasPaidAttribution(value: unknown): boolean {
  const candidate = stringValue(value);
  if (!candidate) return false;

  try {
    const parsed = new URL(candidate);
    return isTrustedShortLink(parsed) || isAnchorUrlWithAttribution(parsed);
  } catch {
    return false;
  }
}

function sourceSnapshotHasPaidAttribution(sourceSnapshot?: Record<string, unknown> | null): boolean {
  if (!sourceSnapshot) return false;
  if (stringValue(sourceSnapshot.shortCode)) return true;

  return [
    sourceSnapshot.paidCtaUrl,
    sourceSnapshot.utmDestinationUrl,
    sourceSnapshot.metaAdsShortLink,
    sourceSnapshot.metaAdsDestinationUrl,
  ].some(candidateUrlHasPaidAttribution);
}

function validatePaidDestinationAttribution(
  destinationUrl: string,
  sourceSnapshot?: Record<string, unknown> | null,
): void {
  let parsed: URL;
  try {
    parsed = new URL(destinationUrl);
  } catch {
    throw new Error('Enter a valid paid CTA URL before generating the campaign.');
  }

  if (isTrustedShortLink(parsed)) return;
  if (isAnchorUrlWithAttribution(parsed)) return;
  if (sourceSnapshotHasPaidAttribution(sourceSnapshot)) return;

  throw new Error('Paid CTA URL must be a trusted Meta short link or an Anchor URL with campaign attribution.');
}

function validatePaidCampaignMeta(meta: SaveCampaignMeta): void {
  const destinationUrl = validateDestinationUrl(meta.destinationUrl);
  validatePaidDestinationAttribution(destinationUrl, meta.sourceSnapshot);
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

    const destinationUrl = validateDestinationUrl(input.destinationUrl);
    validatePaidDestinationAttribution(destinationUrl, input.sourceSnapshot);

    return {
      destinationUrl,
      sourceSnapshot: {
        ...(input.sourceSnapshot ?? {}),
        campaignKind: 'event',
        sourceType: input.sourceType ?? 'management_event',
        sourceId: input.sourceId ?? null,
        paidCtaUrl: destinationUrl,
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
      .select('setup_complete, meta_account_id, access_token, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled, conversions_api_access_token')
    .eq('account_id', accountId)
    .maybeSingle<{
      setup_complete: boolean;
      meta_account_id: string;
      access_token: string | null;
      meta_pixel_id?: string | null;
      conversion_event_name?: string | null;
      conversion_optimisation_enabled?: boolean | null;
      conversions_api_access_token?: string | null;
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
    const mediaPlan = input.campaignKind === 'event'
      ? buildEventMediaPlan({
          startDate: input.startDate,
          eventDate: input.endDate,
          adsStopTime: input.adsStopTime ?? '',
          budgetAmount: input.budgetAmount,
          budgetType: input.budgetType,
        })
      : null;
    const phases = mediaPlan?.executionPhases ?? calculateEvergreenPhases(input.startDate, input.endDate);

    const eventBookingInsights = input.campaignKind === 'event'
      ? await getEventBookingInsightsForGeneration(accountId, supabase)
      : EMPTY_EVENT_BOOKING_INSIGHTS;

    const rawPayload = await generateCampaign({
      campaignKind: input.campaignKind,
      promotionName: input.promotionName,
      problemBrief: input.problemBrief,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot: destination.sourceSnapshot,
      venueName,
      venueLocation,
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      phases,
      mediaPlan,
      eventBookingInsights: input.campaignKind === 'event'
        ? formatEventBookingInsightsForCampaignPrompt(eventBookingInsights)
        : null,
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
    const payload = applyCampaignEffectivenessMetadata(applyDeterministicCampaignNames({
      ...ruledPayload.payload,
      media_plan: mediaPlan ?? ruledPayload.payload.media_plan,
      ad_sets: ruledPayload.payload.ad_sets.map((as, i) =>
        input.campaignKind === 'event' && i === ruledPayload.payload.ad_sets.length - 1
          ? { ...as, ads_stop_time: input.adsStopTime }
          : as,
      ),
    }, {
      audienceMode,
      geoRadiusMiles: input.geoRadiusMiles,
      resolvedInterests: interestResolution.resolvedInterests,
    }));
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
      ...(mediaPlan ? { mediaPlan } : {}),
    };
    const trackedSourceSnapshot = await ensureManagementMetaAdVariantLinks({
      campaignKind: input.campaignKind,
      campaignName: payload.campaign_name,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot,
      variants: collectManagementMetaAdVariantsFromPayload(payload),
    });

    return {
      payload,
      destinationUrl: destination.destinationUrl,
      sourceSnapshot: trackedSourceSnapshot,
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
    const namedPayload = applyCampaignEffectivenessMetadata(applyDeterministicCampaignNames(ruledPayload.payload, {
      audienceMode,
      geoRadiusMiles: meta.geoRadiusMiles,
      resolvedInterests,
    }));
    const qualitySnapshot = buildCampaignQualitySnapshot({
      campaignKind: meta.campaignKind,
      destinationUrl: meta.destinationUrl,
      budgetAmount: meta.budgetAmount,
      budgetType: meta.budgetType,
      audienceMode,
      conversionReady: conversionConfig.ready,
      capiReady: conversionConfig.capiReady,
      adSets: namedPayload.ad_sets,
    });
    const audienceStrategy = buildAudienceStrategy({
      audienceMode,
      geoRadiusMiles: meta.geoRadiusMiles,
      resolvedInterestCount: resolvedInterests.length,
      campaignKind: meta.campaignKind,
      phases: namedPayload.ad_sets,
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
        quality_score: qualitySnapshot.score,
        quality_status: qualitySnapshot.status,
        quality_issues: qualitySnapshot.issues,
        audience_strategy: audienceStrategy,
        source_snapshot: {
          ...buildConversionSourceSnapshot({
            sourceSnapshot: meta.sourceSnapshot ?? {},
            bookingOptimised: ruledPayload.bookingOptimised,
            conversionConfig,
          }),
          ...(namedPayload.media_plan ? { mediaPlan: namedPayload.media_plan } : {}),
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
          creative_format: adInput.creative_format ?? null,
          creative_variant_key: adInput.creative_variant_key ?? null,
          utm_content_key: adInput.utm_content_key ?? null,
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
// createFoodBookingCampaign
// ---------------------------------------------------------------------------

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const RUN_DAYS: readonly RunDay[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const foodServiceHoursSchema = z.object({
  serviceKey: z.enum(['weekday_dinner', 'saturday_food', 'sunday_roast']),
  enabled: z.boolean(),
  days: z.array(z.enum(RUN_DAYS as [RunDay, ...RunDay[]])),
  startLocal: z.string().regex(HHMM_REGEX, 'Service start must be HH:MM.'),
  endLocal: z.string().regex(HHMM_REGEX, 'Service end must be HH:MM.'),
  lastOrdersLocal: z.string().regex(HHMM_REGEX, 'Last orders must be HH:MM.').optional(),
}) satisfies z.ZodType<FoodServiceHours>;

const foodBookingBriefSchema = z.object({
  services: z.array(foodServiceHoursSchema).min(1, 'Add at least one food service.'),
  bookingUrl: z.string().url('Enter a valid booking URL.'),
  foodHooks: z.array(z.string()),
  weeks: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  dayWeighting: z.enum(['even', 'boost_quiet', 'manual']),
  manualDayWeights: z.record(z.enum(RUN_DAYS as [RunDay, ...RunDay[]]), z.number()).optional(),
}) satisfies z.ZodType<FoodBookingBrief>;

interface CreateFoodBookingCampaignInput {
  promotionName: string;
  problemBrief: string;
  brief: FoodBookingBrief;
  budgetAmount: number;
  budgetType: BudgetType;
  geoRadiusMiles: GeoRadiusMiles;
  audienceMode: AudienceMode;
  startDate: string;
  // Per-window pre-publish toggles keyed by FoodAdWindow.windowKey (D8). Overrides the
  // template default `enabled`: an entry of true switches a default-off rescue window on,
  // false switches a default-on window off. Windows without an entry keep their default.
  windowOverrides?: Record<string, boolean>;
}

/** Map a scheduled food window to the CampaignPhase shape generateCampaign expects. */
function foodWindowToPhase(window: FoodAdWindow): CampaignPhase {
  return {
    phaseType: 'booking-push',
    phaseLabel: window.windowKey,
    phaseStart: window.runDate,
    phaseEnd: null,
    adsStopTime: window.endsAtLocal,
  };
}

/**
 * Creates a food_booking DRAFT campaign from a FoodBookingBrief: derive the London-local
 * ad windows, generate per-window booking copy, and persist one ad set per ENABLED window
 * with its intra-day start/stop, service metadata, and a stable utm_content key (the window
 * key) for Phase-2 attribution. Budget lives on the campaign (CBO) and is applied at publish.
 */
export async function createFoodBookingCampaign(
  input: CreateFoodBookingCampaignInput,
): Promise<{ campaignId: string } | { error: string }> {
  if (!featureFlags.foodBooking) {
    return { error: 'Food booking campaigns are not enabled.' };
  }

  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  try {
    const brief = foodBookingBriefSchema.parse(input.brief);
    validateGeoRadiusMiles(input.geoRadiusMiles);
    const audienceMode = validateAudienceMode(input.audienceMode);
    if (input.budgetAmount <= 0) {
      throw new Error('Budget must be greater than 0.');
    }

    const destinationUrl = validateDestinationUrl(brief.bookingUrl);

    // 1. Verify Meta Ads account is connected and conversion tracking is ready.
    const { data: adAccount } = await supabase
      .from('meta_ad_accounts')
      .select('setup_complete, meta_account_id, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled')
      .eq('account_id', accountId)
      .maybeSingle<{
        setup_complete: boolean;
        meta_account_id: string;
        meta_pixel_id?: string | null;
        conversion_event_name?: string | null;
        conversion_optimisation_enabled?: boolean | null;
      }>();

    if (!adAccount?.setup_complete) {
      return {
        error:
          'Meta Ads account not connected. Please complete the Meta Ads setup in Connections before creating a campaign.',
      };
    }

    // 2. Venue context for AI copy.
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

    // 3. Derive windows, apply any per-window pre-publish toggles, then keep only the
    //    enabled ones (one Meta ad set per window).
    const allWindows = calculateFoodBookingPhases(brief, input.startDate);
    const enabledWindows = allWindows.filter(
      (window) => input.windowOverrides?.[window.windowKey] ?? window.enabled,
    );
    if (enabledWindows.length === 0) {
      return { error: 'No ad windows are enabled for the selected services and dates.' };
    }

    const lastWindow = enabledWindows[enabledWindows.length - 1]!;
    const endDate = lastWindow.runDate;
    const phases = enabledWindows.map(foodWindowToPhase);
    const foodHooks = brief.foodHooks.map((hook) => hook.trim()).filter(Boolean);

    // 4. Generate per-window booking copy (forces BOOK_NOW + validates per window).
    const rawPayload = await generateCampaign({
      campaignKind: 'food_booking',
      promotionName: input.promotionName,
      problemBrief: input.problemBrief,
      destinationUrl,
      sourceSnapshot: { campaignKind: 'food_booking', bookingUrl: brief.bookingUrl },
      venueName,
      venueLocation,
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      phases,
      foodWindows: enabledWindows,
      foodHooks,
      // CR-3: pass the brief's service hours so copy reflects the venue's real service and
      // last-orders times rather than the default schedule.
      foodServices: brief.services,
    });

    // Ad sets are parallel to enabled windows. Attach each window's stable key to its ads
    // as the utm_content key so Phase-2 attribution segments cleanly per window.
    const payload = applyCampaignEffectivenessMetadata(applyDeterministicCampaignNames(rawPayload, {
      audienceMode,
      geoRadiusMiles: input.geoRadiusMiles,
      resolvedInterests: [],
    }));

    const conversionConfig = await getConversionOptimisationConfig(supabase, accountId);
    const sourceSnapshot: Record<string, unknown> = {
      campaignKind: 'food_booking',
      bookingUrl: brief.bookingUrl,
      bookingConversionOptimised: true,
      bookingConversionReady: conversionConfig.ready,
      bookingConversionIssues: conversionConfig.issues,
      conversionEventName: conversionConfig.eventName,
      metaPixelId: conversionConfig.pixelId,
      foodSchedule: enabledWindows,
      geoRadiusMiles: input.geoRadiusMiles,
      audienceMode,
    };

    const qualitySnapshot = buildCampaignQualitySnapshot({
      campaignKind: 'food_booking',
      destinationUrl,
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      audienceMode,
      conversionReady: conversionConfig.ready,
      capiReady: conversionConfig.capiReady,
      adSets: payload.ad_sets,
    });
    const audienceStrategy = buildAudienceStrategy({
      audienceMode,
      geoRadiusMiles: input.geoRadiusMiles,
      resolvedInterestCount: 0,
      campaignKind: 'food_booking',
      phases: payload.ad_sets,
    });

    // 5. Persist campaign.
    const { data: campaignRow, error: campaignError } = await supabase
      .from('meta_campaigns')
      .insert({
        account_id: accountId,
        name: payload.campaign_name,
        objective: payload.objective,
        problem_brief: input.problemBrief,
        ai_rationale: payload.rationale,
        budget_type: input.budgetType,
        budget_amount: input.budgetAmount,
        geo_radius_miles: input.geoRadiusMiles,
        audience_mode: audienceMode,
        audience_interest_keywords: [],
        resolved_interests: [],
        start_date: input.startDate,
        end_date: endDate,
        status: 'DRAFT',
        special_ad_category: payload.special_ad_category,
        campaign_kind: 'food_booking',
        source_type: 'food_booking',
        source_id: null,
        destination_url: destinationUrl,
        quality_score: qualitySnapshot.score,
        quality_status: qualitySnapshot.status,
        quality_issues: qualitySnapshot.issues,
        audience_strategy: audienceStrategy,
        source_snapshot: sourceSnapshot,
      })
      .select('id')
      .single<{ id: string }>();

    if (campaignError) return { error: campaignError.message };
    if (!campaignRow) return { error: 'Campaign insert returned no data' };

    const campaignId = campaignRow.id;

    // 6. Persist one ad set per enabled window, mapping food fields and the window key.
    for (let index = 0; index < enabledWindows.length; index++) {
      const window = enabledWindows[index]!;
      const adSetInput = payload.ad_sets[index]!;

      const { data: adSetRow, error: adSetError } = await supabase
        .from('ad_sets')
        .insert({
          campaign_id: campaignId,
          name: adSetInput.name,
          phase_start: window.runDate,
          phase_end: window.runDate,
          ads_start_time: window.startsAtLocal,
          ads_stop_time: window.endsAtLocal,
          service_key: window.serviceKey,
          decision_stage: window.decisionStage,
          budget_weight: window.budgetWeight,
          targeting: adSetInput.targeting,
          placements: adSetInput.placements,
          optimisation_goal: adSetInput.optimisation_goal,
          bid_strategy: adSetInput.bid_strategy,
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
          creative_format: adInput.creative_format ?? null,
          creative_variant_key: adInput.creative_variant_key ?? null,
          // Phase-2 attribution: utm_content must be unique per ad campaign-wide (publish
          // preflight rejects duplicates). The same windowKey repeats across run-dates, so
          // we key by window + run-date. service_key/decision_stage stay on the ad set for
          // Phase-2 segmentation (utm_content → ad-set join).
          utm_content_key: `${window.windowKey}-${window.runDate}`,
          media_asset_id: adInput.media_asset_id ?? null,
          status: 'DRAFT',
        });

        if (adError) return { error: adError.message };
      }
    }

    revalidatePath('/campaigns');
    return { campaignId };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: err.issues[0]?.message ?? 'Invalid food booking brief.' };
    }
    const message = err instanceof Error ? err.message : 'Failed to create food booking campaign.';
    return { error: message };
  }
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

  return fetchOptimisationActionSummaries(supabase, accountId, { campaignId });
}

// ---------------------------------------------------------------------------
// getCampaignDashboard
// ---------------------------------------------------------------------------

export async function getCampaignDashboard(): Promise<CampaignDashboardModel> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const [{ data: campaignsData, error: campaignsError }, actions, eventBookingInsights] =
    await Promise.all([
      supabase
        .from('meta_campaigns')
        .select('*, ad_sets ( *, ads (*) )')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      fetchOptimisationActionSummaries(supabase, accountId),
      fetchEventBookingInsights(accountId, { supabase }).catch((error) => {
        console.error('[campaigns] Failed to load event booking insights', error);
        return EMPTY_EVENT_BOOKING_INSIGHTS;
      }),
    ]);

  if (campaignsError) throw campaignsError;

  const campaigns = (campaignsData ?? []).map((row) => dbRowToCampaignWithTree(row as CampaignDbRowWithTree));
  const firstPartyBookingStats = await loadDashboardFirstPartyBookingStats(supabase, accountId, campaigns);

  return buildCampaignDashboard(campaigns, actions, eventBookingInsights, { firstPartyBookingStats });
}

async function loadDashboardFirstPartyBookingStats(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
  campaigns: Campaign[],
): Promise<Map<string, { bookings: number; value: number }>> {
  if (campaigns.length === 0) return new Map();

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('booking_conversion_events')
    .select('booking_id, booking_type, event_id, event_slug, utm_campaign, utm_content, fbclid, gclid, short_code, value, occurred_at')
    .eq('account_id', accountId)
    .gte('occurred_at', since);

  if (error) {
    console.error('[campaigns] Failed to load first-party booking conversions for dashboard', error);
    return new Map();
  }

  const optimisationRows = campaigns.map(campaignToOptimisationRow);
  const bookingEvents = ((data ?? []) as BookingConversionEventForOptimisation[])
    .filter((event) => typeof event.booking_id === 'string' && typeof event.occurred_at === 'string');
  const signals = buildBlendedBookingSignals(optimisationRows, bookingEvents);

  return new Map(Array.from(signals.entries()).map(([campaignId, signal]) => [
    campaignId,
    {
      bookings: signal.firstPartyBookings,
      value: signal.firstPartyBookingValue,
    },
  ]));
}

function campaignToOptimisationRow(campaign: Campaign): OptimisationCampaignRow {
  return {
    id: campaign.id,
    account_id: campaign.accountId,
    meta_campaign_id: campaign.metaCampaignId,
    name: campaign.name,
    problem_brief: campaign.problemBrief,
    destination_url: campaign.destinationUrl,
    source_type: campaign.sourceType,
    source_id: campaign.sourceId,
    source_snapshot: campaign.sourceSnapshot,
    campaign_kind: campaign.campaignKind,
    end_date: campaign.endDate,
    status: campaign.status,
    meta_status: campaign.metaStatus,
    metrics_spend: campaign.performance.spend,
    metrics_impressions: campaign.performance.impressions,
    metrics_clicks: campaign.performance.clicks,
    metrics_ctr: campaign.performance.ctr,
    metrics_cpc: campaign.performance.cpc,
    metrics_conversions: campaign.performance.metaConversions ?? campaign.performance.conversions,
    last_synced_at: campaign.lastSyncedAt?.toISOString() ?? null,
    ad_sets: [],
  };
}

async function fetchOptimisationActionSummaries(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
  options?: { campaignId?: string },
): Promise<OptimisationActionSummary[]> {
  const runQuery = (selectColumns: string) => {
    let query = supabase
      .from('meta_optimisation_actions')
      .select(selectColumns)
      .eq('account_id', accountId);

    if (options?.campaignId) {
      query = query.eq('campaign_id', options.campaignId);
    }

    return query
      .order('created_at', { ascending: false })
      .limit(20);
  };

  const { data, error } = await runQuery(OPTIMISATION_ACTION_SELECT);
  if (!error) {
    return (data ?? [])
      .map((row) => row as unknown as OptimisationActionDbRow)
      .filter((row) => !isOptimisationActionForFinishedCampaign(row))
      .map(dbRowToOptimisationActionSummary);
  }

  if (!isMissingOptimisationRecommendationSchemaError(error)) {
    throw error;
  }

  console.warn('[campaigns] Optimisation recommendation columns are missing; falling back to legacy action history.', error);
  const { data: legacyData, error: legacyError } = await runQuery(LEGACY_OPTIMISATION_ACTION_SELECT);
  if (legacyError) throw legacyError;
  return (legacyData ?? [])
    .map((row) => row as unknown as OptimisationActionDbRow)
    .filter((row) => !isOptimisationActionForFinishedCampaign(row))
    .map(dbRowToOptimisationActionSummary);
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
  modeOrFormData: 'recommend' | 'apply' | 'dry_run' | FormData = 'recommend',
): Promise<
  | { success: true; synced: number; syncFailed: number; evaluatedAdSets: number; plannedActions: number; appliedActions: number; failedActions: number }
  | { error: string }
> {
  try {
    const { accountId } = await requireAuthContext();
    const supabase = createServiceSupabaseClient();
    const syncResult = await syncCampaignDashboardPerformance();
    const mode = modeOrFormData === 'apply' || modeOrFormData === 'dry_run' ? modeOrFormData : 'recommend';
    const result = await runMetaCampaignOptimisation({ accountId, mode, supabase });

    revalidatePath('/campaigns');
    return {
      success: true,
      synced: syncResult.synced,
      syncFailed: syncResult.failed,
      evaluatedAdSets: result.evaluatedAdSets,
      plannedActions: result.plannedActions,
      appliedActions: result.appliedActions,
      failedActions: result.failedActions,
    };
  } catch (error) {
    if (isMissingOptimisationRecommendationSchemaError(error)) {
      return { error: 'Database migration missing: apply the conversion-first optimiser migration before running recommendations.' };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

interface RecommendationActionRow {
  id: string;
  campaign_id: string;
  adset_id: string | null;
  ad_id: string | null;
  action_type: string;
  status: string;
  recommendation_payload: Record<string, unknown> | null;
}

interface CopyProposal {
  name: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: CtaType;
  angle: string;
}

interface ApplyRecommendationAdRow {
  id: string;
  adset_id: string;
  meta_ad_id: string | null;
  name: string;
  status: string;
  media_asset_id: string | null;
}

interface ApplyRecommendationAdSetRow {
  id: string;
  campaign_id: string;
  meta_adset_id: string | null;
  adset_media_asset_id: string | null;
}

interface ApplyRecommendationCampaignRow {
  id: string;
  account_id: string;
  destination_url: string | null;
  campaign_kind: string | null;
}

interface ApplyRecommendationAdAccountRow {
  access_token: string | null;
  meta_account_id: string | null;
}

export async function applyOptimisationRecommendation(
  actionId: string,
): Promise<{ success: true; replacementAdId?: string } | { error: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: action, error: actionError } = await supabase
    .from('meta_optimisation_actions')
    .select('id, campaign_id, adset_id, ad_id, action_type, status, recommendation_payload')
    .eq('id', actionId)
    .eq('account_id', accountId)
    .maybeSingle<RecommendationActionRow>();

  if (isMissingOptimisationRecommendationSchemaError(actionError)) {
    return { error: 'Database migration missing: apply the conversion-first optimiser migration before approving recommendations.' };
  }
  if (actionError) return { error: actionError.message };
  if (!action) return { error: 'Optimisation recommendation not found.' };
  if (action.action_type !== 'copy_rewrite') return { error: 'Only copy rewrite recommendations can be approved.' };
  if (action.status !== 'planned') return { error: 'This recommendation has already been handled.' };
  if (!action.ad_id || !action.adset_id) return { error: 'Copy recommendation is missing its ad reference.' };

  const proposal = parseCopyProposal(action.recommendation_payload);
  if (!proposal) return { error: 'Copy recommendation is missing proposed copy.' };

  const [{ data: ad, error: adError }, { data: adSet, error: adSetError }, { data: campaign, error: campaignError }] =
    await Promise.all([
      supabase
        .from('ads')
        .select('id, adset_id, meta_ad_id, name, status, media_asset_id')
        .eq('id', action.ad_id)
        .maybeSingle<ApplyRecommendationAdRow>(),
      supabase
        .from('ad_sets')
        .select('id, campaign_id, meta_adset_id, adset_media_asset_id')
        .eq('id', action.adset_id)
        .maybeSingle<ApplyRecommendationAdSetRow>(),
      supabase
        .from('meta_campaigns')
        .select('id, account_id, destination_url, campaign_kind')
        .eq('id', action.campaign_id)
        .eq('account_id', accountId)
        .maybeSingle<ApplyRecommendationCampaignRow>(),
    ]);

  if (adError) return { error: adError.message };
  if (adSetError) return { error: adSetError.message };
  if (campaignError) return { error: campaignError.message };
  if (!ad || !adSet || !campaign) return { error: 'Could not load the ad, ad set, or campaign for this recommendation.' };

  if (!ad.meta_ad_id || ad.status !== 'ACTIVE' || !adSet.meta_adset_id) {
    const { error: updateError } = await supabase
      .from('ads')
      .update({
        headline: proposal.headline,
        primary_text: proposal.primaryText,
        description: proposal.description,
        cta: proposal.cta,
        angle: proposal.angle,
        name: proposal.name,
      })
      .eq('id', ad.id);

    if (updateError) return { error: updateError.message };

    await markRecommendationApplied(supabase, action.id, { replacementAdId: null });
    revalidatePath('/campaigns');
    revalidatePath(`/campaigns/${campaign.id}`);
    return { success: true };
  }

  if (!campaign.destination_url) {
    return failRecommendation(supabase, action.id, 'Campaign is missing its paid CTA URL.');
  }

  const { data: adAccount, error: adAccountError } = await supabase
    .from('meta_ad_accounts')
    .select('access_token, meta_account_id')
    .eq('account_id', accountId)
    .maybeSingle<ApplyRecommendationAdAccountRow>();

  if (adAccountError) return { error: adAccountError.message };
  if (!adAccount?.access_token || !adAccount.meta_account_id) {
    return failRecommendation(supabase, action.id, 'Meta Ads account is not connected.');
  }

  const { data: fbConnection, error: fbError } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', accountId)
    .eq('provider', 'facebook')
    .maybeSingle<{ metadata: { pageId?: string } | null }>();

  if (fbError) return { error: fbError.message };
  const pageId = fbConnection?.metadata?.pageId;
  if (!pageId) {
    return failRecommendation(supabase, action.id, 'Facebook Page not connected.');
  }

  const effectiveAssetId = ad.media_asset_id ?? adSet.adset_media_asset_id;
  if (!effectiveAssetId) {
    return failRecommendation(supabase, action.id, 'The original ad has no media asset to reuse.');
  }

  let replacementAdId: string | null = null;
  let metaAdCreated = false;
  try {
    const { data: assetRow, error: assetError } = await supabase
      .from('media_assets')
      .select('storage_path')
      .eq('id', effectiveAssetId)
      .single<{ storage_path: string }>();

    if (assetError || !assetRow?.storage_path) {
      throw new Error('Could not load the original ad media.');
    }

    const storagePath = assetRow.storage_path.startsWith(`${MEDIA_BUCKET}/`)
      ? assetRow.storage_path.slice(MEDIA_BUCKET.length + 1)
      : assetRow.storage_path;
    const { data: signed, error: signError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storagePath, 300);

    if (signError || !signed?.signedUrl) {
      throw new Error('Could not prepare the original ad media.');
    }

    const { data: replacementRow, error: replacementError } = await supabase
      .from('ads')
      .insert({
        adset_id: adSet.id,
        name: proposal.name,
        headline: proposal.headline,
        primary_text: proposal.primaryText,
        description: proposal.description,
        cta: proposal.cta,
        angle: proposal.angle,
        media_asset_id: effectiveAssetId,
        creative_brief: 'Approved copy rewrite from conversion-first optimiser.',
        status: 'DRAFT',
      })
      .select('id')
      .single<{ id: string }>();

    if (replacementError || !replacementRow) {
      throw new Error(replacementError?.message ?? 'Could not create replacement ad row.');
    }
    replacementAdId = replacementRow.id;

    const { hash } = await uploadMetaImage(adAccount.meta_account_id, adAccount.access_token, signed.signedUrl);
    const creative = await createMetaAdCreative({
      accessToken: adAccount.access_token,
      adAccountId: adAccount.meta_account_id,
      name: proposal.name,
      pageId,
      linkUrl: campaign.destination_url,
      imageHash: hash,
      message: proposal.primaryText,
      headline: proposal.headline,
      description: proposal.description,
      callToActionType: campaign.campaign_kind === 'event' ? 'BOOK_NOW' : proposal.cta,
    });
    const metaAd = await createMetaAd({
      accessToken: adAccount.access_token,
      adAccountId: adAccount.meta_account_id,
      name: proposal.name,
      adsetId: adSet.meta_adset_id,
      creativeId: creative.id,
      status: 'ACTIVE',
    });
    metaAdCreated = true;

    const { error: replacementUpdateError } = await supabase
      .from('ads')
      .update({
        meta_creative_id: creative.id,
        meta_ad_id: metaAd.id,
        status: 'ACTIVE',
        meta_status: 'ACTIVE',
      })
      .eq('id', replacementAdId);

    if (replacementUpdateError) throw new Error(replacementUpdateError.message);

    await markRecommendationApplied(supabase, action.id, { replacementAdId });
    revalidatePath('/campaigns');
    revalidatePath(`/campaigns/${campaign.id}`);
    return { success: true, replacementAdId };
  } catch (error) {
    if (replacementAdId && !metaAdCreated) {
      await supabase.from('ads').delete().eq('id', replacementAdId);
    }
    return failRecommendation(supabase, action.id, error instanceof Error ? error.message : String(error));
  }
}

function parseCopyProposal(payload: Record<string, unknown> | null): CopyProposal | null {
  const proposed = payload?.proposed;
  if (!proposed || typeof proposed !== 'object') return null;
  const record = proposed as Record<string, unknown>;
  const headline = normaliseText(record.headline, 40);
  const primaryText = normaliseText(record.primaryText, 300);
  const description = normaliseText(record.description, 25);
  if (!headline || !primaryText || !description) return null;
  return {
    name: normaliseText(record.name, 120) || 'Booking-focused rewrite',
    headline,
    primaryText,
    description,
    cta: parseCta(record.cta),
    angle: normaliseText(record.angle, 80) || 'Booking intent',
  };
}

function normaliseText(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function parseCta(value: unknown): CtaType {
  const candidate = typeof value === 'string' ? value : 'BOOK_NOW';
  return ['LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'BOOK_NOW', 'CONTACT_US', 'SUBSCRIBE'].includes(candidate)
    ? candidate as CtaType
    : 'BOOK_NOW';
}

async function markRecommendationApplied(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  actionId: string,
  { replacementAdId }: { replacementAdId: string | null },
) {
  await supabase
    .from('meta_optimisation_actions')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      replacement_ad_id: replacementAdId,
      error: null,
    })
    .eq('id', actionId);
}

async function failRecommendation(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  actionId: string,
  error: string,
): Promise<{ error: string }> {
  await supabase
    .from('meta_optimisation_actions')
    .update({ status: 'failed', error })
    .eq('id', actionId);
  return { error };
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

/**
 * Form-action wrappers for use in client components.
 * Server actions that return values can't be passed to <form action={}> directly.
 */

export async function syncPerformanceFormAction() {
  await syncCampaignDashboardPerformance();
}

export async function runOptimiserFormAction() {
  await runCampaignDashboardOptimisation();
}

export async function applyOptimisationRecommendationFormAction(formData: FormData) {
  const actionId = String(formData.get('actionId') ?? '');
  if (actionId) {
    await applyOptimisationRecommendation(actionId);
  }
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
  quality_score: number | string | null;
  quality_status: string | null;
  quality_issues: Record<string, unknown>[] | null;
  audience_strategy: Record<string, unknown> | null;
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
  campaign_type: string | null;
  auto_confirm: boolean | null;
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
  creative_format: string | null;
  creative_variant_key: string | null;
  utm_content_key: string | null;
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

interface OptimisationActionCampaignRef {
  name?: string | null;
  status?: string | null;
  meta_status?: string | null;
  end_date?: string | null;
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
  severity: string | null;
  error: string | null;
  metrics_snapshot: Record<string, unknown> | null;
  recommendation_payload: Record<string, unknown> | null;
  replacement_ad_id: string | null;
  applied_at: string | null;
  created_at: string;
  meta_campaigns?: OptimisationActionCampaignRef | OptimisationActionCampaignRef[] | null;
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
    creativeFormat: row.creative_format as Ad['creativeFormat'],
    creativeVariantKey: row.creative_variant_key ?? null,
    utmContentKey: row.utm_content_key ?? null,
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
    qualityScore: row.quality_score === null || row.quality_score === undefined ? null : Number(row.quality_score),
    qualityStatus: (row.quality_status ?? null) as Campaign['qualityStatus'],
    qualityIssues: Array.isArray(row.quality_issues) ? row.quality_issues : [],
    audienceStrategy: row.audience_strategy ?? null,
    campaignType: row.campaign_type ?? row.campaign_kind ?? null,
    autoConfirm: Boolean(row.auto_confirm ?? false),
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
  const conversions = Number(row.metrics_conversions ?? 0);
  return {
    spend: Number(row.metrics_spend ?? 0),
    impressions: Number(row.metrics_impressions ?? 0),
    reach: Number(row.metrics_reach ?? 0),
    clicks: Number(row.metrics_clicks ?? 0),
    ctr: Number(row.metrics_ctr ?? 0),
    cpc: Number(row.metrics_cpc ?? 0),
    conversions,
    metaConversions: conversions,
    firstPartyBookings: 0,
    firstPartyBookingValue: 0,
    blendedBookings: conversions,
    blendedBookingValue: 0,
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
    severity: (row.severity ?? 'info') as OptimisationActionSummary['severity'],
    error: row.error,
    metricsSnapshot: row.metrics_snapshot ?? {},
    recommendationPayload: row.recommendation_payload ?? {},
    replacementAdId: row.replacement_ad_id ?? null,
    appliedAt: row.applied_at ? new Date(row.applied_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function isOptimisationActionForFinishedCampaign(row: OptimisationActionDbRow): boolean {
  const campaign = firstNested(row.meta_campaigns);
  if (!campaign) return false;

  const status = campaign.status?.trim().toUpperCase() ?? null;
  const metaStatus = campaign.meta_status?.trim().toUpperCase() ?? null;
  if (status === 'ARCHIVED' || metaStatus === 'ARCHIVED' || metaStatus === 'DELETED') return true;
  if (!campaign.end_date || status === 'DRAFT') return false;

  return campaign.end_date < dateOnly(new Date());
}

function dateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isMissingOptimisationRecommendationSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== '42703') return false;
  const message = typeof record.message === 'string' ? record.message : '';
  return /\b(severity|recommendation_payload|replacement_ad_id)\b/.test(message);
}

function nestedName(value: OptimisationActionDbRow['meta_campaigns']): string | null {
  const candidate = firstNested(value);
  return typeof candidate?.name === 'string' ? candidate.name : null;
}

function firstNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
