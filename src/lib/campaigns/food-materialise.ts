import { DateTime } from 'luxon';

import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  setMetaObjectStatus,
  uploadMetaImage,
} from '@/lib/meta/marketing';
import { computeAdSetSpendCaps } from '@/lib/campaigns/food-budget-weighting';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import { toLondonDateTime } from '@/lib/campaigns/time-utils';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { logPublishAuditEvent } from '@/lib/publishing/audit';
import { buildConversionReadiness } from '@/lib/campaigns/conversion-readiness';
import { featureFlags } from '@/env';
import { MEDIA_BUCKET } from '@/lib/constants';
import { applyAdUtmContent } from '@/lib/campaigns/ad-attribution';
import type { FoodAdWindow, FoodBookingBrief } from '@/types/campaigns';

/**
 * Phase 3 (3c) — weekly food-window materialisation.
 *
 * Extends an already-published rolling food_booking campaign by exactly one week of ad
 * windows. Two parts kept separate so the date logic is pure and unit-testable while the
 * Meta/DB side effects are isolated:
 *
 *  1. {@link selectNextWeekFoodWindows} — PURE. Given the campaign brief and the set of
 *     `service_date`s already materialised, returns the windows for the single next
 *     not-yet-materialised week. Idempotency lives here: any window whose `serviceDate`
 *     is already present is dropped, so a second run for the same week returns [].
 *
 *  2. {@link materialiseFoodWindowsForCampaign} — SIDE-EFFECTING. Persists ad_set + ad rows
 *     for those windows and creates the matching Meta objects, reusing the exact Meta client
 *     sequence from publishCampaign (upload image → creative → ad), applying PR9 CBO spend
 *     caps when the food optimisation flag is on.
 *
 * No `Date.now()`/`new Date()` inside the pure logic — the reference timestamp is passed in.
 * See docs/plans/2026-06-09-food-booking-phase-3-optimisation-spec.md §5 (3c), P3-4, P3-7.
 */

const ZONE = 'Europe/London';
type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

/** The ISO week label (`YYYY-Www`) for a UTC instant, in the London calendar. */
export function isoWeekLabel(referenceIso: string): string {
  const dt = DateTime.fromISO(referenceIso, { zone: ZONE });
  const base = dt.isValid ? dt : DateTime.now().setZone(ZONE);
  return `${base.weekYear}-W${String(base.weekNumber).padStart(2, '0')}`;
}

export interface SelectNextWeekInput {
  brief: FoodBookingBrief;
  /** Calendar start date the campaign's windows are anchored to ('YYYY-MM-DD'). */
  campaignStartDate: string;
  /** `service_date`s ('YYYY-MM-DD') already represented by existing ad sets. */
  existingServiceDates: ReadonlySet<string>;
  /**
   * Reference instant (UTC ISO) the run is keyed to — normally the cron run time. The target
   * week is derived deterministically from this, so two runs in the same ISO week resolve to
   * the same week (idempotency). Pure: no `Date.now()` is read here.
   */
  referenceIso: string;
  /**
   * Pre-publish per-window toggles keyed by windowKey (mirrors create-time `windowOverrides`).
   * Overrides each window template's default `enabled`.
   */
  windowOverrides?: Record<string, boolean>;
}

/**
 * Compute the windows for the single target week this run should materialise. Pure +
 * deterministic — and idempotent across reruns in the same ISO week.
 *
 * The target week keeps the campaign materialised the brief's rolling `weeks` ahead of the
 * reference week: target = the service week starting `(referenceWeekStart + weeks)`. Because
 * this depends only on `referenceIso` (not on what's already materialised), running twice in
 * the same week resolves to the SAME week — and after the first run fills it, the
 * already-materialised `service_date` filter drops every window, so the second run returns [].
 */
export function selectNextWeekFoodWindows(input: SelectNextWeekInput): FoodAdWindow[] {
  const { brief, campaignStartDate, existingServiceDates, referenceIso, windowOverrides } = input;

  const reference = DateTime.fromISO(referenceIso, { zone: ZONE });
  if (!reference.isValid) return [];

  // Deterministic target service week: `weeks` ahead of the reference week start (Monday).
  const targetWeekStart = reference.startOf('week').plus({ weeks: brief.weeks });
  const targetWeekEndExclusive = targetWeekStart.plus({ weeks: 1 });

  // Anchor window generation to the campaign start so templates/days stay consistent, but
  // generate a wide horizon so the target week is always covered regardless of how far ahead
  // it sits. `calculateFoodBookingPhases` is bounded by `brief.weeks`, so widen a brief copy
  // to span from the campaign start through the target week.
  const start = DateTime.fromISO(campaignStartDate, { zone: ZONE }).startOf('day');
  const weeksToCover = start.isValid
    ? Math.ceil(targetWeekEndExclusive.diff(start, 'weeks').weeks) + 1
    : brief.weeks + 1;
  const horizonBrief: FoodBookingBrief = {
    ...brief,
    weeks: Math.max(1, weeksToCover) as FoodBookingBrief['weeks'],
  };

  const allWindows = calculateFoodBookingPhases(horizonBrief, campaignStartDate);

  return allWindows.filter((window) => {
    const enabled = windowOverrides?.[window.windowKey] ?? window.enabled;
    if (!enabled) return false;
    // Idempotency: never re-create a window whose service date already exists.
    if (existingServiceDates.has(window.serviceDate)) return false;
    const serviceDate = DateTime.fromISO(window.serviceDate, { zone: ZONE });
    return serviceDate >= targetWeekStart && serviceDate < targetWeekEndExclusive;
  });
}

// ---------------------------------------------------------------------------
// Side-effecting materialisation
// ---------------------------------------------------------------------------

interface MaterialiseCampaignRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  name: string;
  budget_amount: number;
  campaign_kind: string | null;
  status: string;
  destination_url: string | null;
  source_snapshot: Record<string, unknown> | null;
}

interface MaterialiseAdRow {
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  creative_brief: string | null;
  angle: string | null;
  creative_format: string | null;
  creative_variant_key: string | null;
  media_asset_id: string | null;
}

interface MaterialiseAdSetRow {
  id: string;
  meta_adset_id: string | null;
  service_key: string | null;
  decision_stage: string | null;
  phase_start: string | null;
  targeting: Record<string, unknown>;
  placements: unknown;
  optimisation_goal: string;
  bid_strategy: string;
  adset_media_asset_id: string | null;
  ads: MaterialiseAdRow[];
}

export interface MaterialiseResult {
  /** Number of ad sets created on Meta this run (0 when nothing new / nothing to do). */
  created: number;
  /** `service_date`s that were materialised this run (for logging). */
  serviceDates: string[];
}

export interface MaterialiseOptions {
  campaignId: string;
  /** Reference instant (UTC ISO) the run is keyed to; used only for the ISO-week audit label. */
  referenceIso: string;
  supabase?: SupabaseClientLike;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseBrief(snapshot: Record<string, unknown> | null): FoodBookingBrief | null {
  const brief = asRecord(snapshot?.brief);
  if (!brief || !Array.isArray(brief.services) || typeof brief.weeks !== 'number') return null;
  return brief as unknown as FoodBookingBrief;
}

function windowOverridesFrom(snapshot: Record<string, unknown> | null): Record<string, boolean> {
  const overrides = asRecord(snapshot?.windowOverrides);
  if (!overrides) return {};
  return Object.entries(overrides).reduce<Record<string, boolean>>((acc, [key, value]) => {
    if (typeof value === 'boolean') acc[key] = value;
    return acc;
  }, {});
}

function serviceBookingUrlsFrom(snapshot: Record<string, unknown> | null): Record<string, string> {
  const urls = asRecord(snapshot?.serviceBookingUrls);
  if (!urls) return {};
  return Object.entries(urls).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim()) acc[key] = value.trim();
    return acc;
  }, {});
}

/** Build a window-scoped utm_content key (matches the create-time scheme prefix). */
function buildWindowUtmContentKey(window: FoodAdWindow, index: number): string {
  return `${window.windowKey}-${window.runDate}-ad-${index + 1}`.slice(0, 160);
}

/**
 * Resolve the per-window booking link, preferring a service-specific URL, falling back to the
 * campaign destination, with the window's utm_content appended for Phase-2 attribution.
 */
function resolveLinkUrl(
  campaign: MaterialiseCampaignRow,
  serviceKey: string | null,
  utmContentKey: string,
): string {
  const serviceUrls = serviceBookingUrlsFrom(campaign.source_snapshot);
  const base = (serviceKey && serviceUrls[serviceKey]) || campaign.destination_url || '';
  return applyAdUtmContent(base, utmContentKey);
}

/**
 * Materialise the next week of windows for one rolling food campaign.
 *
 * Idempotent: the not-yet-materialised week is computed by {@link selectNextWeekFoodWindows}
 * against the campaign's existing ad-set `service_date`s, so a re-run for the same week creates
 * nothing. Each new window becomes one ad set (cloning the window-stable copy + creative asset
 * from the most recent existing ad set of the same service_key/decision_stage) plus its ads,
 * created PAUSED then activated — the same Meta sequence publishCampaign uses.
 *
 * Returns `{ created: 0 }` (no Meta calls) when the campaign is not an active, published
 * food_booking campaign, when its brief is missing, or when there is no new week to add.
 */
export async function materialiseFoodWindowsForCampaign(
  options: MaterialiseOptions,
): Promise<MaterialiseResult> {
  const supabase = options.supabase ?? createServiceSupabaseClient();
  const empty: MaterialiseResult = { created: 0, serviceDates: [] };

  const { data: campaign, error: campaignError } = await supabase
    .from('meta_campaigns')
    .select(
      'id, account_id, meta_campaign_id, name, budget_amount, campaign_kind, status, destination_url, source_snapshot',
    )
    .eq('id', options.campaignId)
    .maybeSingle<MaterialiseCampaignRow>();

  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) throw new Error('Campaign not found.');

  // Only act on active, published food_booking campaigns. Anything else is a safe no-op.
  if (campaign.campaign_kind !== 'food_booking') return empty;
  if (campaign.status !== 'ACTIVE' || !campaign.meta_campaign_id) return empty;

  const brief = parseBrief(campaign.source_snapshot);
  if (!brief) return empty;

  // Load existing ad sets to (a) detect already-materialised service_dates (idempotency) and
  // (b) clone window-stable copy/creative from the matching service window.
  const adSetsResult = await supabase
    .from('ad_sets')
    .select(
      'id, meta_adset_id, service_key, decision_stage, phase_start, targeting, placements, optimisation_goal, bid_strategy, adset_media_asset_id, ads(name, headline, primary_text, description, cta, creative_brief, angle, creative_format, creative_variant_key, media_asset_id)',
    )
    .eq('campaign_id', campaign.id);

  const existingAdSets: MaterialiseAdSetRow[] = Array.isArray(adSetsResult?.data)
    ? (adSetsResult.data as unknown as MaterialiseAdSetRow[])
    : [];

  // The brief's foodSchedule offsets serviceDate from runDate, but the persisted ad sets only
  // carry phase_start (= runDate) + service metadata. Reconstruct the materialised service_dates
  // by re-deriving the schedule and matching each existing ad set's (service_key, phase_start)
  // back to a window — this keeps the idempotency key aligned with how windows are generated.
  const existingServiceDates = deriveExistingServiceDates(brief, campaign, existingAdSets);

  const newWindows = selectNextWeekFoodWindows({
    brief,
    campaignStartDate: resolveCampaignStartDate(brief, campaign, existingAdSets),
    existingServiceDates,
    referenceIso: options.referenceIso,
    windowOverrides: windowOverridesFrom(campaign.source_snapshot),
  });

  if (newWindows.length === 0) return empty;

  // Fetch the Meta credentials + page once for the whole batch.
  const credentials = await loadMetaCredentials(supabase, campaign.account_id);

  // Phase 3 (3b): derive per-ad-set CBO spend caps from each window's weight, when the food
  // optimisation flag is on. Computed up-front so its preflight (floored minimums must fit the
  // campaign budget) aborts before any Meta object is created.
  const spendCaps = computeSpendCaps(newWindows, Number(campaign.budget_amount));
  if (spendCaps.error) throw new Error(spendCaps.error);

  const createdServiceDates: string[] = [];
  let created = 0;

  for (const window of newWindows) {
    const template = pickTemplateAdSet(existingAdSets, window);
    const metaAdSetId = await materialiseSingleWindow({
      supabase,
      campaign,
      window,
      template,
      credentials,
      cap: spendCaps.byWindowKey.get(window.windowKey),
    });
    if (metaAdSetId) {
      created += 1;
      createdServiceDates.push(window.serviceDate);
    }
  }

  if (created > 0) {
    await logPublishAuditEvent({
      accountId: campaign.account_id,
      operationType: 'state_transition',
      resourceType: 'content_item',
      resourceId: campaign.id,
      details: {
        action: 'materialise_food_windows',
        isoWeek: isoWeekLabel(options.referenceIso),
        created,
        serviceDates: createdServiceDates,
      },
    });
  }

  return { created, serviceDates: createdServiceDates };
}

// ---------------------------------------------------------------------------
// Helpers (side-effecting bits split out for readability + testing focus)
// ---------------------------------------------------------------------------

interface MetaCredentials {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  /** OFFSITE_CONVERSIONS promoted_object (pixel + Purchase) when conversion tracking is ready. */
  promotedObject?: Record<string, unknown>;
}

async function loadMetaCredentials(
  supabase: SupabaseClientLike,
  accountId: string,
): Promise<MetaCredentials> {
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select(
      'access_token, meta_account_id, token_expires_at, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled',
    )
    .eq('account_id', accountId)
    .maybeSingle<{
      access_token: string | null;
      meta_account_id: string | null;
      token_expires_at: string | null;
      meta_pixel_id: string | null;
      conversion_event_name: string | null;
      conversion_optimisation_enabled: boolean | null;
    }>();

  if (!adAccount?.access_token || !adAccount.meta_account_id) {
    throw new Error('Meta Ads account not connected.');
  }
  if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) {
    throw new Error('Your Meta Ads token has expired. Please reconnect your Meta Ads account.');
  }

  const { data: fbConnection } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', accountId)
    .eq('provider', 'facebook')
    .maybeSingle<{ metadata: { pageId?: string } | null }>();

  const pageId = fbConnection?.metadata?.pageId;
  if (!pageId) throw new Error('Facebook Page not connected.');

  // food_booking ad sets run on OFFSITE_CONVERSIONS, which Meta requires a promoted_object for.
  // Booking conversion setup is enforced at publish; if it has since lapsed we still create the
  // ad set without the promoted object rather than block the rolling extension.
  const readiness = buildConversionReadiness(adAccount);
  const promotedObject = readiness.ready && readiness.pixelId
    ? { pixel_id: readiness.pixelId, custom_event_type: 'PURCHASE' as const }
    : undefined;

  return {
    accessToken: adAccount.access_token,
    adAccountId: adAccount.meta_account_id,
    pageId,
    promotedObject,
  };
}

/** Re-derive which service_dates are already covered by existing ad sets. */
function deriveExistingServiceDates(
  brief: FoodBookingBrief,
  campaign: MaterialiseCampaignRow,
  existingAdSets: MaterialiseAdSetRow[],
): Set<string> {
  const startDate = resolveCampaignStartDate(brief, campaign, existingAdSets);
  // Generate a wide horizon so every existing ad set can be matched back to a window.
  const horizonBrief: FoodBookingBrief = {
    ...brief,
    weeks: Math.min(8, brief.weeks + 4) as FoodBookingBrief['weeks'],
  };
  const windows = calculateFoodBookingPhases(horizonBrief, startDate);

  // Map (service_key|run_date) -> serviceDate so a stored ad set resolves to its service date.
  const byRunKey = new Map<string, string>();
  for (const window of windows) {
    byRunKey.set(`${window.serviceKey}|${window.runDate}`, window.serviceDate);
  }

  const dates = new Set<string>();
  for (const adSet of existingAdSets) {
    if (!adSet.service_key || !adSet.phase_start) continue;
    const serviceDate = byRunKey.get(`${adSet.service_key}|${adSet.phase_start}`);
    if (serviceDate) dates.add(serviceDate);
  }
  return dates;
}

/**
 * The calendar date windows are anchored to. The persisted foodSchedule snapshot records the
 * original windows; its earliest runDate is the anchor. Falls back to the earliest existing
 * ad-set phase_start, then to today is avoided — we require a deterministic anchor.
 */
function resolveCampaignStartDate(
  _brief: FoodBookingBrief,
  campaign: MaterialiseCampaignRow,
  existingAdSets: MaterialiseAdSetRow[],
): string {
  const schedule = campaign.source_snapshot?.foodSchedule;
  if (Array.isArray(schedule)) {
    const runDates = schedule
      .map((entry) => (asRecord(entry)?.runDate as string | undefined))
      .filter((value): value is string => typeof value === 'string');
    if (runDates.length > 0) return runDates.sort((a, b) => a.localeCompare(b))[0]!;
  }

  const phaseStarts = existingAdSets
    .map((adSet) => adSet.phase_start)
    .filter((value): value is string => typeof value === 'string');
  if (phaseStarts.length > 0) return phaseStarts.sort((a, b) => a.localeCompare(b))[0]!;

  throw new Error('Cannot resolve a campaign start date to materialise windows.');
}

/** Choose an existing ad set to clone copy + creative from for a new window. */
function pickTemplateAdSet(
  existingAdSets: MaterialiseAdSetRow[],
  window: FoodAdWindow,
): MaterialiseAdSetRow | null {
  const exact = existingAdSets.find(
    (adSet) => adSet.service_key === window.serviceKey && adSet.decision_stage === window.decisionStage,
  );
  if (exact) return exact;
  const sameService = existingAdSets.find((adSet) => adSet.service_key === window.serviceKey);
  return sameService ?? existingAdSets[0] ?? null;
}

function computeSpendCaps(
  windows: FoodAdWindow[],
  campaignBudget: number,
): { byWindowKey: Map<string, { minBudget: number; maxBudget: number }>; error?: string } {
  const byWindowKey = new Map<string, { minBudget: number; maxBudget: number }>();
  if (!featureFlags.foodOptimisation) return { byWindowKey };

  const result = computeAdSetSpendCaps({
    adSets: windows.map((window) => ({ ref: window.windowKey, budgetWeight: window.budgetWeight })),
    campaignBudget,
  });
  if (result.error) return { byWindowKey, error: result.error };
  for (const cap of result.caps) {
    byWindowKey.set(cap.adSetRef, { minBudget: cap.minBudget, maxBudget: cap.maxBudget });
  }
  return { byWindowKey };
}

interface MaterialiseSingleWindowArgs {
  supabase: SupabaseClientLike;
  campaign: MaterialiseCampaignRow;
  window: FoodAdWindow;
  template: MaterialiseAdSetRow | null;
  credentials: MetaCredentials;
  cap?: { minBudget: number; maxBudget: number };
}

/**
 * Create one ad set (+ its ads) on Meta for a single new window and persist the rows. Returns
 * the created Meta ad-set id, or null if there was nothing to create (no template to clone).
 */
async function materialiseSingleWindow(args: MaterialiseSingleWindowArgs): Promise<string | null> {
  const { supabase, campaign, window, template, credentials, cap } = args;
  if (!template) return null;

  const adSetName = `${campaign.name} — ${window.windowKey} — ${window.runDate}`;

  // 1. Persist the ad_set row (DRAFT until Meta confirms), mirroring the create path columns.
  const { data: adSetRow, error: adSetError } = await supabase
    .from('ad_sets')
    .insert({
      campaign_id: campaign.id,
      name: adSetName,
      phase_start: window.runDate,
      phase_end: window.runDate,
      ads_start_time: window.startsAtLocal,
      ads_stop_time: window.endsAtLocal,
      service_key: window.serviceKey,
      decision_stage: window.decisionStage,
      budget_weight: window.budgetWeight,
      targeting: template.targeting,
      placements: template.placements,
      optimisation_goal: template.optimisation_goal,
      bid_strategy: template.bid_strategy,
      adset_media_asset_id: template.adset_media_asset_id,
      status: 'DRAFT',
    })
    .select('id')
    .single<{ id: string }>();

  if (adSetError) throw new Error(adSetError.message);
  if (!adSetRow) throw new Error('Ad set insert returned no data.');

  // 2. Create the Meta ad set (PAUSED). food_booking uses campaign-level CBO, so no per-ad-set
  //    budget is sent; PR9 caps (when present) ride along under the CBO flag. When conversion
  //    tracking is ready, force OFFSITE_CONVERSIONS + the pixel promoted object (matching
  //    publishCampaign); otherwise fall back to the template's stored optimisation goal.
  const metaAdSet = await createMetaAdSet({
    accessToken: credentials.accessToken,
    adAccountId: credentials.adAccountId,
    campaignId: campaign.meta_campaign_id!,
    name: adSetName,
    targeting: template.targeting,
    optimisationGoal: credentials.promotedObject ? 'OFFSITE_CONVERSIONS' : template.optimisation_goal,
    bidStrategy: template.bid_strategy,
    startTime: toLondonDateTime(window.runDate, window.startsAtLocal),
    endTime: toLondonDateTime(window.runDate, window.endsAtLocal),
    status: 'PAUSED',
    promotedObject: credentials.promotedObject,
    parentUsesCampaignBudgetOptimization: cap ? true : undefined,
    minBudget: cap?.minBudget,
    maxBudget: cap?.maxBudget,
  });

  await supabase
    .from('ad_sets')
    .update({
      meta_adset_id: metaAdSet.id,
      status: 'ACTIVE',
      meta_status: 'ACTIVE',
    })
    .eq('id', adSetRow.id);

  const metaAdIds: string[] = [];

  // 3. Create each ad: persist the row, upload the creative image, build the creative, create
  //    the ad. Reuses the template ads' window-stable copy (re-running AI in a worker would be
  //    heavy + non-deterministic; the copy is stable per window).
  for (const [index, ad] of template.ads.entries()) {
    const utmContentKey = buildWindowUtmContentKey(window, index);
    const effectiveAssetId = ad.media_asset_id ?? template.adset_media_asset_id;
    if (!effectiveAssetId) continue;

    const { data: adRow, error: adInsertError } = await supabase
      .from('ads')
      .insert({
        adset_id: adSetRow.id,
        name: ad.name,
        headline: ad.headline,
        primary_text: ad.primary_text,
        description: ad.description,
        cta: ad.cta,
        creative_brief: ad.creative_brief,
        angle: ad.angle,
        creative_format: ad.creative_format,
        creative_variant_key: ad.creative_variant_key,
        utm_content_key: utmContentKey,
        media_asset_id: ad.media_asset_id,
        status: 'DRAFT',
      })
      .select('id')
      .single<{ id: string }>();

    if (adInsertError) throw new Error(adInsertError.message);
    if (!adRow) throw new Error('Ad insert returned no data.');

    const { data: assetRow } = await supabase
      .from('media_assets')
      .select('storage_path')
      .eq('id', effectiveAssetId)
      .single<{ storage_path: string }>();

    if (!assetRow?.storage_path) throw new Error(`Creative asset is missing for ad "${ad.name}".`);

    const storagePath = assetRow.storage_path.startsWith(`${MEDIA_BUCKET}/`)
      ? assetRow.storage_path.slice(MEDIA_BUCKET.length + 1)
      : assetRow.storage_path;

    const { data: signed, error: signError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storagePath, 300);

    if (signError || !signed?.signedUrl) {
      throw new Error(`Could not prepare creative asset for ad "${ad.name}".`);
    }

    const { hash: imageHash } = await uploadMetaImage(
      credentials.adAccountId,
      credentials.accessToken,
      signed.signedUrl,
    );

    const creative = await createMetaAdCreative({
      accessToken: credentials.accessToken,
      adAccountId: credentials.adAccountId,
      name: ad.name,
      pageId: credentials.pageId,
      linkUrl: resolveLinkUrl(campaign, window.serviceKey, utmContentKey),
      imageHash,
      message: ad.primary_text,
      headline: ad.headline,
      description: ad.description,
      // food_booking always forces BOOK_NOW (it is a booking flow), matching publishCampaign.
      callToActionType: 'BOOK_NOW',
    });

    await supabase.from('ads').update({ meta_creative_id: creative.id }).eq('id', adRow.id);

    const metaAd = await createMetaAd({
      accessToken: credentials.accessToken,
      adAccountId: credentials.adAccountId,
      name: ad.name,
      adsetId: metaAdSet.id,
      creativeId: creative.id,
      status: 'ACTIVE',
    });

    await supabase
      .from('ads')
      .update({ meta_ad_id: metaAd.id, status: 'ACTIVE', meta_status: 'ACTIVE' })
      .eq('id', adRow.id);

    metaAdIds.push(metaAd.id);
  }

  // 4. Activate the ads then the ad set (created PAUSED while the tree was incomplete).
  for (const metaAdId of metaAdIds) {
    await setMetaObjectStatus(metaAdId, credentials.accessToken, 'ACTIVE');
  }
  await setMetaObjectStatus(metaAdSet.id, credentials.accessToken, 'ACTIVE');

  return metaAdSet.id;
}
