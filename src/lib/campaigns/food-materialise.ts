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
import {
  buildConversionReadiness,
  type ConversionReadiness,
} from '@/lib/campaigns/conversion-readiness';
import { featureFlags } from '@/env';
import { MEDIA_BUCKET } from '@/lib/constants';
import { applyAdUtmContent } from '@/lib/campaigns/ad-attribution';
import { createLogger } from '@/lib/logging';
import type { FoodAdWindow, FoodBookingBrief } from '@/types/campaigns';

/**
 * Phase 3 (3c) — weekly food-window materialisation.
 *
 * Extends an already-published rolling food_booking campaign by exactly one week of ad
 * windows. Two parts kept separate so the date logic is pure and unit-testable while the
 * Meta/DB side effects are isolated:
 *
 *  1. {@link selectNextWeekFoodWindows} — PURE. Given the campaign brief and the set of
 *     window occurrences already materialised, returns the windows for the single next
 *     not-yet-materialised week. Idempotency lives here: any window whose occurrence key
 *     (service_key | decision_stage | run_date) is already present is dropped, so a second
 *     run for the same week returns [] — and a partially-failed week re-creates ONLY the
 *     missing windows (F2).
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

const logger = createLogger('food-materialise');

/** The ISO week label (`YYYY-Www`) for a UTC instant, in the London calendar. */
export function isoWeekLabel(referenceIso: string): string {
  const dt = DateTime.fromISO(referenceIso, { zone: ZONE });
  const base = dt.isValid ? dt : DateTime.now().setZone(ZONE);
  return `${base.weekYear}-W${String(base.weekNumber).padStart(2, '0')}`;
}

/**
 * Identity of one concrete window occurrence: which window template ran on which date.
 * Matches the persisted ad-set columns exactly (`service_key`, `decision_stage`,
 * `phase_start` = runDate), so existing rows translate to keys with no reconstruction —
 * regardless of how far the campaign has rolled (F6) — and idempotency is per-WINDOW, so a
 * partially-materialised week recovers its missing windows instead of being skipped (F2).
 */
export function foodWindowOccurrenceKey(
  serviceKey: string,
  decisionStage: string,
  runDate: string,
): string {
  return `${serviceKey}|${decisionStage}|${runDate}`;
}

export interface SelectNextWeekInput {
  brief: FoodBookingBrief;
  /** Calendar start date the campaign's windows are anchored to ('YYYY-MM-DD'). */
  campaignStartDate: string;
  /**
   * Occurrence keys ({@link foodWindowOccurrenceKey}) of windows already FULLY materialised
   * by existing ad sets. Incomplete remnants of failed runs must be excluded by the caller.
   */
  existingWindowKeys: ReadonlySet<string>;
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
 * already-materialised occurrence-key filter drops every window, so the second run returns [].
 * If the first run only partially filled the week, exactly the missing windows return (F2).
 */
export function selectNextWeekFoodWindows(input: SelectNextWeekInput): FoodAdWindow[] {
  const { brief, campaignStartDate, existingWindowKeys, referenceIso, windowOverrides } = input;

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
    // Idempotency: never re-create a window occurrence that is already fully materialised.
    const key = foodWindowOccurrenceKey(window.serviceKey, window.decisionStage, window.runDate);
    if (existingWindowKeys.has(key)) return false;
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
  /** Number of ad sets fully created AND activated this run (0 when nothing new to do). */
  created: number;
  /** `service_date`s that were materialised this run (for logging). */
  serviceDates: string[];
  /**
   * F5: windowKeys whose ad set was created but left PAUSED (local + Meta) because the
   * template had no usable media — a live empty ad set must never be activated.
   */
  skippedNoMedia: string[];
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
 * Idempotent per WINDOW: the not-yet-materialised occurrences are computed by
 * {@link selectNextWeekFoodWindows} against the campaign's existing COMPLETE ad sets (F2: a
 * row only counts once it has a `meta_adset_id` AND at least one ad row), so a re-run for the
 * same week creates nothing — and a run that previously failed mid-window cleans up the
 * incomplete remnant and recreates that window whole. Each new window becomes one ad set
 * (cloning the window-stable copy + creative asset from the most recent complete ad set of the
 * same service_key/decision_stage) plus its ads, created PAUSED then activated — the same Meta
 * sequence publishCampaign uses.
 *
 * Returns `{ created: 0 }` (no Meta calls) when the campaign is not an active, published
 * food_booking campaign, when its brief is missing, or when there is no new week to add.
 */
export async function materialiseFoodWindowsForCampaign(
  options: MaterialiseOptions,
): Promise<MaterialiseResult> {
  const supabase = options.supabase ?? createServiceSupabaseClient();
  const empty: MaterialiseResult = { created: 0, serviceDates: [], skippedNoMedia: [] };

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

  // F2: only COMPLETE rows (Meta ad set created AND ≥1 ad persisted) count as materialised.
  // Incomplete remnants of a previously-failed run are excluded here so their windows are
  // re-selected, then cleaned up and recreated below.
  const completeAdSets = existingAdSets.filter(isCompleteAdSet);

  // F6: existing occurrences come straight from the rows' own (service_key, decision_stage,
  // phase_start) — no schedule reconstruction and no generation horizon, so rolling campaigns
  // stay idempotent no matter how far they have advanced past the campaign anchor.
  const existingWindowKeys = deriveExistingWindowKeys(completeAdSets);

  const newWindows = selectNextWeekFoodWindows({
    brief,
    campaignStartDate: resolveCampaignStartDate(brief, campaign, existingAdSets),
    existingWindowKeys,
    referenceIso: options.referenceIso,
    windowOverrides: windowOverridesFrom(campaign.source_snapshot),
  });

  if (newWindows.length === 0) return empty;

  // Fetch the Meta credentials + page once for the whole batch.
  const credentials = await loadMetaCredentials(supabase, campaign.account_id);

  // F4: food ads REQUIRE booking-conversion readiness (pixel + Purchase event), exactly as the
  // publish gate enforces. If it has lapsed since publish, refuse to create ANYTHING — never
  // fall back to a weaker optimisation goal. The throw surfaces as a worker 500, so the run is
  // retried by QStash and lands in the DLQ if readiness stays broken, instead of silently
  // degrading live spend.
  if (!credentials.readiness.ready || !credentials.readiness.pixelId) {
    logger.error('Booking conversion readiness lost; refusing to materialise food windows', undefined, {
      campaignId: campaign.id,
      issues: credentials.readiness.issues,
    });
    await logPublishAuditEvent({
      accountId: campaign.account_id,
      operationType: 'publish_failure',
      resourceType: 'content_item',
      resourceId: campaign.id,
      details: {
        action: 'materialise_food_windows_blocked',
        reason: 'conversion_not_ready',
        issues: credentials.readiness.issues,
        isoWeek: isoWeekLabel(options.referenceIso),
      },
    });
    throw new Error(
      'Booking conversion tracking is no longer ready for this account; food windows were not materialised.',
    );
  }

  const promotedObject: Record<string, unknown> = {
    pixel_id: credentials.readiness.pixelId,
    custom_event_type: 'PURCHASE',
  };

  // Phase 3 (3b): derive per-ad-set CBO spend caps from each window's weight, when the food
  // optimisation flag is on. Computed up-front so its preflight (floored minimums must fit the
  // campaign budget) aborts before any Meta object is created.
  const spendCaps = computeSpendCaps(newWindows, Number(campaign.budget_amount));
  if (spendCaps.error) throw new Error(spendCaps.error);

  const createdServiceDates: string[] = [];
  const skippedNoMedia: string[] = [];
  let created = 0;

  for (const window of newWindows) {
    // F2: a previously-failed run can have left an INCOMPLETE row for this exact window
    // (insert succeeded, Meta creation or ad persistence did not). Remove it — after
    // best-effort pausing any Meta remnant — so the window is recreated whole.
    await cleanupIncompleteAdSetsForWindow({
      supabase,
      accessToken: credentials.accessToken,
      existingAdSets,
      window,
      campaignId: campaign.id,
    });

    // Clone only from COMPLETE ad sets — an incomplete remnant has no ads to copy.
    const template = pickTemplateAdSet(completeAdSets, window);
    const outcome = await materialiseSingleWindow({
      supabase,
      campaign,
      window,
      template,
      credentials,
      promotedObject,
      cap: spendCaps.byWindowKey.get(window.windowKey),
    });
    if (outcome.status === 'created') {
      created += 1;
      createdServiceDates.push(window.serviceDate);
    } else if (outcome.status === 'skipped_no_media') {
      skippedNoMedia.push(window.windowKey);
    }
  }

  if (created > 0 || skippedNoMedia.length > 0) {
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
        skippedNoMedia,
      },
    });
  }

  return { created, serviceDates: createdServiceDates, skippedNoMedia };
}

// ---------------------------------------------------------------------------
// Helpers (side-effecting bits split out for readability + testing focus)
// ---------------------------------------------------------------------------

interface MetaCredentials {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  /** F4: conversion readiness re-checked at materialise time. The caller gates on `.ready`. */
  readiness: ConversionReadiness;
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

  // F4: food_booking ad sets REQUIRE OFFSITE_CONVERSIONS with a pixel promoted_object — the
  // same gate publishCampaign enforces. Readiness is re-checked here and the caller refuses to
  // materialise when it has lapsed; there is deliberately NO fallback optimisation goal.
  const readiness = buildConversionReadiness(adAccount);

  return {
    accessToken: adAccount.access_token,
    adAccountId: adAccount.meta_account_id,
    pageId,
    readiness,
  };
}

/**
 * F2: an ad-set row only counts as a materialised window once BOTH the Meta object exists
 * (`meta_adset_id` persisted) and at least one ad row was created under it. Anything less is
 * the remnant of a failed run and must be cleaned up + recreated, never skipped.
 */
function isCompleteAdSet(adSet: MaterialiseAdSetRow): boolean {
  return Boolean(adSet.meta_adset_id) && Array.isArray(adSet.ads) && adSet.ads.length > 0;
}

/**
 * F6: translate complete ad-set rows straight into window occurrence keys. The columns are
 * exactly the window identity (phase_start stores the runDate), so no schedule reconstruction
 * — and therefore no generation horizon — is needed. Rows missing any identity column (non-food
 * or pre-food rows) are ignored.
 */
function deriveExistingWindowKeys(completeAdSets: MaterialiseAdSetRow[]): Set<string> {
  const keys = new Set<string>();
  for (const adSet of completeAdSets) {
    if (!adSet.service_key || !adSet.decision_stage || !adSet.phase_start) continue;
    keys.add(foodWindowOccurrenceKey(adSet.service_key, adSet.decision_stage, adSet.phase_start));
  }
  return keys;
}

/** Does this row claim the same window occurrence the run is about to materialise? */
function matchesWindowOccurrence(adSet: MaterialiseAdSetRow, window: FoodAdWindow): boolean {
  return (
    adSet.service_key === window.serviceKey &&
    adSet.decision_stage === window.decisionStage &&
    adSet.phase_start === window.runDate
  );
}

interface CleanupIncompleteArgs {
  supabase: SupabaseClientLike;
  accessToken: string;
  existingAdSets: MaterialiseAdSetRow[];
  window: FoodAdWindow;
  campaignId: string;
}

/**
 * F2: delete incomplete remnants of this window left by a previously-failed run, so the
 * window can be recreated whole. Any Meta remnant is paused first (best-effort — the local
 * delete must not be blocked by a Meta hiccup; the recreate run owns the window from here).
 * The delete itself is error-checked: losing it would leave the unique index (F7) blocking
 * the recreate.
 */
async function cleanupIncompleteAdSetsForWindow(args: CleanupIncompleteArgs): Promise<void> {
  const { supabase, accessToken, existingAdSets, window, campaignId } = args;
  const stale = existingAdSets.filter(
    (adSet) => !isCompleteAdSet(adSet) && matchesWindowOccurrence(adSet, window),
  );

  for (const remnant of stale) {
    if (remnant.meta_adset_id) {
      try {
        await setMetaObjectStatus(remnant.meta_adset_id, accessToken, 'PAUSED');
      } catch (error) {
        logger.warn('Could not pause Meta remnant of incomplete ad set; continuing cleanup', {
          campaignId,
          adSetId: remnant.id,
          metaAdSetId: remnant.meta_adset_id,
          windowKey: window.windowKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Local ad rows (if any) cascade with the ad-set row.
    const { error } = await supabase.from('ad_sets').delete().eq('id', remnant.id);
    if (error) throw new Error(error.message);

    logger.info('Cleaned up incomplete ad set before recreating its window', {
      campaignId,
      adSetId: remnant.id,
      windowKey: window.windowKey,
      runDate: window.runDate,
    });
  }
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

/**
 * Choose a COMPLETE existing ad set to clone copy + creative from for a new window.
 * Callers pass complete rows only — an incomplete remnant has no ads worth cloning.
 */
function pickTemplateAdSet(
  completeAdSets: MaterialiseAdSetRow[],
  window: FoodAdWindow,
): MaterialiseAdSetRow | null {
  const exact = completeAdSets.find(
    (adSet) => adSet.service_key === window.serviceKey && adSet.decision_stage === window.decisionStage,
  );
  if (exact) return exact;
  const sameService = completeAdSets.find((adSet) => adSet.service_key === window.serviceKey);
  return sameService ?? completeAdSets[0] ?? null;
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
  /** F4: pixel promoted_object — always present because the caller gates on readiness. */
  promotedObject: Record<string, unknown>;
  cap?: { minBudget: number; maxBudget: number };
}

/** What happened to one window this run. */
type WindowOutcome =
  | { status: 'created'; metaAdSetId: string }
  | { status: 'skipped_no_media' }
  | { status: 'skipped_no_template' }
  | { status: 'skipped_duplicate' };

/** PostgreSQL unique_violation — the F7 partial unique index rejecting a concurrent insert. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Create one ad set (+ its ads) on Meta for a single new window and persist the rows.
 *
 * F3: every DB write that records a Meta object id (or flips status) is error-checked — a
 * silent write failure would orphan live Meta objects from the local state. Throwing makes the
 * worker 500 so QStash retries; the F2 completeness rule makes that retry safe.
 *
 * F5: the ad set is created PAUSED and only activated once ≥1 ad was created under it.
 */
async function materialiseSingleWindow(args: MaterialiseSingleWindowArgs): Promise<WindowOutcome> {
  const { supabase, campaign, window, template, credentials, promotedObject, cap } = args;
  if (!template) return { status: 'skipped_no_template' };

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

  if (adSetError) {
    // F7: a concurrent same-week delivery won the race — the ad_sets_food_window_unique index
    // rejected this insert. The window is (being) materialised by the other run; skip it
    // gracefully instead of failing the whole batch. Nothing was created on Meta yet (the
    // insert precedes every Meta call for this window).
    if ((adSetError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      logger.info('Window already materialised by a concurrent run; skipping', {
        campaignId: campaign.id,
        windowKey: window.windowKey,
        runDate: window.runDate,
      });
      return { status: 'skipped_duplicate' };
    }
    throw new Error(adSetError.message);
  }
  if (!adSetRow) throw new Error('Ad set insert returned no data.');

  // 2. Create the Meta ad set (PAUSED). food_booking uses campaign-level CBO, so no per-ad-set
  //    budget is sent; PR9 caps (when present) ride along under the CBO flag. F4: always
  //    OFFSITE_CONVERSIONS + the pixel promoted object (matching publishCampaign) — the caller
  //    refuses to materialise at all when readiness has lapsed, so no fallback goal exists.
  const metaAdSet = await createMetaAdSet({
    accessToken: credentials.accessToken,
    adAccountId: credentials.adAccountId,
    campaignId: campaign.meta_campaign_id!,
    name: adSetName,
    targeting: template.targeting,
    optimisationGoal: 'OFFSITE_CONVERSIONS',
    bidStrategy: template.bid_strategy,
    startTime: toLondonDateTime(window.runDate, window.startsAtLocal),
    endTime: toLondonDateTime(window.runDate, window.endsAtLocal),
    status: 'PAUSED',
    promotedObject,
    parentUsesCampaignBudgetOptimization: cap ? true : undefined,
    minBudget: cap?.minBudget,
    maxBudget: cap?.maxBudget,
  });

  // Persist the Meta id immediately so a later failure leaves a traceable row; the status
  // stays DRAFT until the window is complete (F5 flips it at the end). F3: checked — losing
  // this write would orphan the Meta ad set invisibly.
  const { error: metaIdError } = await supabase
    .from('ad_sets')
    .update({ meta_adset_id: metaAdSet.id })
    .eq('id', adSetRow.id);
  if (metaIdError) throw new Error(metaIdError.message);

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

    // F3: checked — the creative id ties the local ad to its Meta creative.
    const { error: creativeUpdateError } = await supabase
      .from('ads')
      .update({ meta_creative_id: creative.id })
      .eq('id', adRow.id);
    if (creativeUpdateError) throw new Error(creativeUpdateError.message);

    const metaAd = await createMetaAd({
      accessToken: credentials.accessToken,
      adAccountId: credentials.adAccountId,
      name: ad.name,
      adsetId: metaAdSet.id,
      creativeId: creative.id,
      status: 'ACTIVE',
    });

    // F3: checked — without meta_ad_id the ad row is incomplete and untraceable.
    const { error: adUpdateError } = await supabase
      .from('ads')
      .update({ meta_ad_id: metaAd.id, status: 'ACTIVE', meta_status: 'ACTIVE' })
      .eq('id', adRow.id);
    if (adUpdateError) throw new Error(adUpdateError.message);

    metaAdIds.push(metaAd.id);
  }

  // F5: never activate an ad set that received no ads (no usable media on the template) — a
  // live empty ad set would burn budget delivering nothing. Leave it PAUSED on Meta (it was
  // created PAUSED) and record the same state locally.
  if (metaAdIds.length === 0) {
    const { error: pauseError } = await supabase
      .from('ad_sets')
      .update({ status: 'PAUSED', meta_status: 'PAUSED' })
      .eq('id', adSetRow.id);
    if (pauseError) throw new Error(pauseError.message);
    logger.warn('No usable media for window; ad set left PAUSED', {
      campaignId: campaign.id,
      adSetId: adSetRow.id,
      windowKey: window.windowKey,
      runDate: window.runDate,
    });
    return { status: 'skipped_no_media' };
  }

  // 4. Activate the ads then the ad set (created PAUSED while the tree was incomplete), then
  //    record the final state locally (F3: checked).
  for (const metaAdId of metaAdIds) {
    await setMetaObjectStatus(metaAdId, credentials.accessToken, 'ACTIVE');
  }
  await setMetaObjectStatus(metaAdSet.id, credentials.accessToken, 'ACTIVE');

  const { error: activateError } = await supabase
    .from('ad_sets')
    .update({ status: 'ACTIVE', meta_status: 'ACTIVE' })
    .eq('id', adSetRow.id);
  if (activateError) throw new Error(activateError.message);

  return { status: 'created', metaAdSetId: metaAdSet.id };
}
