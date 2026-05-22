import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { DEFAULT_META_PIXEL_ID } from '@/lib/campaigns/conversion-readiness';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export type MetaOptimisationMode = 'apply' | 'dry_run' | 'recommend';
export type MetaOptimisationActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';
export type MetaOptimisationActionType = 'pause_ad' | 'tracking_issue' | 'copy_rewrite';
export type MetaOptimisationSeverity = 'info' | 'warning' | 'critical';

const TRACKABLE_BOOKING_HOSTS = new Set(['the-anchor.pub', 'www.the-anchor.pub']);
const TRACKABLE_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'vip-club.uk', 'www.vip-club.uk']);
const BANNED_GENERIC_PHRASES = [
  "don't miss out",
  "don't miss",
  'join the fun',
  'exciting',
  'amazing',
  'hurry',
];
const WALK_IN_PATTERN = /\bwalk-?ins?\s+(welcome|available|if space allows)\b/i;
const PAY_ON_ARRIVAL_PATTERN = /\b(no payment now|pay.{0,40}(arrival|night|door)|cash.{0,30}(arrival|night|door))\b/i;
const TEXT_DATE_PATTERN = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;

export interface OptimisationAdRow {
  id: string;
  meta_ad_id: string | null;
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  angle: string | null;
  media_asset_id?: string | null;
  status: string;
  meta_status: string | null;
  metrics_spend: number | string | null;
  metrics_impressions: number | string | null;
  metrics_clicks: number | string | null;
  metrics_ctr: number | string | null;
  metrics_cpc: number | string | null;
  metrics_conversions: number | string | null;
  metrics_cost_per_conversion: number | string | null;
  metrics_conversion_rate: number | string | null;
  last_synced_at: string | null;
}

export interface OptimisationAdSetRow {
  id: string;
  meta_adset_id: string | null;
  name: string;
  status: string;
  meta_status: string | null;
  last_synced_at: string | null;
  ads?: OptimisationAdRow[];
}

export interface OptimisationCampaignRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  name: string;
  problem_brief?: string | null;
  destination_url?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  source_snapshot?: Record<string, unknown> | null;
  campaign_kind?: string | null;
  status: string;
  meta_status: string | null;
  metrics_spend?: number | string | null;
  metrics_impressions?: number | string | null;
  metrics_clicks?: number | string | null;
  metrics_ctr?: number | string | null;
  metrics_cpc?: number | string | null;
  metrics_conversions?: number | string | null;
  last_synced_at: string | null;
  ad_sets?: OptimisationAdSetRow[];
}

interface OptimisationAdAccountRow {
  access_token: string | null;
  token_expires_at: string | null;
  meta_pixel_id?: string | null;
  conversion_event_name?: string | null;
  conversion_optimisation_enabled?: boolean | null;
}

interface ManagementConnectionRow {
  base_url: string | null;
  api_key: string | null;
  enabled: boolean | null;
}

interface ManagementBookingConversionRow {
  booking_id?: unknown;
  booking_type?: unknown;
  event_id?: unknown;
  event_slug?: unknown;
  occurred_at?: unknown;
}

export interface BookingConversionEventForOptimisation {
  booking_id: string;
  booking_type: string;
  event_id: string | null;
  event_slug: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbclid: string | null;
  occurred_at: string;
}

export interface BlendedBookingSignal {
  campaignId: string;
  metaBookings: number;
  firstPartyBookings: number;
  blendedBookings: number;
  trackingMismatch: boolean;
}

export interface OptimisationDecision {
  campaignId: string;
  adSetId: string | null;
  adId: string | null;
  metaObjectId: string | null;
  actionType: MetaOptimisationActionType;
  severity: MetaOptimisationSeverity;
  reason: string;
  metricsSnapshot: Record<string, unknown>;
  recommendationPayload: Record<string, unknown>;
}

export interface MetaCampaignOptimisationResult {
  runId: string;
  evaluatedAdSets: number;
  plannedActions: number;
  appliedActions: number;
  failedActions: number;
}

interface RunMetaCampaignOptimisationOptions {
  accountId: string;
  mode?: MetaOptimisationMode;
  supabase?: SupabaseClientLike;
}

export async function runMetaCampaignOptimisation({
  accountId,
  mode = 'recommend',
  supabase: providedSupabase,
}: RunMetaCampaignOptimisationOptions): Promise<MetaCampaignOptimisationResult> {
  const supabase = providedSupabase ?? createServiceSupabaseClient();
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runError } = await supabase
    .from('meta_optimisation_runs')
    .insert({
      account_id: accountId,
      mode,
      status: 'running',
      started_at: startedAt,
      summary: {},
    })
    .select('id')
    .single<{ id: string }>();

  if (runError || !runRow) {
    throw new Error(runError?.message ?? 'Could not start Meta optimisation run.');
  }

  const runId = runRow.id;

  try {
    const { data: adAccount, error: adAccountError } = await supabase
      .from('meta_ad_accounts')
      .select('access_token, token_expires_at, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled')
      .eq('account_id', accountId)
      .single<OptimisationAdAccountRow>();

    if (adAccountError) throw new Error(adAccountError.message);
    if (!adAccount?.access_token) {
      throw new Error('Meta Ads account not connected.');
    }
    if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) {
      throw new Error('Meta Ads token has expired.');
    }

    const { data: campaigns, error: campaignsError } = await supabase
      .from('meta_campaigns')
      .select(
        [
          'id, account_id, meta_campaign_id, name, problem_brief, destination_url, source_type, source_id, source_snapshot, campaign_kind',
          'status, meta_status, last_synced_at, metrics_spend, metrics_impressions, metrics_clicks, metrics_ctr, metrics_cpc, metrics_conversions',
          'ad_sets(id, meta_adset_id, name, status, meta_status, last_synced_at, ads(id, meta_ad_id, name, headline, primary_text, description, cta, angle, media_asset_id, status, meta_status, metrics_spend, metrics_impressions, metrics_clicks, metrics_ctr, metrics_cpc, metrics_conversions, metrics_cost_per_conversion, metrics_conversion_rate, last_synced_at))',
        ].join(', '),
      )
      .eq('account_id', accountId)
      .eq('status', 'ACTIVE')
      .not('meta_campaign_id', 'is', null);

    if (campaignsError) throw new Error(campaignsError.message);

    const allCampaigns = Array.isArray(campaigns) ? (campaigns as unknown as OptimisationCampaignRow[]) : [];
    const bookingSignals = await loadBlendedBookingSignals(supabase, accountId, allCampaigns);
    const { decisions: rawDecisions, evaluatedAdSets } = evaluateCampaignOptimisation(allCampaigns, {
      bookingSignals,
      adAccount,
    });
    const existingKeys = await loadRecentOptimisationActionKeys(supabase, accountId);
    const decisions = rawDecisions.filter((decision) => !existingKeys.has(decisionKey(decision)));

    const appliedActions = 0;
    const failedActions = 0;

    for (const decision of decisions) {
      await supabase
        .from('meta_optimisation_actions')
        .insert({
          run_id: runId,
          account_id: accountId,
          campaign_id: decision.campaignId,
          adset_id: decision.adSetId,
          ad_id: decision.adId,
          meta_object_id: decision.metaObjectId,
          action_type: decision.actionType,
          reason: decision.reason,
          metrics_snapshot: decision.metricsSnapshot,
          recommendation_payload: decision.recommendationPayload,
          severity: decision.severity,
          status: 'planned' satisfies MetaOptimisationActionStatus,
          error: null,
          applied_at: null,
        });
    }

    const result: MetaCampaignOptimisationResult = {
      runId,
      evaluatedAdSets,
      plannedActions: decisions.length,
      appliedActions,
      failedActions,
    };

    await supabase
      .from('meta_optimisation_runs')
      .update({
        status: 'completed',
        summary: result,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    return result;
  } catch (error) {
    await supabase
      .from('meta_optimisation_runs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    throw error;
  }
}

export function evaluateCampaignOptimisation(
  campaigns: OptimisationCampaignRow[],
  options?: {
    bookingSignals?: Map<string, BlendedBookingSignal>;
    adAccount?: Pick<OptimisationAdAccountRow, 'meta_pixel_id' | 'conversion_event_name' | 'conversion_optimisation_enabled'> | null;
  },
): {
  decisions: OptimisationDecision[];
  evaluatedAdSets: number;
} {
  const decisions: OptimisationDecision[] = [];
  let evaluatedAdSets = 0;

  for (const campaign of campaigns) {
    if (!isActiveObject(campaign) || !campaign.meta_campaign_id) continue;

    const bookingSignal = options?.bookingSignals?.get(campaign.id) ?? defaultBookingSignal(campaign);
    decisions.push(...evaluateCampaignDiagnostics(campaign, bookingSignal, options?.adAccount ?? null));

    const adSets = Array.isArray(campaign.ad_sets) ? campaign.ad_sets : [];
    for (const adSet of adSets) {
      if (!isActiveObject(adSet) || !adSet.meta_adset_id || !adSet.last_synced_at) continue;

      const activeAds = (Array.isArray(adSet.ads) ? adSet.ads : [])
        .filter((ad) => isActiveObject(ad) && Boolean(ad.meta_ad_id) && Boolean(ad.last_synced_at));

      if (activeAds.length < 2) continue;
      evaluatedAdSets++;

      const adSetDecisions = evaluateAdSetOptimisation(campaign, adSet, activeAds, bookingSignal);
      let remainingActiveAds = activeAds.length;
      for (const decision of adSetDecisions) {
        if (remainingActiveAds <= 1) break;
        decisions.push(decision);
        remainingActiveAds--;
      }
    }

    decisions.push(...evaluateCopyRewriteRecommendations(campaign, adSets, bookingSignal));
  }

  return { decisions: dedupeDecisions(decisions), evaluatedAdSets };
}

export function evaluateAdSetOptimisation(
  campaign: Pick<OptimisationCampaignRow, 'id' | 'name'>,
  adSet: Pick<OptimisationAdSetRow, 'id' | 'name'>,
  activeAds: OptimisationAdRow[],
  bookingSignal?: BlendedBookingSignal,
): OptimisationDecision[] {
  if (activeAds.length < 2) return [];

  const adsWithBookings = activeAds.filter((ad) => metric(ad.metrics_conversions) >= 1);
  if (adsWithBookings.length > 0) {
    return activeAds
      .filter((ad) => {
        if (metric(ad.metrics_conversions) > 0) return false;
        return metric(ad.metrics_spend) >= 5 || metric(ad.metrics_clicks) >= 15;
      })
      .map((ad) => buildPauseDecision({
        campaign,
        adSet,
        ad,
        bookingSignal,
        reason:
          'Recommended pause: this ad has no bookings after meaningful spend/click volume while a sibling ad in the same ad set has bookings.',
      }));
  }

  const candidates = activeAds
    .filter((ad) => {
      if (metric(ad.metrics_conversions) > 0) return false;
      if (metric(ad.metrics_impressions) < 500) return false;
      if (metric(ad.metrics_spend) < 3) return false;
      if (metric(ad.metrics_ctr) >= 0.5) return false;
      return hasMateriallyStrongerSibling(ad, activeAds);
    })
    .sort((a, b) => {
      const ctrDelta = metric(a.metrics_ctr) - metric(b.metrics_ctr);
      if (ctrDelta !== 0) return ctrDelta;
      return metric(b.metrics_spend) - metric(a.metrics_spend);
    });

  const loser = candidates[0];
  if (!loser) return [];

  return [
    buildPauseDecision({
      campaign,
      adSet,
      ad: loser,
      bookingSignal,
      reason:
        'Recommended pause: this ad has enough impressions and spend, CTR below 0.5%, and a sibling ad is materially stronger.',
    }),
  ];
}

export function buildBlendedBookingSignals(
  campaigns: OptimisationCampaignRow[],
  bookingEvents: BookingConversionEventForOptimisation[],
): Map<string, BlendedBookingSignal> {
  const signals = new Map<string, BlendedBookingSignal>();

  for (const campaign of campaigns) {
    const metaBookings = metric(campaign.metrics_conversions);
    const firstPartyBookings = bookingEvents.filter((event) => bookingEventMatchesCampaign(event, campaign)).length;
    signals.set(campaign.id, {
      campaignId: campaign.id,
      metaBookings,
      firstPartyBookings,
      blendedBookings: Math.max(metaBookings, firstPartyBookings),
      trackingMismatch: metaBookings === 0 && firstPartyBookings > 0,
    });
  }

  return signals;
}

function evaluateCampaignDiagnostics(
  campaign: OptimisationCampaignRow,
  bookingSignal: BlendedBookingSignal,
  adAccount: Pick<OptimisationAdAccountRow, 'meta_pixel_id' | 'conversion_event_name' | 'conversion_optimisation_enabled'> | null,
) {
  const decisions: OptimisationDecision[] = [];

  if (!campaign.last_synced_at) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'warning',
      reason: 'Performance has not synced yet, so copy and booking decisions may be based on incomplete data.',
      category: 'stale_sync',
      bookingSignal,
    }));
  }

  if (isStaleSync(campaign.last_synced_at)) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'warning',
      reason: 'Performance data is more than 36 hours old. Sync performance before judging whether the copy is working.',
      category: 'stale_sync',
      bookingSignal,
    }));
  }

  if (!campaign.destination_url) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'critical',
      reason: 'This campaign has no paid CTA URL, so clicks may not be going to a booking page.',
      category: 'missing_destination',
      bookingSignal,
    }));
  } else if (!isValidUrl(campaign.destination_url)) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'critical',
      reason: 'The paid CTA URL is not a valid URL. Fix the destination before spending more.',
      category: 'invalid_destination',
      bookingSignal,
    }));
  } else if (!isTrackableBookingDestination(campaign)) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'warning',
      reason: 'The paid CTA URL does not look like a trackable booking destination, so bookings may not be attributed.',
      category: 'untrackable_destination',
      bookingSignal,
    }));
  }

  if (adAccount?.conversion_optimisation_enabled === false) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'critical',
      reason: 'Meta conversion optimisation is disabled for this ad account, so campaigns may optimise for clicks instead of bookings.',
      category: 'conversion_optimisation_disabled',
      bookingSignal,
    }));
  }

  if (adAccount) {
    const pixelId = adAccount.meta_pixel_id?.trim() ?? '';
    if (!pixelId || pixelId === DEFAULT_META_PIXEL_ID) {
      decisions.push(buildTrackingIssueDecision({
        campaign,
        severity: 'critical',
        reason: 'The ad account is missing the venue Meta pixel. Booking campaigns cannot optimise for purchases until this is configured.',
        category: 'default_pixel',
        bookingSignal,
      }));
    }

    const eventName = adAccount.conversion_event_name?.trim() || 'Purchase';
    if (eventName.toLowerCase() !== 'purchase') {
      decisions.push(buildTrackingIssueDecision({
        campaign,
        severity: 'warning',
        reason: `The configured Meta conversion event is "${eventName}", but booking attribution expects Purchase.`,
        category: 'conversion_event_mismatch',
        bookingSignal,
      }));
    }
  }

  if (bookingSignal.trackingMismatch) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'critical',
      reason: 'First-party booking events exist, but Meta is reporting zero Purchase conversions. Fix pixel/CAPI attribution before judging ad copy.',
      category: 'meta_first_party_mismatch',
      bookingSignal,
    }));
  }

  if (metric(campaign.metrics_clicks) >= 10 && bookingSignal.firstPartyBookings === 0) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'warning',
      reason: 'The campaign has clicks but no first-party booking records. Check the landing page, booking flow, and booking conversion ingest.',
      category: 'clicks_no_first_party_bookings',
      bookingSignal,
    }));
  }

  if (metric(campaign.metrics_impressions) >= 500 && metric(campaign.metrics_ctr) > 0 && metric(campaign.metrics_ctr) < 0.5) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'info',
      reason: `CTR is ${metric(campaign.metrics_ctr).toFixed(2)}%, so the hook, creative, or audience may not be strong enough.`,
      category: 'low_ctr',
      bookingSignal,
    }));
  }

  if (metric(campaign.metrics_clicks) >= 10 && metric(campaign.metrics_cpc) >= 1) {
    decisions.push(buildTrackingIssueDecision({
      campaign,
      severity: 'info',
      reason: `CPC is £${metric(campaign.metrics_cpc).toFixed(2)} after ${metric(campaign.metrics_clicks)} clicks. Review audience and creative relevance.`,
      category: 'high_cpc',
      bookingSignal,
    }));
  }

  return decisions;
}

function evaluateCopyRewriteRecommendations(
  campaign: OptimisationCampaignRow,
  adSets: OptimisationAdSetRow[],
  bookingSignal: BlendedBookingSignal,
): OptimisationDecision[] {
  const activeAds = adSets.flatMap((adSet) =>
    (adSet.ads ?? [])
      .filter((ad) => isActiveObject(ad))
      .map((ad) => ({ adSet, ad })),
  );

  const criticalCopyFixes = activeAds
    .filter(({ ad }) => hasCriticalCopyMismatch(campaign, ad))
    .slice(0, 3);

  if (criticalCopyFixes.length > 0) {
    return criticalCopyFixes.map(({ adSet, ad }) => buildCopyRewriteDecision(campaign, adSet, ad, bookingSignal));
  }

  if (bookingSignal.blendedBookings > 0) return [];
  if (!hasEnoughSignalForCopyRewrite(campaign, activeAds.map((item) => item.ad))) return [];

  return activeAds
    .filter(({ ad }) => shouldRewriteAdCopy(ad, campaign))
    .sort((left, right) => {
      const leftWeak = hasWeakBookingIntent(left.ad) ? 1 : 0;
      const rightWeak = hasWeakBookingIntent(right.ad) ? 1 : 0;
      if (rightWeak !== leftWeak) return rightWeak - leftWeak;
      return metric(right.ad.metrics_spend) - metric(left.ad.metrics_spend);
    })
    .slice(0, 3)
    .map(({ adSet, ad }) => buildCopyRewriteDecision(campaign, adSet, ad, bookingSignal));
}

function buildPauseDecision(args: {
  campaign: Pick<OptimisationCampaignRow, 'id' | 'name'>;
  adSet: Pick<OptimisationAdSetRow, 'id' | 'name'>;
  ad: OptimisationAdRow;
  bookingSignal?: BlendedBookingSignal;
  reason: string;
}): OptimisationDecision {
  return {
    campaignId: args.campaign.id,
    adSetId: args.adSet.id,
    adId: args.ad.id,
    metaObjectId: args.ad.meta_ad_id ?? null,
    actionType: 'pause_ad',
    severity: 'warning',
    reason: args.reason,
    metricsSnapshot: buildAdMetricsSnapshot(args.campaign, args.adSet, args.ad, args.bookingSignal),
    recommendationPayload: {
      recommendation: 'Review and pause this ad only after confirming a stronger sibling should continue running.',
    },
  };
}

function buildTrackingIssueDecision(args: {
  campaign: OptimisationCampaignRow;
  severity: MetaOptimisationSeverity;
  reason: string;
  category: string;
  bookingSignal: BlendedBookingSignal;
}): OptimisationDecision {
  return {
    campaignId: args.campaign.id,
    adSetId: null,
    adId: null,
    metaObjectId: args.campaign.meta_campaign_id,
    actionType: 'tracking_issue',
    severity: args.severity,
    reason: args.reason,
    metricsSnapshot: buildCampaignMetricsSnapshot(args.campaign, args.bookingSignal),
    recommendationPayload: {
      category: args.category,
      bookingSignal: args.bookingSignal,
    },
  };
}

function buildCopyRewriteDecision(
  campaign: OptimisationCampaignRow,
  adSet: OptimisationAdSetRow,
  ad: OptimisationAdRow,
  bookingSignal: BlendedBookingSignal,
): OptimisationDecision {
  const proposed = buildBookingFocusedCopy(campaign, ad);
  const issues = describeCopyIssues(ad, campaign);
  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    adId: ad.id,
    metaObjectId: ad.meta_ad_id ?? null,
    actionType: 'copy_rewrite',
    severity: issues.length ? 'warning' : 'info',
    reason: issues.length
      ? `Rewrite recommended: ${issues.join(', ')}.`
      : 'Rewrite recommended: the campaign has enough traffic but no tracked bookings, so test clearer booking intent.',
    metricsSnapshot: buildAdMetricsSnapshot(campaign, adSet, ad, bookingSignal),
    recommendationPayload: {
      confidence: calculateRewriteConfidence(ad, campaign),
      current: {
        headline: ad.headline,
        primaryText: ad.primary_text,
        description: ad.description,
        cta: ad.cta,
        angle: ad.angle,
      },
      proposed,
      issues,
      bookingSignal,
    },
  };
}

function buildBookingFocusedCopy(campaign: OptimisationCampaignRow, ad: OptimisationAdRow) {
  const snapshot = campaign.source_snapshot ?? {};
  const campaignName = compactCampaignName(stringValue(snapshot.eventName) ?? campaign.name);
  const dateLabel = formatEventDateForCopy(snapshot);
  const unitPrice = numericSnapshotValue(snapshot.price_per_seat)
    ?? numericSnapshotValue(snapshot.pricePerSeat)
    ?? numericSnapshotValue(snapshot.price)
    ?? numericSnapshotValue(snapshot.eventPrice);
  const payOnArrival = hasCashOnArrivalContext(campaign);
  const headline = truncateText(`Book ${campaignName}`, 40);
  const hook = truncateText(`Reserve a table for ${campaignName}${dateLabel ? ` on ${dateLabel}` : ''}.`, 115);
  const detail = truncateText(buildBookingCopyDetail(campaign, snapshot, dateLabel, unitPrice), 145);
  const reassurance = payOnArrival
    ? `No payment now${unitPrice ? `, pay £${formatPrice(unitPrice)} on arrival` : ', pay on arrival'}.`
    : 'Reserve now so your seats are held.';
  const urgency = campaign.campaign_kind === 'event'
    ? reassurance
    : 'Book today and make the plan easy to say yes to.';
  const primaryText = truncateText(`${hook}\n\n${detail}\n\n${urgency}`, 300);

  return {
    name: `${ad.name} - booking rewrite`,
    headline,
    primaryText,
    description: campaign.campaign_kind === 'event' ? 'Book your spot' : 'Book now',
    cta: 'BOOK_NOW',
    angle: 'Booking intent',
  };
}

function buildCampaignMetricsSnapshot(campaign: OptimisationCampaignRow, bookingSignal?: BlendedBookingSignal) {
  return {
    campaignName: campaign.name,
    spend: metric(campaign.metrics_spend),
    impressions: metric(campaign.metrics_impressions),
    clicks: metric(campaign.metrics_clicks),
    ctr: metric(campaign.metrics_ctr),
    cpc: metric(campaign.metrics_cpc),
    metaBookings: metric(campaign.metrics_conversions),
    firstPartyBookings: bookingSignal?.firstPartyBookings ?? 0,
    blendedBookings: bookingSignal?.blendedBookings ?? metric(campaign.metrics_conversions),
    lastSyncedAt: campaign.last_synced_at,
  };
}

function buildAdMetricsSnapshot(
  campaign: Pick<OptimisationCampaignRow, 'name'>,
  adSet: Pick<OptimisationAdSetRow, 'name'>,
  ad: OptimisationAdRow,
  bookingSignal?: BlendedBookingSignal,
) {
  return {
    campaignName: campaign.name,
    adSetName: adSet.name,
    adName: ad.name,
    spend: metric(ad.metrics_spend),
    impressions: metric(ad.metrics_impressions),
    clicks: metric(ad.metrics_clicks),
    ctr: metric(ad.metrics_ctr),
    cpc: metric(ad.metrics_cpc),
    conversions: metric(ad.metrics_conversions),
    costPerConversion: metric(ad.metrics_cost_per_conversion),
    conversionRate: metric(ad.metrics_conversion_rate),
    firstPartyBookings: bookingSignal?.firstPartyBookings ?? 0,
    blendedBookings: bookingSignal?.blendedBookings ?? 0,
    lastSyncedAt: ad.last_synced_at,
  };
}

async function loadBlendedBookingSignals(
  supabase: SupabaseClientLike,
  accountId: string,
  campaigns: OptimisationCampaignRow[],
) {
  if (campaigns.length === 0) return new Map<string, BlendedBookingSignal>();

  const { data, error } = await supabase
    .from('booking_conversion_events')
    .select('booking_id, booking_type, event_id, event_slug, utm_campaign, utm_content, fbclid, occurred_at')
    .eq('account_id', accountId)
    .gte('occurred_at', oldestRelevantDate(campaigns));

  let firstPartyEvents = (data ?? []) as BookingConversionEventForOptimisation[];
  if (error) {
    console.error('[optimisation] failed to load booking conversion events', error);
    firstPartyEvents = [];
  }

  const managementEvents = await loadManagementBookingConversionEvents(supabase, accountId, campaigns);
  return buildBlendedBookingSignals(campaigns, [...firstPartyEvents, ...managementEvents]);
}

async function loadManagementBookingConversionEvents(
  supabase: SupabaseClientLike,
  accountId: string,
  campaigns: OptimisationCampaignRow[],
): Promise<BookingConversionEventForOptimisation[]> {
  const eventIds = Array.from(new Set(campaigns
    .map((campaign) => stringValue(campaign.source_snapshot?.eventId) ?? campaign.source_id)
    .filter((value): value is string => Boolean(value))));

  if (eventIds.length === 0) return [];

  const { data: connection, error } = await supabase
    .from('management_app_connections')
    .select('base_url, api_key, enabled')
    .eq('account_id', accountId)
    .maybeSingle<ManagementConnectionRow>();

  if (error || !connection?.enabled || !connection.api_key?.trim() || !connection.base_url?.trim()) {
    if (error) console.error('[optimisation] failed to load management connection', error);
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const baseUrl = connection.base_url.trim().replace(/\/+$/, '');
  const url = new URL('/api/marketing/event-booking-conversions', baseUrl);
  url.searchParams.set('event_ids', eventIds.join(','));
  url.searchParams.set('since', oldestRelevantDate(campaigns));

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-API-Key': connection.api_key.trim(),
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('[optimisation] management booking fallback rejected', { status: response.status });
      return [];
    }

    const payload = await response.json() as { data?: { conversions?: ManagementBookingConversionRow[] } };
    const rows = Array.isArray(payload?.data?.conversions) ? payload.data.conversions : [];

    return rows
      .map((row): BookingConversionEventForOptimisation | null => {
        const bookingId = stringValue(row.booking_id);
        const eventId = stringValue(row.event_id);
        const occurredAt = stringValue(row.occurred_at);
        if (!bookingId || !eventId || !occurredAt) return null;
        return {
          booking_id: bookingId,
          booking_type: stringValue(row.booking_type) ?? 'event',
          event_id: eventId,
          event_slug: stringValue(row.event_slug),
          utm_campaign: null,
          utm_content: null,
          fbclid: null,
          occurred_at: occurredAt,
        };
      })
      .filter((row): row is BookingConversionEventForOptimisation => Boolean(row));
  } catch (error) {
    console.error('[optimisation] management booking fallback failed', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRecentOptimisationActionKeys(supabase: SupabaseClientLike, accountId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('meta_optimisation_actions')
    .select('campaign_id, ad_id, action_type, reason')
    .eq('account_id', accountId)
    .gte('created_at', since)
    .in('status', ['planned', 'applied']);

  if (error) {
    console.error('[optimisation] failed to load recent actions', error);
    return new Set();
  }

  return new Set((data ?? []).map((row) => decisionKey({
    campaignId: String(row.campaign_id),
    adId: typeof row.ad_id === 'string' ? row.ad_id : null,
    actionType: String(row.action_type) as MetaOptimisationActionType,
    reason: String(row.reason),
  })));
}

function decisionKey(decision: Pick<OptimisationDecision, 'campaignId' | 'adId' | 'actionType' | 'reason'>) {
  return `${decision.actionType}:${decision.campaignId}:${decision.adId ?? 'campaign'}:${decision.reason}`;
}

function dedupeDecisions(decisions: OptimisationDecision[]) {
  const seen = new Set<string>();
  return decisions.filter((decision) => {
    const key = decisionKey(decision);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultBookingSignal(campaign: OptimisationCampaignRow): BlendedBookingSignal {
  const metaBookings = metric(campaign.metrics_conversions);
  return {
    campaignId: campaign.id,
    metaBookings,
    firstPartyBookings: 0,
    blendedBookings: metaBookings,
    trackingMismatch: false,
  };
}

function bookingEventMatchesCampaign(
  event: BookingConversionEventForOptimisation,
  campaign: OptimisationCampaignRow,
) {
  const snapshot = campaign.source_snapshot ?? {};
  const campaignEventId = stringValue(snapshot.eventId) ?? campaign.source_id;
  const campaignEventSlug = stringValue(snapshot.eventSlug);

  if (campaignEventId && event.event_id === campaignEventId) return true;
  if (campaignEventSlug && event.event_slug === campaignEventSlug) return true;

  const campaignNames = new Set([
    normaliseComparable(campaign.name),
    normaliseComparable(stringValue(snapshot.utmCampaign)),
    normaliseComparable(utmValue(campaign.destination_url, 'utm_campaign')),
    normaliseComparable(utmValue(stringValue(snapshot.utmDestinationUrl), 'utm_campaign')),
    normaliseComparable(utmValue(stringValue(snapshot.originalDestinationUrl), 'utm_campaign')),
  ].filter(Boolean));

  return Boolean(event.utm_campaign && campaignNames.has(normaliseComparable(event.utm_campaign)));
}

function hasEnoughSignalForCopyRewrite(campaign: OptimisationCampaignRow, ads: OptimisationAdRow[]) {
  if (metric(campaign.metrics_clicks) >= 10) return true;
  if (metric(campaign.metrics_spend) >= 5) return true;
  return ads.some((ad) => metric(ad.metrics_impressions) >= 500 && metric(ad.metrics_ctr) > 0 && metric(ad.metrics_ctr) < 0.5);
}

function shouldRewriteAdCopy(ad: OptimisationAdRow, campaign: OptimisationCampaignRow) {
  if (metric(ad.metrics_conversions) > 0) return false;
  if (hasCriticalCopyMismatch(campaign, ad)) return true;
  if (hasWeakBookingIntent(ad)) return true;
  if (containsBannedGenericPhrase(`${ad.headline} ${ad.primary_text} ${ad.description}`)) return true;
  return metric(ad.metrics_spend) >= 2 || metric(ad.metrics_clicks) >= 5 || metric(ad.metrics_impressions) >= 500;
}

function describeCopyIssues(ad: OptimisationAdRow, campaign: OptimisationCampaignRow) {
  const issues: string[] = [];
  const text = `${ad.headline} ${ad.primary_text} ${ad.description}`;
  if (hasDateMismatch(campaign, text)) issues.push('date in ad copy does not match the imported event date');
  if (campaign.campaign_kind === 'event' && ad.cta !== 'BOOK_NOW') issues.push('CTA is not BOOK_NOW');
  if (WALK_IN_PATTERN.test(text)) issues.push('walk-ins welcome weakens the reason to reserve');
  if (hasCashOnArrivalContext(campaign) && !PAY_ON_ARRIVAL_PATTERN.test(text)) {
    issues.push('missing no-payment-now/pay-on-arrival reassurance');
  }
  if (hasWeakBookingIntent(ad)) issues.push('no clear booking intent');
  if (containsBannedGenericPhrase(text)) issues.push('generic urgency/adjective wording');
  if (/https?:\/\//i.test(text)) issues.push('raw URL in ad copy');
  if (metric(ad.metrics_ctr) > 0 && metric(ad.metrics_ctr) < 0.5 && metric(ad.metrics_impressions) >= 500) {
    issues.push('weak CTR');
  }
  return issues;
}

function hasCriticalCopyMismatch(campaign: OptimisationCampaignRow, ad: OptimisationAdRow) {
  const text = `${ad.headline} ${ad.primary_text} ${ad.description}`;
  if (hasDateMismatch(campaign, text)) return true;
  if (campaign.campaign_kind === 'event' && ad.cta !== 'BOOK_NOW') return true;
  if (WALK_IN_PATTERN.test(text)) return true;
  return false;
}

function hasWeakBookingIntent(ad: OptimisationAdRow) {
  const text = `${ad.headline} ${ad.primary_text} ${ad.description} ${ad.cta}`.toLowerCase();
  return !/\b(book|booking|reserve|reserved|ticket|tickets|seat|seats|table|tables|secure|spot|spots|purchase|buy)\b/.test(text);
}

function containsBannedGenericPhrase(value: string) {
  const lower = value.toLowerCase();
  return BANNED_GENERIC_PHRASES.some((phrase) => lower.includes(phrase));
}

function hasMateriallyStrongerSibling(ad: OptimisationAdRow, siblings: OptimisationAdRow[]): boolean {
  const adCtr = metric(ad.metrics_ctr);
  const adClicks = metric(ad.metrics_clicks);
  return siblings.some((sibling) => {
    if (sibling.id === ad.id) return false;
    const siblingCtr = metric(sibling.metrics_ctr);
    const siblingClicks = metric(sibling.metrics_clicks);
    if (adCtr === 0) {
      return siblingCtr >= 0.5 && siblingClicks >= adClicks + 5;
    }
    return siblingCtr >= adCtr * 2 && siblingClicks >= adClicks + 5;
  });
}

function isActiveObject(row: { status: string; meta_status: string | null }): boolean {
  return row.status === 'ACTIVE' && (row.meta_status === null || row.meta_status === 'ACTIVE');
}

function isStaleSync(value: string | null | undefined): boolean {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() > 36 * 60 * 60 * 1000;
}

function isTrackableBookingDestination(campaign: OptimisationCampaignRow) {
  const snapshot = campaign.source_snapshot ?? {};
  if (snapshot.bookingConversionOptimised === true) return true;

  const urls = [
    campaign.destination_url,
    stringValue(snapshot.originalDestinationUrl),
    stringValue(snapshot.utmDestinationUrl),
    stringValue(snapshot.paidCtaUrl),
    stringValue(snapshot.bookingUrl),
    stringValue(snapshot.metaAdsShortLink),
    stringValue(snapshot.metaAdsDestinationUrl),
  ].filter((value): value is string => Boolean(value));

  return urls.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return TRACKABLE_BOOKING_HOSTS.has(host) || TRACKABLE_SHORT_LINK_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function oldestRelevantDate(campaigns: OptimisationCampaignRow[]) {
  const timestamps = campaigns
    .map((campaign) => campaign.last_synced_at ? new Date(campaign.last_synced_at).getTime() : Date.now())
    .filter(Number.isFinite);
  const oldest = timestamps.length ? Math.min(...timestamps) : Date.now() - 90 * 24 * 60 * 60 * 1000;
  return new Date(Math.min(oldest, Date.now() - 90 * 24 * 60 * 60 * 1000)).toISOString();
}

function calculateRewriteConfidence(ad: OptimisationAdRow, campaign: OptimisationCampaignRow) {
  let confidence = 0.55;
  if (hasCriticalCopyMismatch(campaign, ad)) confidence += 0.2;
  if (hasWeakBookingIntent(ad)) confidence += 0.15;
  if (metric(ad.metrics_clicks) >= 10 || metric(campaign.metrics_clicks) >= 10) confidence += 0.1;
  if (metric(ad.metrics_spend) >= 5 || metric(campaign.metrics_spend) >= 5) confidence += 0.1;
  if (metric(ad.metrics_ctr) > 0 && metric(ad.metrics_ctr) < 0.5) confidence += 0.05;
  return Math.min(confidence, 0.9);
}

function hasDateMismatch(campaign: OptimisationCampaignRow, text: string) {
  const eventDate = eventDateParts(campaign.source_snapshot ?? {});
  if (!eventDate) return false;

  const dates = extractTextDates(text);
  return dates.some((date) => date.day !== eventDate.day || date.month !== eventDate.month);
}

function extractTextDates(text: string) {
  const dates: Array<{ day: number; month: number }> = [];
  for (const match of text.matchAll(TEXT_DATE_PATTERN)) {
    const day = Number(match[1]);
    const month = monthNumber(match[2]);
    if (Number.isFinite(day) && month) dates.push({ day, month });
  }
  return dates;
}

function eventDateParts(snapshot: Record<string, unknown>) {
  const value = stringValue(snapshot.eventDate) ?? stringValue(snapshot.event_date);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    day: parsed.getDate(),
    month: parsed.getMonth() + 1,
  };
}

function monthNumber(value: string | undefined) {
  const key = value?.slice(0, 3).toLowerCase();
  if (!key) return null;
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[key] ?? null;
}

function formatEventDateForCopy(snapshot: Record<string, unknown>) {
  const value = stringValue(snapshot.eventDate) ?? stringValue(snapshot.event_date);
  return value ? formatGuestDate(value, { includeYear: false }) : null;
}

function hasCashOnArrivalContext(campaign: OptimisationCampaignRow) {
  const snapshot = campaign.source_snapshot ?? {};
  const mode = stringValue(snapshot.paymentMode) ?? stringValue(snapshot.payment_mode);
  if (mode === 'cash_only') return true;
  const text = `${campaign.problem_brief ?? ''} ${stringValue(snapshot.managementPrompt) ?? ''}`;
  return PAY_ON_ARRIVAL_PATTERN.test(text);
}

function numericSnapshotValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function formatPrice(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(2);
}

function buildBookingCopyDetail(
  campaign: OptimisationCampaignRow,
  snapshot: Record<string, unknown>,
  dateLabel: string | null,
  unitPrice: number | null,
) {
  const briefDetail = sanitiseCopyDetail(firstUsefulSentence(campaign.problem_brief ?? ''), dateLabel);
  if (briefDetail && !isWeakFallbackDetail(briefDetail)) return briefDetail;

  const eventTime = stringValue(snapshot.eventTime)
    ?? stringValue(snapshot.event_time)
    ?? stringValue(snapshot.startTime)
    ?? stringValue(snapshot.start_time);
  const formattedTime = eventTime ? formatDisplayTime(eventTime) : null;

  if (unitPrice !== null && formattedTime) {
    return `£${formatPrice(unitPrice)} per person, starts at ${formattedTime}.`;
  }
  if (unitPrice !== null) {
    return `£${formatPrice(unitPrice)} per person for the event.`;
  }
  if (formattedTime) {
    return `Starts at ${formattedTime}. Booking holds your table.`;
  }
  return 'Booking holds your table for the event.';
}

function sanitiseCopyDetail(value: string, dateLabel: string | null) {
  if (!value.trim()) return '';
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(ISO_DATE_PATTERN, dateLabel ?? '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

function isWeakFallbackDetail(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes('table, tickets, or seats') ||
    lower.includes('sorted before the day') ||
    lower.includes('reserve your spot now so') ||
    lower.includes('before spaces go')
  );
}

function formatGuestDate(value: string, options: { includeYear: boolean }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(options.includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'Europe/London',
  }).formatToParts(parsed);

  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  return [weekday, day, month, options.includeYear ? year : null].filter(Boolean).join(' ');
}

function formatDisplayTime(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return trimmed;
  }

  const suffix = hour >= 12 ? 'pm' : 'am';
  const displayHour = hour % 12 || 12;
  return minute === 0 ? `${displayHour}${suffix}` : `${displayHour}:${String(minute).padStart(2, '0')}${suffix}`;
}

function firstUsefulSentence(value: string) {
  return value
    .split(/[.\n]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 20 && !/^imported from/i.test(part)) ?? '';
}

function compactCampaignName(value: string) {
  return value
    .replace(/\s*\|\s*.+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 36) || 'your booking';
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max - 1).trimEnd();
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced).trimEnd()}…`;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normaliseComparable(value: string | null | undefined) {
  return value?.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '') ?? '';
}

function utmValue(value: string | null | undefined, key: string) {
  if (!value) return null;
  try {
    return new URL(value).searchParams.get(key);
  } catch {
    return null;
  }
}

function metric(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
