/**
 * Adds one "walk in" challenger ad to each of the four weekday food campaigns for The Anchor
 * (tasks/SPEC-weekday-food-optimisation.md, section 7, C2).
 *
 * Real money and a live ad account sit behind this, so a run can be stopped and started again
 * at any point and never creates a duplicate:
 *   - progress is worked out from existing records (the ads row and the campaign snapshot),
 *     never from memory of an earlier run;
 *   - before anything is created on Meta, Meta is asked what already carries the challenger's
 *     name, and a single match is adopted rather than created again;
 *   - more than one match, locally or on Meta, stops the run for a person to decide.
 *
 * Every client is a parameter, so whole runs are tested with mocks. The script in
 * scripts/ops/add-weekday-challenger-ads.ts only parses arguments and wires the real clients.
 */
import { DateTime } from 'luxon';

import {
  buildAdUtmContentKey,
  buildCreativeVariantKey,
  normaliseCreativeFormat,
  normaliseUtmContentKey,
  uniqueAdUtmContentKey,
} from '@/lib/campaigns/ad-attribution';
import { resolveAdLinkUrl } from '@/lib/campaigns/ad-link';
import { collectManagementMetaAdVariants } from '@/lib/campaigns/management-tracking';
import { findRewriteCopyProblems } from '@/lib/campaigns/rewrite-copy';
import { DEFAULT_TIMEZONE, MEDIA_BUCKET } from '@/lib/constants';
import {
  ManagementApiError,
  type ManagementApiConfig,
  type ManagementMetaAdsLink,
  type ManagementMetaAdsLinkInput,
  type ManagementMetaAdsLinkVariant,
} from '@/lib/management-app/client';
import { getMetaAdAccountTokens } from '@/lib/meta/ad-account-tokens';
import {
  checkAdReview,
  checkCreativeCallToAction,
  checkCreativeEnhancementsOptedOut,
  MetaApiError,
  type CreateAdCreativeParams,
  type CreateAdParams,
  type MetaAdAccountSpendStatus,
  type MetaAdCreativeSummary,
  type MetaAdLaunchReadBack,
  type MetaAdSetAdSummary,
  type MetaCreativeLaunchReadBack,
} from '@/lib/meta/marketing';
import { redactMetaAccessTokens } from '@/lib/meta/redact';
import type { createServiceSupabaseClient } from '@/lib/supabase/service';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

// ─── Facts (tasks/RUNBOOK-weekday-food-campaign.md wins on ids) ──────────────────────────────

/** The Anchor's account row (tasks/ADS-PLAYBOOK-the-anchor.md, section 1). */
export const WEEKDAY_ACCOUNT_ID = '91fda684-2801-4abb-980e-f42cec017cef';
export const WEEKDAY_META_AD_ACCOUNT_ID = 'act_1640006396819878';
export const WEEKDAY_FACEBOOK_PAGE_ID = '628953850871830';
export const WEEKDAY_LANDING_PAGE_URL = 'https://www.the-anchor.pub/lunch-and-dinner';
export const WEEKDAY_SHORT_LINK_HOST = 'l.the-anchor.pub';
/** The last serving day of the flight; the ad sets stop at 00:00 UK time on 17 October 2026. */
export const WEEKDAY_FLIGHT_LAST_DAY = '2026-10-16';
/** The four campaign-level short codes. No ad uses them except Lunch A's paused rewrite. */
export const WEEKDAY_CAMPAIGN_LEVEL_SHORT_CODES = ['0ai0j0', 'eff8sa', 'hrfowp', '9sie8u'];
/** The Graph version the recorded creative features were read on (4 October 2026). */
export const CREATIVE_FEATURES_GRAPH_VERSION = 'v24.0';

export const CHALLENGER_AD_NAME = 'Evergreen Test | Walk in | Var 4';
export const CHALLENGER_ANGLE = 'Walk in';
/** As the originals (D7): the app sends BOOK_NOW, which Meta stores as BOOK_TRAVEL. */
export const CHALLENGER_CTA = 'BOOK_NOW';
export const CHALLENGER_CREATIVE_BRIEF =
  'Walk-in challenger (tasks/SPEC-weekday-food-optimisation.md, C2). Same image and button as the original ads; only the copy differs.';

export const CHALLENGER_HEADLINE_MAX = 40;
export const CHALLENGER_PRIMARY_TEXT_MAX = 300;
export const CHALLENGER_DESCRIPTION_MAX = 25;

export type WeekdayService = 'lunch' | 'dinner';

export interface WeekdayCampaign {
  key: 'lunch_a' | 'lunch_b' | 'dinner_a' | 'dinner_b';
  label: string;
  service: WeekdayService;
  /** CheersAI `meta_campaigns.id`. */
  campaignId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  /** Var 1, Var 2 and Var 3, in that order. */
  originalMetaAdIds: [string, string, string];
  /** Other ads known to sit in the ad set that are neither originals nor the challenger. */
  otherKnownMetaAdIds: string[];
  /** The short codes the three originals use, in the same order. */
  originalShortCodes: [string, string, string];
  utmCampaign: string;
  /** The campaign-level short code, where the runbook records which campaign it belongs to. */
  campaignLevelShortCode?: string;
}

export const WEEKDAY_CAMPAIGNS: WeekdayCampaign[] = [
  {
    key: 'lunch_a',
    label: 'Lunch A',
    service: 'lunch',
    campaignId: 'f80e55db-2b89-4672-809e-57d3253e15e4',
    metaCampaignId: '120246019241610609',
    metaAdSetId: '120246019242330609',
    originalMetaAdIds: ['120246019244520609', '120246019245440609', '120246019246560609'],
    // "Var 1 - booking rewrite", created and paused on 22 September 2026.
    otherKnownMetaAdIds: ['120246219010320609'],
    originalShortCodes: ['jbozdk', 'qx97ww', '56hzut'],
    utmCampaign: 'weekday_lunch_a_cod_and_chips',
    campaignLevelShortCode: '0ai0j0',
  },
  {
    key: 'lunch_b',
    label: 'Lunch B',
    service: 'lunch',
    campaignId: '52bd9d01-41e0-4ba0-9442-e7f5224604b4',
    metaCampaignId: '120246019309520609',
    metaAdSetId: '120246019310340609',
    originalMetaAdIds: ['120246019312850609', '120246019314320609', '120246019315690609'],
    otherKnownMetaAdIds: [],
    originalShortCodes: ['xicfnn', 'aw6zqu', 'ah4kcu'],
    utmCampaign: 'weekday_lunch_b_spicy_chicken_stack',
  },
  {
    key: 'dinner_a',
    label: 'Dinner A',
    service: 'dinner',
    campaignId: 'ed08ddeb-a1a9-4ad4-b7aa-704c64ab1f54',
    metaCampaignId: '120246019370140609',
    metaAdSetId: '120246019370370609',
    originalMetaAdIds: ['120246019371540609', '120246019372370609', '120246019373040609'],
    otherKnownMetaAdIds: [],
    originalShortCodes: ['jse8x1', 'if7tg6', 'mrhx2v'],
    utmCampaign: 'weekday_dinner_a_pizza',
  },
  {
    key: 'dinner_b',
    label: 'Dinner B',
    service: 'dinner',
    campaignId: '86400ca6-ac67-4d05-a1cd-2c7cc7634bc9',
    metaCampaignId: '120246019422320609',
    metaAdSetId: '120246019422650609',
    originalMetaAdIds: ['120246019423840609', '120246019424560609', '120246019425710609'],
    otherKnownMetaAdIds: [],
    originalShortCodes: ['z75yyn', 'i87o0t', 'f938i8'],
    utmCampaign: 'weekday_dinner_b_beef_and_ale_pie',
  },
];

export interface ChallengerCopy {
  headline: string;
  primaryText: string;
  description: string;
}

/**
 * The exact challenger copy from the spec (section 7, C2). Identical in the A and B campaign of
 * each service. Do not reword: a test pins every character and the length limits.
 */
export const CHALLENGER_COPY: Record<WeekdayService, ChallengerCopy> = {
  lunch: {
    headline: 'Lunch, no booking needed, Tue to Fri',
    primaryText:
      'Just turn up. We serve lunch Tuesday to Friday, 12pm to 3pm, with snack pots at £9 and wraps at £10. Free on-site parking and dogs welcome, in Stanwell Moor.',
    description: 'Walk in 12pm to 3pm',
  },
  dinner: {
    headline: 'Dinner Tue to Fri, just walk in from 4pm',
    primaryText:
      'No need to book. We serve dinner 4pm to 9pm, Tuesday to Friday: stone-baked pizzas from £13 and our beef and ale pie with mash at £16. Free on-site parking and dogs welcome.',
    description: 'Kitchen open 4pm to 9pm',
  },
};

/** The claims an operator re-checks against the live menu before `--apply` and `--activate`. */
export const CHALLENGER_PRICE_CLAIMS: Record<WeekdayService, string> = {
  lunch: 'snack pots at £9, wraps at £10, lunch 12pm to 3pm Tuesday to Friday',
  dinner: 'pizzas from £13, beef and ale pie with mash at £16, dinner 4pm to 9pm Tuesday to Friday',
};

export interface ChallengerAdSpec {
  campaign: WeekdayCampaign;
  name: string;
  angle: string;
  cta: string;
  copy: ChallengerCopy;
}

/** One challenger per campaign, in a fixed order, so keys are chosen the same way every run. */
export function buildChallengerAdSpecs(): ChallengerAdSpec[] {
  return WEEKDAY_CAMPAIGNS.map((campaign) => ({
    campaign,
    name: CHALLENGER_AD_NAME,
    angle: CHALLENGER_ANGLE,
    cta: CHALLENGER_CTA,
    copy: CHALLENGER_COPY[campaign.service],
  }));
}

// ─── Modes, checks and the manifest ──────────────────────────────────────────────────────────

export type ChallengerMode = 'dry-run' | 'apply' | 'activate' | 'pause' | 'status';

/**
 * S0 nothing yet; S1 ads row; S2 short link in the snapshot; S3 creative id saved; S4 ad id
 * saved, paused; S5 every read-back check passed in this run; S6 live.
 */
export type ChallengerStage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

export type ChallengerCheckResult = 'pass' | 'fail' | 'pending' | 'unverified';

export interface ChallengerCheck {
  result: ChallengerCheckResult;
  /** Why it is not a pass; empty on a pass. */
  reasons: string[];
}

/**
 * Checks the script cannot make itself: they need the management app's database, a browser or
 * the owner. Each stays `pending`, and blocks, until the operator names it with `--confirmed`.
 */
export const MANUAL_CHECKS = {
  'owner-go-ahead': "Peter's go-ahead for this step, given at the time (launch gates)",
  claims:
    'every price, dish and time in the copy against the live management-app menu and hours, today (runbook check 10)',
  'short-links':
    'the four new codes exist in the management app short_links with no expiry before the flight ends (runbook check 3)',
  previews: 'placement previews for each new ad (runbook check 6)',
  'public-hours': 'the Facebook Page hours and Google Business Profile against the management app (runbook check 7)',
  'booking-system': 'the booking system for an ad day and an excluded day (runbook check 9)',
  'organic-booking':
    'a real website table booking made since 22:06 on 3 October 2026 carries a page label (spec section 6 step 3 as revised by D21; readout query 5e-3)',
} as const;

export type ManualCheck = keyof typeof MANUAL_CHECKS;

export const APPLY_REQUIRED_CONFIRMATIONS: ManualCheck[] = ['owner-go-ahead', 'claims'];
export const ACTIVATE_REQUIRED_CONFIRMATIONS: ManualCheck[] = Object.keys(MANUAL_CHECKS) as ManualCheck[];

export function isManualCheck(value: string): value is ManualCheck {
  return Object.prototype.hasOwnProperty.call(MANUAL_CHECKS, value);
}

/** Turns `--confirmed` values (comma-separated or repeated) into check names; refuses any it does not know. */
export function parseConfirmed(values: string[]): ManualCheck[] {
  const names = values.flatMap((value) => value.split(',')).map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !isManualCheck(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown --confirmed value: ${unknown.join(', ')}. Known values: ${Object.keys(MANUAL_CHECKS).join(', ')}.`);
  }
  return Array.from(new Set(names)).filter(isManualCheck);
}

export interface ChallengerManifestCampaign {
  key: string;
  label: string;
  campaignId: string;
  stage: ChallengerStage | 'unknown';
  adRowId: string | null;
  utmContentKey: string | null;
  shortCode: string | null;
  shortUrl: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  localStatus: string | null;
  remoteConfiguredStatus: string | null;
  remoteEffectiveStatus: string | null;
  checks: Record<string, ChallengerCheck>;
  /** Why this campaign stopped in this run, or null. */
  stopped: string | null;
}

/** Written outside git after every run that can write. It holds ids and results, never a token. */
export interface ChallengerManifest {
  runId: string;
  mode: ChallengerMode;
  startedAt: string;
  finishedAt: string | null;
  accountId: string;
  graphVersion: string;
  confirmed: ManualCheck[];
  outcome: 'completed' | 'stopped';
  stoppedReason: string | null;
  accountCheck: ChallengerCheck | null;
  campaigns: ChallengerManifestCampaign[];
  /** `--pause` only: challenger ad ids Meta still shows as not paused after the run. */
  challengerIdsStillActive: string[];
}

// ─── Clients (all injected) ──────────────────────────────────────────────────────────────────

export interface ChallengerMetaClient {
  fetchAdAccountSpendStatus(adAccountId: string, accessToken: string): Promise<MetaAdAccountSpendStatus>;
  fetchAdSetBudgetRemaining(adSetId: string, accessToken: string): Promise<number | null>;
  listAdSetAds(adSetId: string, accessToken: string): Promise<MetaAdSetAdSummary[]>;
  listAdCreativesNamed(adAccountId: string, accessToken: string, name: string): Promise<MetaAdCreativeSummary[]>;
  readAdForLaunch(adId: string, accessToken: string): Promise<MetaAdLaunchReadBack>;
  readAdCreative(creativeId: string, accessToken: string): Promise<MetaCreativeLaunchReadBack>;
  uploadImage(adAccountId: string, accessToken: string, imageUrl: string): Promise<{ hash: string }>;
  createAdCreative(params: CreateAdCreativeParams): Promise<{ id: string }>;
  createAd(params: CreateAdParams): Promise<{ id: string }>;
  setObjectStatus(objectId: string, accessToken: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>;
}

export interface ChallengerManagementClient {
  createMetaAdsLink(config: ManagementApiConfig, input: ManagementMetaAdsLinkInput): Promise<ManagementMetaAdsLink>;
}

export type ChallengerLockResult = { acquired: true } | { acquired: false; reason: string };

/** A single-run lock. Only modes that can write take it; a held lock never blocks a read. */
export interface ChallengerLock {
  acquire(runId: string): Promise<ChallengerLockResult>;
  /** Releases the lock only if it still holds this run's id. */
  release(runId: string): Promise<void>;
}

export interface ChallengerDeps {
  supabase: SupabaseClientLike;
  meta: ChallengerMetaClient;
  management: ChallengerManagementClient;
  lock: ChallengerLock;
  /** Saves the manifest outside git and returns where it went. */
  writeManifest: (manifest: ChallengerManifest) => Promise<string>;
  now: () => Date;
  log: (line: string) => void;
  runId: string;
  graphVersion: string;
}

export interface ChallengerRunOptions {
  mode: ChallengerMode;
  confirmed: ManualCheck[];
}

export interface ChallengerRunResult {
  ok: boolean;
  manifest: ChallengerManifest;
}

// ─── Rows ────────────────────────────────────────────────────────────────────────────────────

interface CampaignRow {
  id: string;
  account_id: string;
  name: string;
  status: string;
  meta_campaign_id: string | null;
  campaign_kind: string | null;
  controlled_test: boolean | null;
  destination_url: string | null;
  source_snapshot: Record<string, unknown> | null;
  end_date: string | null;
}

interface AdSetRow {
  id: string;
  campaign_id: string;
  name: string;
  meta_adset_id: string | null;
  adset_media_asset_id: string | null;
}

export interface ChallengerAdRow {
  id: string;
  adset_id: string;
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  angle: string | null;
  media_asset_id: string | null;
  creative_format: string | null;
  creative_variant_key: string | null;
  utm_content_key: string | null;
  meta_ad_id: string | null;
  meta_creative_id: string | null;
  status: string;
  meta_status: string | null;
}

const CAMPAIGN_COLUMNS =
  'id, account_id, name, status, meta_campaign_id, campaign_kind, controlled_test, destination_url, source_snapshot, end_date';
const AD_SET_COLUMNS = 'id, campaign_id, name, meta_adset_id, adset_media_asset_id';
const AD_COLUMNS =
  'id, adset_id, name, headline, primary_text, description, cta, angle, media_asset_id, creative_format, creative_variant_key, utm_content_key, meta_ad_id, meta_creative_id, status, meta_status';

// ─── Pure parts ──────────────────────────────────────────────────────────────────────────────

/**
 * Whether the flight has ended. It runs to the end of its last day in London: the ad sets stop
 * at 00:00 UK time on the day after. The comparison is made on London calendar dates, which is
 * right on either side of a clock change (BST ends on 25 October 2026, after this flight). A
 * UTC date would be an hour late in BST: at 00:30 on 17 October in London it is still
 * 16 October in UTC.
 */
export function isFlightEnded(now: Date, endDate: string | null | undefined): boolean {
  const today = DateTime.fromJSDate(now, { zone: DEFAULT_TIMEZONE }).toISODate();
  if (!today) return true;

  const recorded = endDate?.slice(0, 10) ?? null;
  const lastDay =
    recorded && /^\d{4}-\d{2}-\d{2}$/.test(recorded) && recorded < WEEKDAY_FLIGHT_LAST_DAY
      ? recorded
      : WEEKDAY_FLIGHT_LAST_DAY;
  return today > lastDay;
}

export interface ChallengerKeys {
  creativeVariantKey: string;
  utmContentKey: string;
  /** True when the key came from a saved row rather than being built now. */
  reused: boolean;
}

/**
 * The challenger's keys. A key already saved on the row is reused as it stands and never built
 * again. A new key is checked against every Weekday campaign's keys, not only this campaign's,
 * so Lunch A and Lunch B cannot end up sharing one.
 */
export function buildChallengerKeys(args: {
  campaignName: string;
  adSetName: string;
  creativeFormat: string | null;
  savedRow?: Pick<ChallengerAdRow, 'creative_variant_key' | 'utm_content_key'> | null;
  takenKeys: Iterable<string | null | undefined>;
}): ChallengerKeys {
  const parts = {
    campaignName: args.campaignName,
    adSetName: args.adSetName,
    adName: CHALLENGER_AD_NAME,
    angle: CHALLENGER_ANGLE,
    creativeFormat: args.creativeFormat,
  };

  const savedKey = args.savedRow?.utm_content_key?.trim();
  if (savedKey) {
    return {
      creativeVariantKey: args.savedRow?.creative_variant_key?.trim() || buildCreativeVariantKey(parts),
      utmContentKey: savedKey,
      reused: true,
    };
  }

  return {
    creativeVariantKey: buildCreativeVariantKey(parts),
    utmContentKey: uniqueAdUtmContentKey(buildAdUtmContentKey(parts), args.takenKeys),
    reused: false,
  };
}

const TRUSTED_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'vip-club.uk', 'www.vip-club.uk']);

/**
 * The campaign's parent short code and the address its links resolve to, worked out exactly as
 * ensureManagementMetaAdVariantLinks does, so the management app sees the same parent it saw
 * when the originals' links were made.
 */
export function resolveParentLink(
  snapshot: Record<string, unknown> | null | undefined,
  destinationUrl: string,
): { parentShortCode: string | null; parentDestinationUrl: string } {
  const source = snapshot ?? {};
  return {
    parentShortCode:
      stringValue(source.shortCode) ??
      extractTrustedShortCode(stringValue(source.paidCtaUrl)) ??
      extractTrustedShortCode(stringValue(source.metaAdsShortLink)) ??
      extractTrustedShortCode(destinationUrl),
    parentDestinationUrl:
      stringValue(source.metaAdsDestinationUrl) ??
      stringValue(source.utmDestinationUrl) ??
      stringValue(source.originalDestinationUrl) ??
      destinationUrl,
  };
}

export interface VariantExpectation {
  utmContentKey: string;
  parentShortCode: string;
  utmCampaign: string;
  /** Codes the new link must not reuse: the campaign-level codes and every existing ad's code. */
  reservedShortCodes: Iterable<string>;
  /** The code already saved for this key, when there is one: a retry must return the same code. */
  savedShortCode?: string | null;
}

export type VariantSelection =
  | { ok: true; variant: ManagementMetaAdsLinkVariant }
  | { ok: false; reason: string };

/**
 * Picks the challenger's own short link out of the management app's response. The response
 * carries the parent link's fields plus a `variants` array, so only `variants` is read, never
 * the top-level code. Exactly one entry must carry the saved key, and it must be a real per-ad
 * link to the landing page. `alreadyExists: true` on a retry is success. Anything else fails
 * safely with a reason.
 */
export function selectChallengerVariant(
  variants: ManagementMetaAdsLinkVariant[] | null | undefined,
  expectation: VariantExpectation,
): VariantSelection {
  const list = Array.isArray(variants) ? variants : [];
  if (list.length === 0) {
    return { ok: false, reason: 'the response held the parent link only, with no per-ad link' };
  }

  const wanted = normaliseUtmContentKey(expectation.utmContentKey);
  const matches = list.filter((variant) => normaliseUtmContentKey(variant.utmContent) === wanted);
  if (matches.length === 0) {
    return { ok: false, reason: 'no per-ad link in the response carries the saved key' };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'more than one per-ad link in the response carries the saved key' };
  }

  const variant = matches[0]!;
  const problem = findVariantProblem(variant, expectation);
  return problem ? { ok: false, reason: problem } : { ok: true, variant };
}

/** Why a per-ad link cannot be used, or null when it is sound. */
export function findVariantProblem(
  variant: ManagementMetaAdsLinkVariant,
  expectation: VariantExpectation,
): string | null {
  const shortCode = variant.shortCode?.trim().toLowerCase() ?? '';
  const parentShortCode = expectation.parentShortCode.trim().toLowerCase();

  if (!shortCode) return 'the per-ad link has no short code';
  if ((variant.parentShortCode?.trim().toLowerCase() ?? '') !== parentShortCode) {
    return `the per-ad link belongs to parent ${variant.parentShortCode || 'unknown'}, expected ${parentShortCode}`;
  }
  if (shortCode === parentShortCode) return 'the per-ad link is the campaign-level link, not its own';

  const reserved = new Set(Array.from(expectation.reservedShortCodes, (code) => code.trim().toLowerCase()));
  if (reserved.has(shortCode)) return `the short code ${shortCode} is already used by another link`;

  const savedShortCode = expectation.savedShortCode?.trim().toLowerCase();
  if (savedShortCode && savedShortCode !== shortCode) {
    return `the management app returned ${shortCode}, but ${savedShortCode} is already saved for this key`;
  }

  const shortUrl = parseUrl(variant.shortUrl);
  if (!shortUrl || shortUrl.protocol !== 'https:') return 'the short link is not an https address';
  if (shortUrl.hostname.toLowerCase() !== WEEKDAY_SHORT_LINK_HOST) {
    return `the short link is on ${shortUrl.hostname}, expected ${WEEKDAY_SHORT_LINK_HOST}`;
  }
  if (stripTrailingSlash(shortUrl.pathname).toLowerCase() !== `/${shortCode}` || shortUrl.search) {
    return 'the short link address does not match its short code';
  }

  const destination = parseUrl(variant.utmDestinationUrl);
  if (!destination) return 'the tagged destination is not a web address';
  if (`${destination.origin}${stripTrailingSlash(destination.pathname)}` !== WEEKDAY_LANDING_PAGE_URL) {
    return `the tagged destination is ${destination.origin}${destination.pathname}, expected ${WEEKDAY_LANDING_PAGE_URL}`;
  }
  if (destination.searchParams.get('utm_campaign') !== expectation.utmCampaign) {
    return `utm_campaign is ${destination.searchParams.get('utm_campaign') ?? 'missing'}, expected ${expectation.utmCampaign}`;
  }
  if (normaliseUtmContentKey(destination.searchParams.get('utm_content')) !== normaliseUtmContentKey(expectation.utmContentKey)) {
    return `utm_content is ${destination.searchParams.get('utm_content') ?? 'missing'}, expected the saved key`;
  }

  return null;
}

/** Every entry in `source_snapshot.managementMetaAdVariants` that carries this key. */
export function findSnapshotVariants(
  snapshot: Record<string, unknown> | null | undefined,
  utmContentKey: string | null | undefined,
): ManagementMetaAdsLinkVariant[] {
  const wanted = normaliseUtmContentKey(utmContentKey);
  if (!wanted || !Array.isArray(snapshot?.managementMetaAdVariants)) return [];

  const found: ManagementMetaAdsLinkVariant[] = [];
  for (const value of snapshot.managementMetaAdVariants) {
    const row = asRecord(value);
    if (!row) continue;
    if (normaliseUtmContentKey(stringValue(row.utmContent) ?? stringValue(row.utm_content)) !== wanted) continue;
    found.push({
      shortUrl: stringValue(row.shortUrl) ?? stringValue(row.short_url) ?? '',
      shortCode: stringValue(row.shortCode) ?? stringValue(row.short_code) ?? '',
      destinationUrl: stringValue(row.destinationUrl) ?? stringValue(row.destination_url) ?? '',
      utmDestinationUrl: stringValue(row.utmDestinationUrl) ?? stringValue(row.utm_destination_url) ?? '',
      utmContent: wanted,
      parentShortCode: stringValue(row.parentShortCode) ?? stringValue(row.parent_short_code) ?? '',
      alreadyExists: Boolean(row.alreadyExists ?? row.already_exists),
    });
  }
  return found;
}

/**
 * Adds the one new per-ad link to the snapshot, keyed by `utmContent`. Every existing entry and
 * every other snapshot field is carried over untouched. An entry already there for the key is
 * left alone when it is the same link, and refused when it is a different one.
 */
export function mergeChallengerVariant(
  snapshot: Record<string, unknown> | null | undefined,
  variant: ManagementMetaAdsLinkVariant,
): { snapshot: Record<string, unknown>; changed: boolean } {
  const base = { ...(snapshot ?? {}) };
  const existingValue = base.managementMetaAdVariants;
  if (existingValue !== undefined && existingValue !== null && !Array.isArray(existingValue)) {
    throw new CampaignStop('the snapshot holds per-ad links in a form that is not understood; it was left as it is');
  }
  const existing: unknown[] = Array.isArray(existingValue) ? existingValue : [];

  const sameKey = findSnapshotVariants(base, variant.utmContent);
  if (sameKey.length > 0) {
    const sameLink =
      sameKey.length === 1 && sameKey[0]!.shortCode.toLowerCase() === variant.shortCode.toLowerCase();
    if (!sameLink) {
      throw new CampaignStop('the snapshot already holds a different per-ad link for this key; it was left as it is');
    }
    return { snapshot: base, changed: false };
  }

  return {
    snapshot: {
      ...base,
      managementMetaAdVariants: [
        ...existing,
        {
          utmContent: variant.utmContent,
          shortUrl: variant.shortUrl,
          shortCode: variant.shortCode,
          destinationUrl: variant.destinationUrl,
          utmDestinationUrl: variant.utmDestinationUrl,
          parentShortCode: variant.parentShortCode,
          alreadyExists: variant.alreadyExists,
        },
      ],
    },
    changed: true,
  };
}

/**
 * Where a campaign's challenger got to, read from the ads row and the snapshot. S5 is never
 * stored: it means every read-back check passed in the current run.
 */
export function detectChallengerStage(
  row: Pick<ChallengerAdRow, 'utm_content_key' | 'meta_creative_id' | 'meta_ad_id' | 'status' | 'meta_status'> | null | undefined,
  snapshot: Record<string, unknown> | null | undefined,
): ChallengerStage {
  if (!row) return 'S0';
  if (row.meta_ad_id) return row.status === 'ACTIVE' && row.meta_status === 'ACTIVE' ? 'S6' : 'S4';
  if (row.meta_creative_id) return 'S3';
  if (findSnapshotVariants(snapshot, row.utm_content_key).length > 0) return 'S2';
  return 'S1';
}

export type ReconciliationDecision<T> =
  | { action: 'create' }
  | { action: 'adopt'; match: T }
  | { action: 'stop'; matches: T[] };

/**
 * What to do with the objects Meta already holds under the challenger's name. None: it may be
 * created. Exactly one: save its id and carry on, never create it again. More than one: stop and
 * report; a person decides what to pause. The script never guesses.
 */
export function decideReconciliation<T>(matches: T[]): ReconciliationDecision<T> {
  if (matches.length === 0) return { action: 'create' };
  if (matches.length === 1) return { action: 'adopt', match: matches[0]! };
  return { action: 'stop', matches };
}

export type ReadBackCheckName = 'identity' | 'copy' | 'button and links' | 'own link' | 'enhancements' | 'review';

/**
 * Compares what Meta holds for a challenger with what was meant to be sent. Every result other
 * than `pass` blocks activation: `unverified` and `pending` are never treated as a pass.
 */
export function compareChallengerReadBack(args: {
  readBack: MetaAdLaunchReadBack;
  copy: ChallengerCopy;
  /** The challenger's own short link. */
  expectedLink: string;
  campaignLevelShortCode: string;
  expectedStatus: 'ACTIVE' | 'PAUSED';
  expectedAdSetId: string;
  expectedPageId: string;
}): Record<ReadBackCheckName, ChallengerCheck> {
  const { readBack, copy } = args;
  const creative = readBack.creative;

  const identity: string[] = [];
  if (readBack.name !== CHALLENGER_AD_NAME) identity.push(`the ad is named "${readBack.name ?? 'unknown'}"`);
  if (readBack.adSetId !== args.expectedAdSetId) identity.push(`the ad sits in ad set ${readBack.adSetId ?? 'unknown'}, expected ${args.expectedAdSetId}`);
  if (creative.pageId !== args.expectedPageId) identity.push(`the creative is on Page ${creative.pageId ?? 'unknown'}, expected ${args.expectedPageId}`);

  const copyProblems: string[] = [];
  if (creative.headline !== copy.headline) copyProblems.push(`the headline is "${creative.headline ?? 'missing'}"`);
  if (creative.message !== copy.primaryText) copyProblems.push(`the primary text is "${creative.message ?? 'missing'}"`);
  if (creative.description !== copy.description) copyProblems.push(`the description is "${creative.description ?? 'missing'}"`);

  const ownLink: string[] = [];
  for (const [label, link] of [['creative link', creative.link], ['button link', creative.callToActionLink]] as const) {
    const code = extractShortCode(link);
    if (!code) ownLink.push(`the ${label} is not a ${WEEKDAY_SHORT_LINK_HOST} short link`);
    else if (code === args.campaignLevelShortCode.toLowerCase()) ownLink.push(`the ${label} is the campaign-level link`);
  }

  return {
    identity: toCheck(identity),
    copy: toCheck(copyProblems),
    'button and links': checkCreativeCallToAction(creative, { type: CHALLENGER_CTA, link: args.expectedLink }),
    'own link': toCheck(ownLink),
    enhancements: checkCreativeEnhancementsOptedOut(creative.creativeFeaturesSpec),
    review: checkAdReview(readBack, args.expectedStatus),
  };
}

/**
 * Runbook check 4 (D13): the ad account is active and its spending limit leaves more headroom
 * than the four ad sets still have to spend. The limit itself is never changed.
 */
export function checkAccountHeadroom(
  account: MetaAdAccountSpendStatus,
  adSetBudgetsRemainingMinor: Array<number | null>,
): ChallengerCheck {
  if (account.accountStatus !== 1) {
    return { result: 'fail', reasons: [`the ad account status is ${account.accountStatus ?? 'unknown'}, expected 1 (active)`] };
  }
  if (account.spendCapMinor === null || account.amountSpentMinor === null) {
    return { result: 'unverified', reasons: ['Meta did not return the account spending limit or the amount spent'] };
  }
  if (account.spendCapMinor <= 0) {
    return { result: 'fail', reasons: ['the ad account has no spending limit, but the limit is meant to stay in place (D13)'] };
  }
  if (adSetBudgetsRemainingMinor.some((value) => value === null)) {
    return { result: 'unverified', reasons: ['Meta did not return the budget left on every ad set'] };
  }

  const headroom = account.spendCapMinor - account.amountSpentMinor;
  const stillToRun = adSetBudgetsRemainingMinor.reduce<number>((total, value) => total + (value ?? 0), 0);
  if (headroom < stillToRun) {
    return {
      result: 'fail',
      reasons: [`${formatPounds(headroom)} left under the spending limit, but ${formatPounds(stillToRun)} is still to run`],
    };
  }
  return { result: 'pass', reasons: [] };
}

/** Removes anything secret from a line before it is printed or saved. */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) result = result.split(secret).join('[redacted]');
  }
  result = result.replace(/\b(access_token|api_key|apikey|token|signature)=[^&\s"']+/gi, '$1=[redacted]');
  return redactMetaAccessTokens(result);
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────

/** Stops one campaign. The run carries on with the others. */
class CampaignStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignStop';
  }
}

/** Stops the whole run: what Meta holds could not be established, so nothing more is created. */
class RunStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStop';
  }
}

interface AccountContext {
  adAccountId: string | null;
  accessToken: string | null;
  pageId: string | null;
  management: ManagementApiConfig | null;
  /** Reasons a run that creates or activates anything must stop before any write. */
  problems: string[];
}

interface CampaignRun {
  spec: ChallengerAdSpec;
  record: ChallengerManifestCampaign;
  campaign: CampaignRow | null;
  adSet: AdSetRow | null;
  ads: ChallengerAdRow[];
  challengerRow: ChallengerAdRow | null;
  remoteChallenger: MetaAdSetAdSummary | null;
  /** True once Meta's ads for the ad set have been listed, so "none found" can be trusted. */
  remoteListed: boolean;
  mediaAssetId: string | null;
  creativeFormat: string | null;
  parentShortCode: string | null;
  parentDestinationUrl: string | null;
  /** Reasons a run that creates or activates anything must stop before any write. */
  problems: string[];
  /** Things worth saying that do not stop anything. */
  notes: string[];
}

interface Run {
  options: ChallengerRunOptions;
  deps: ChallengerDeps;
  manifest: ChallengerManifest;
  secrets: Set<string>;
  say: (line?: string) => void;
}

const WRITE_MODES = new Set<ChallengerMode>(['apply', 'activate', 'pause']);

/**
 * Runs one mode. `--dry-run` and `--status` are read only: they take no lock, write no manifest
 * and are handed clients that refuse any write.
 */
export async function runChallengerAds(
  options: ChallengerRunOptions,
  deps: ChallengerDeps,
): Promise<ChallengerRunResult> {
  const secrets = new Set<string>();
  const writes = WRITE_MODES.has(options.mode);
  const manifest: ChallengerManifest = {
    runId: deps.runId,
    mode: options.mode,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
    accountId: WEEKDAY_ACCOUNT_ID,
    graphVersion: deps.graphVersion,
    confirmed: [...options.confirmed],
    outcome: 'completed',
    stoppedReason: null,
    accountCheck: null,
    campaigns: [],
    challengerIdsStillActive: [],
  };
  const run: Run = {
    options,
    deps: writes
      ? deps
      : {
          ...deps,
          supabase: refuseSupabaseWrites(deps.supabase),
          meta: refuseMetaWrites(deps.meta),
          management: refuseManagementWrites(),
        },
    manifest,
    secrets,
    say: (line = '') => deps.log(redactSecrets(line, secrets)),
  };

  run.say(`Weekday challenger ads: ${options.mode} (run ${deps.runId})`);
  run.say(`Graph API version: ${deps.graphVersion}`);
  run.say(writes ? 'This mode can write.' : 'This mode is read only: nothing is written anywhere.');

  if (writes) {
    const lock = await acquireLock(deps);
    if (!lock.acquired) {
      // Nothing has been read or written yet, and no manifest is saved for a run that never began.
      run.say(`Stopped before any write: ${lock.reason}`);
      manifest.outcome = 'stopped';
      manifest.stoppedReason = redactSecrets(lock.reason, secrets);
      manifest.finishedAt = deps.now().toISOString();
      return { ok: false, manifest };
    }
  }

  let ok = false;
  try {
    ok = await runMode(run);
    if (!ok) manifest.outcome = 'stopped';
  } catch (error) {
    manifest.outcome = 'stopped';
    manifest.stoppedReason = redactSecrets(describeError(error), secrets);
    run.say(`Stopped: ${describeError(error)}`);
  } finally {
    manifest.finishedAt = deps.now().toISOString();
    if (writes) {
      try {
        const savedTo = await deps.writeManifest(redactManifest(manifest, secrets));
        run.say(`Manifest saved: ${savedTo}`);
      } catch (error) {
        ok = false;
        run.say(`The manifest could not be saved: ${describeError(error)}`);
      }
      try {
        await deps.lock.release(deps.runId);
      } catch (error) {
        run.say(`The lock could not be released: ${describeError(error)}`);
      }
    }
  }

  run.say(ok ? 'Finished.' : 'Finished with something to look at: read the lines above.');
  return { ok, manifest: redactManifest(manifest, secrets) };
}

async function acquireLock(deps: ChallengerDeps): Promise<ChallengerLockResult> {
  try {
    return await deps.lock.acquire(deps.runId);
  } catch (error) {
    return { acquired: false, reason: `the single-run lock could not be taken (${describeError(error)})` };
  }
}

function runMode(run: Run): Promise<boolean> {
  switch (run.options.mode) {
    case 'dry-run':
      return runCreate(run, false);
    case 'apply':
      return runCreate(run, true);
    case 'activate':
      return runActivate(run);
    case 'pause':
      return runPause(run);
    case 'status':
      return runStatus(run);
  }
}

// ─── Loading (read only) ─────────────────────────────────────────────────────────────────────

async function loadAccountContext(run: Run): Promise<AccountContext> {
  const { supabase } = run.deps;
  const context: AccountContext = { adAccountId: null, accessToken: null, pageId: null, management: null, problems: [] };

  const { data: adAccount, error: adAccountError } = await supabase
    .from('meta_ad_accounts')
    .select('meta_account_id, token_expires_at')
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .maybeSingle<{ meta_account_id: string | null; token_expires_at: string | null }>();
  if (adAccountError) {
    context.problems.push(`the Meta ad account could not be loaded (${adAccountError.message})`);
  } else if (!adAccount?.meta_account_id) {
    context.problems.push('no Meta ad account is connected');
  } else {
    context.adAccountId = adAccount.meta_account_id;
    if (adAccount.meta_account_id !== WEEKDAY_META_AD_ACCOUNT_ID) {
      context.problems.push(`the Meta ad account is ${adAccount.meta_account_id}, expected ${WEEKDAY_META_AD_ACCOUNT_ID}`);
    }
    if (adAccount.token_expires_at && new Date(adAccount.token_expires_at).getTime() < run.deps.now().getTime()) {
      context.problems.push('the Meta Ads token has expired; reconnect Meta Ads in Connections');
    }
  }

  // Paid-ads tokens come only from the encrypted meta_ad_account_tokens path.
  try {
    const { accessToken } = await getMetaAdAccountTokens(supabase, WEEKDAY_ACCOUNT_ID);
    if (accessToken) {
      context.accessToken = accessToken;
      run.secrets.add(accessToken);
    } else {
      context.problems.push('the Meta Ads token is missing; reconnect Meta Ads in Connections');
    }
  } catch (error) {
    context.problems.push(`the Meta Ads token could not be read (${describeError(error)})`);
  }

  const { data: facebook, error: facebookError } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .eq('provider', 'facebook')
    .maybeSingle<{ metadata: { pageId?: string } | null }>();
  if (facebookError) {
    context.problems.push(`the Facebook Page could not be loaded (${facebookError.message})`);
  } else {
    context.pageId = facebook?.metadata?.pageId ?? null;
    if (context.pageId !== WEEKDAY_FACEBOOK_PAGE_ID) {
      context.problems.push(`the Facebook Page is ${context.pageId ?? 'not connected'}, expected ${WEEKDAY_FACEBOOK_PAGE_ID}`);
    }
  }

  // The in-app helper needs a signed-in request, so the connection is read directly.
  const { data: connection, error: connectionError } = await supabase
    .from('management_app_connections')
    .select('base_url, api_key, enabled')
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .maybeSingle<{ base_url: string | null; api_key: string | null; enabled: boolean | null }>();
  const apiKey = connection?.api_key?.trim();
  if (apiKey) run.secrets.add(apiKey);
  if (connectionError) {
    context.problems.push(`the management app connection could not be loaded (${connectionError.message})`);
  } else if (!connection || !apiKey || !connection.base_url?.trim()) {
    context.problems.push('the management app connection is not configured');
  } else if (!connection.enabled) {
    context.problems.push('the management app connection is disabled');
  } else {
    context.management = { baseUrl: connection.base_url.trim(), apiKey };
  }

  return context;
}

async function loadCampaignRecords(
  supabase: SupabaseClientLike,
  campaignId: string,
): Promise<{ campaign: CampaignRow | null; adSets: AdSetRow[]; ads: ChallengerAdRow[] }> {
  const { data: campaign, error: campaignError } = await supabase
    .from('meta_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('id', campaignId)
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .maybeSingle<CampaignRow>();
  if (campaignError) throw new Error(`the campaign could not be loaded (${campaignError.message})`);
  if (!campaign) return { campaign: null, adSets: [], ads: [] };

  // ad_sets and ads have no account_id column. They are scoped through the campaign row above,
  // which was loaded with the account filter, and then through that campaign's ad set ids.
  const { data: adSetRows, error: adSetError } = await supabase
    .from('ad_sets')
    .select(AD_SET_COLUMNS)
    .eq('campaign_id', campaign.id);
  if (adSetError) throw new Error(`the ad sets could not be loaded (${adSetError.message})`);
  const adSets = (adSetRows ?? []) as unknown as AdSetRow[];
  if (adSets.length === 0) return { campaign, adSets, ads: [] };

  const { data: adRows, error: adError } = await supabase
    .from('ads')
    .select(AD_COLUMNS)
    .in('adset_id', adSets.map((adSet) => adSet.id));
  if (adError) throw new Error(`the ads could not be loaded (${adError.message})`);

  return { campaign, adSets, ads: (adRows ?? []) as unknown as ChallengerAdRow[] };
}

function newRecord(spec: ChallengerAdSpec): ChallengerManifestCampaign {
  return {
    key: spec.campaign.key,
    label: spec.campaign.label,
    campaignId: spec.campaign.campaignId,
    stage: 'unknown',
    adRowId: null,
    utmContentKey: null,
    shortCode: null,
    shortUrl: null,
    metaCreativeId: null,
    metaAdId: null,
    localStatus: null,
    remoteConfiguredStatus: null,
    remoteEffectiveStatus: null,
    checks: {},
    stopped: null,
  };
}

/**
 * Reads everything about one campaign and lists every reason a run that creates or activates
 * must stop before any write. Read only: database selects and one Meta GET.
 */
async function inspectCampaign(run: Run, spec: ChallengerAdSpec, account: AccountContext): Promise<CampaignRun> {
  const { supabase, meta } = run.deps;
  const expected = spec.campaign;
  const view: CampaignRun = {
    spec,
    record: newRecord(spec),
    campaign: null,
    adSet: null,
    ads: [],
    challengerRow: null,
    remoteChallenger: null,
    remoteListed: false,
    mediaAssetId: null,
    creativeFormat: null,
    parentShortCode: null,
    parentDestinationUrl: null,
    problems: [],
    notes: [],
  };
  const problems = view.problems;

  let records: Awaited<ReturnType<typeof loadCampaignRecords>>;
  try {
    records = await loadCampaignRecords(supabase, expected.campaignId);
  } catch (error) {
    problems.push(describeError(error));
    return view;
  }

  const { campaign, adSets, ads } = records;
  view.campaign = campaign;
  view.ads = ads;
  if (!campaign) {
    problems.push('the campaign was not found for this account');
    return view;
  }

  if (campaign.status !== 'ACTIVE') problems.push(`the campaign is ${campaign.status}, not ACTIVE`);
  if (campaign.campaign_kind !== 'evergreen') problems.push(`the campaign kind is ${campaign.campaign_kind ?? 'unknown'}, not evergreen`);
  if (campaign.controlled_test !== true) problems.push('the campaign is not marked as a controlled test');
  if (campaign.meta_campaign_id !== expected.metaCampaignId) {
    problems.push(`the Meta campaign id is ${campaign.meta_campaign_id ?? 'missing'}, expected ${expected.metaCampaignId}`);
  }
  if (isFlightEnded(run.deps.now(), campaign.end_date)) problems.push('the flight has ended');

  if (adSets.length !== 1) {
    problems.push(`the campaign has ${adSets.length} ad sets, expected exactly 1`);
    return view;
  }
  const adSet = adSets[0]!;
  view.adSet = adSet;
  if (adSet.meta_adset_id !== expected.metaAdSetId) {
    problems.push(`the Meta ad set id is ${adSet.meta_adset_id ?? 'missing'}, expected ${expected.metaAdSetId}`);
  }

  // Local ads: the three originals (and, on Lunch A, the paused rewrite), plus at most one challenger.
  const challengerRows = ads.filter((ad) => ad.name === CHALLENGER_AD_NAME);
  const otherRows = ads.filter((ad) => ad.name !== CHALLENGER_AD_NAME);
  const expectedIds = [...expected.originalMetaAdIds, ...expected.otherKnownMetaAdIds];
  const localIds = otherRows.map((ad) => ad.meta_ad_id ?? '(none)');
  if (!sameMembers(localIds, expectedIds)) {
    problems.push(`the existing ads do not match the runbook: found ${otherRows.length} (${localIds.join(', ') || 'none'}), expected ${expectedIds.length} (${expectedIds.join(', ')})`);
  }
  if (challengerRows.length > 1) {
    problems.push(`${challengerRows.length} ads rows are named "${CHALLENGER_AD_NAME}" (${challengerRows.map((ad) => ad.id).join(', ')}); reconcile by hand`);
  }
  view.challengerRow = challengerRows.length === 1 ? challengerRows[0]! : null;
  for (const row of challengerRows) {
    const clash = row.meta_ad_id && expectedIds.includes(row.meta_ad_id);
    if (clash) problems.push(`the challenger row ${row.id} points at an original ad (${row.meta_ad_id})`);
  }

  // The challenger copies the originals' image and button, so copy is the only difference (D7).
  const originals = expected.originalMetaAdIds
    .map((id) => otherRows.find((ad) => ad.meta_ad_id === id))
    .filter((ad): ad is ChallengerAdRow => Boolean(ad));
  const assetIds = new Set(originals.map((ad) => ad.media_asset_id ?? adSet.adset_media_asset_id ?? ''));
  if (originals.length === 3 && (assetIds.size !== 1 || assetIds.has(''))) {
    problems.push('the three original ads do not share one image');
  } else if (originals.length === 3) {
    view.mediaAssetId = Array.from(assetIds)[0]!;
  }
  const originalCtas = new Set(originals.map((ad) => ad.cta));
  if (originals.length === 3 && (originalCtas.size !== 1 || !originalCtas.has(CHALLENGER_CTA))) {
    problems.push(`the original ads' button is ${Array.from(originalCtas).join(', ')}, expected ${CHALLENGER_CTA}`);
  }
  // The format is an internal label, not the image. When the originals carry different labels,
  // Var 1's is used, and the run says so.
  view.creativeFormat = originals[0] ? normaliseCreativeFormat(originals[0].creative_format) : null;
  const formats = new Set(originals.map((ad) => normaliseCreativeFormat(ad.creative_format)));
  if (formats.size > 1) {
    view.notes.push(`the original ads carry different creative format labels (${Array.from(formats).join(', ')}); Var 1's (${view.creativeFormat}) is used for the challenger`);
  }

  if (view.mediaAssetId) {
    const { data: asset, error: assetError } = await supabase
      .from('media_assets')
      .select('id')
      .eq('id', view.mediaAssetId)
      .eq('account_id', WEEKDAY_ACCOUNT_ID)
      .maybeSingle<{ id: string }>();
    if (assetError) problems.push(`the image could not be loaded (${assetError.message})`);
    else if (!asset) problems.push('the image is not in this account\'s media library');
  }

  // The parent link the per-ad link hangs from.
  if (!campaign.destination_url) {
    problems.push('the campaign has no paid link');
  } else {
    const parent = resolveParentLink(campaign.source_snapshot, campaign.destination_url);
    view.parentShortCode = parent.parentShortCode;
    view.parentDestinationUrl = parent.parentDestinationUrl;
    if (!parent.parentShortCode || !WEEKDAY_CAMPAIGN_LEVEL_SHORT_CODES.includes(parent.parentShortCode)) {
      problems.push(`the campaign-level short code is ${parent.parentShortCode ?? 'missing'}, which is not one of the runbook's four`);
    } else if (expected.campaignLevelShortCode && parent.parentShortCode !== expected.campaignLevelShortCode) {
      problems.push(`the campaign-level short code is ${parent.parentShortCode}, expected ${expected.campaignLevelShortCode}`);
    }
  }
  if (view.challengerRow?.utm_content_key && findSnapshotVariants(campaign.source_snapshot, view.challengerRow.utm_content_key).length > 1) {
    problems.push('the snapshot holds more than one per-ad link for the challenger key; reconcile by hand');
  }

  // What Meta holds in the ad set, whatever its status.
  if (account.accessToken && adSet.meta_adset_id === expected.metaAdSetId) {
    try {
      const remoteAds = await meta.listAdSetAds(expected.metaAdSetId, account.accessToken);
      view.remoteListed = true;
      const remoteChallengers = remoteAds.filter((ad) => ad.name === CHALLENGER_AD_NAME);
      const remoteOthers = remoteAds.filter((ad) => ad.name !== CHALLENGER_AD_NAME).map((ad) => ad.id);
      if (!sameMembers(remoteOthers, expectedIds)) {
        problems.push(`Meta's ad set does not match the runbook: found ${remoteOthers.length} other ads (${remoteOthers.join(', ') || 'none'}), expected ${expectedIds.length} (${expectedIds.join(', ')})`);
      }
      for (const remote of remoteChallengers) {
        if (expectedIds.includes(remote.id)) problems.push(`an original ad on Meta (${remote.id}) carries the challenger's name`);
      }
      if (remoteChallengers.length > 1) {
        problems.push(`${remoteChallengers.length} ads on Meta are named "${CHALLENGER_AD_NAME}" (${remoteChallengers.map((ad) => ad.id).join(', ')}); Peter decides what to pause`);
      }
      view.remoteChallenger = remoteChallengers.length === 1 ? remoteChallengers[0]! : null;

      const savedAdId = view.challengerRow?.meta_ad_id ?? null;
      if (savedAdId && view.remoteChallenger && view.remoteChallenger.id !== savedAdId) {
        problems.push(`the saved challenger ad is ${savedAdId}, but Meta's challenger in this ad set is ${view.remoteChallenger.id}; reconcile by hand`);
      }
      if (savedAdId && remoteChallengers.length === 0) {
        problems.push(`the saved challenger ad ${savedAdId} is not in Meta's ad set under the challenger's name; reconcile by hand`);
      }
    } catch (error) {
      problems.push(`Meta's ads for the ad set could not be read (${describeError(error)})`);
    }
  }

  const row = view.challengerRow;
  view.record.stage = detectChallengerStage(row, campaign.source_snapshot);
  view.record.adRowId = row?.id ?? null;
  view.record.utmContentKey = row?.utm_content_key ?? null;
  view.record.metaCreativeId = row?.meta_creative_id ?? null;
  view.record.metaAdId = row?.meta_ad_id ?? null;
  view.record.localStatus = row?.status ?? null;
  const savedVariant = findSnapshotVariants(campaign.source_snapshot, row?.utm_content_key)[0];
  view.record.shortCode = savedVariant?.shortCode ?? null;
  view.record.shortUrl = savedVariant?.shortUrl ?? null;

  return view;
}

/** The account check: one GET for the account and one per ad set. Read only. */
async function readAccountCheck(run: Run, account: AccountContext): Promise<ChallengerCheck> {
  if (!account.accessToken || !account.adAccountId) {
    return { result: 'unverified', reasons: ['the ad account or its token is not available'] };
  }
  const { meta } = run.deps;
  const status = await meta.fetchAdAccountSpendStatus(account.adAccountId, account.accessToken);
  const remaining: Array<number | null> = [];
  for (const campaign of WEEKDAY_CAMPAIGNS) {
    remaining.push(await meta.fetchAdSetBudgetRemaining(campaign.metaAdSetId, account.accessToken));
  }
  const check = checkAccountHeadroom(status, remaining);

  const known = (value: number | null) => (value === null ? 'unknown' : formatPounds(value));
  const headroom =
    status.spendCapMinor !== null && status.amountSpentMinor !== null
      ? formatPounds(status.spendCapMinor - status.amountSpentMinor)
      : 'unknown';
  const stillToRun = remaining.some((value) => value === null)
    ? 'unknown'
    : formatPounds(remaining.reduce<number>((total, value) => total + (value ?? 0), 0));
  run.say(`  Ad account status ${status.accountStatus ?? 'unknown'}; spending limit ${known(status.spendCapMinor)}, spent ${known(status.amountSpentMinor)}, headroom ${headroom}; still to run on the four ad sets ${stillToRun}.`);
  return check;
}

/**
 * Loads the account and all four campaigns and prints every reason to stop. Returns null when
 * a run that creates or activates anything must stop before any write.
 */
async function preflight(
  run: Run,
  // Creating a paused ad spends nothing, so the spending-limit check only blocks activation.
  options: { accountCheckMustPass: boolean },
): Promise<{ account: AccountContext; views: CampaignRun[] } | null> {
  const problems: string[] = [];
  if (run.deps.graphVersion !== CREATIVE_FEATURES_GRAPH_VERSION) {
    problems.push(`the Graph API version is ${run.deps.graphVersion}, but the creative features were recorded on ${CREATIVE_FEATURES_GRAPH_VERSION}; read them again on this version first`);
  }

  const account = await loadAccountContext(run);
  problems.push(...account.problems);

  run.say('');
  run.say('Account');
  // The cheap read: it proves the token works before anything else is asked of Meta.
  if (account.accessToken && account.adAccountId) {
    try {
      run.manifest.accountCheck = await readAccountCheck(run, account);
      run.say(`  Account check: ${formatCheck(run.manifest.accountCheck)}`);
      if (options.accountCheckMustPass && run.manifest.accountCheck.result !== 'pass') {
        problems.push(`the account check is ${formatCheck(run.manifest.accountCheck)}`);
      }
    } catch (error) {
      problems.push(`Meta could not be read with the stored token (${describeError(error)})`);
    }
  }

  const views: CampaignRun[] = [];
  for (const spec of buildChallengerAdSpecs()) {
    const view = await inspectCampaign(run, spec, account);
    run.manifest.campaigns.push(view.record);
    views.push(view);
    for (const problem of view.problems) problems.push(`${spec.campaign.label}: ${problem}`);

    const copyProblems = findRewriteCopyProblems(spec.copy, { campaignName: view.campaign?.name ?? null });
    for (const problem of copyProblems) problems.push(`${spec.campaign.label}: the copy cannot be published because ${problem}`);
  }

  const parentCodes = views.map((view) => view.parentShortCode).filter((code): code is string => Boolean(code));
  if (new Set(parentCodes).size !== parentCodes.length) {
    problems.push('two campaigns share a campaign-level short code');
  }

  if (problems.length > 0) {
    run.say('');
    run.say('Stopped before any write. Reasons:');
    for (const problem of problems) run.say(`  - ${problem}`);
    run.manifest.stoppedReason = redactSecrets(problems.join('; '), run.secrets);
    for (const view of views) {
      if (view.problems.length > 0) view.record.stopped = redactSecrets(view.problems.join('; '), run.secrets);
    }
    return null;
  }
  return { account, views };
}

// ─── --dry-run and --apply ───────────────────────────────────────────────────────────────────

async function runCreate(run: Run, write: boolean): Promise<boolean> {
  const missing = APPLY_REQUIRED_CONFIRMATIONS.filter((check) => !run.options.confirmed.includes(check));
  if (write && missing.length > 0) {
    run.say('');
    run.say('Stopped before any write. These must be confirmed by hand first:');
    for (const check of missing) run.say(`  - ${check}: ${MANUAL_CHECKS[check]}`);
    run.say(`Then run again with --confirmed ${APPLY_REQUIRED_CONFIRMATIONS.join(',')}`);
    run.manifest.stoppedReason = `not confirmed: ${missing.join(', ')}`;
    return false;
  }

  const ready = await preflight(run, { accountCheckMustPass: false });
  if (!ready) return false;
  const { account, views } = ready;

  // Every Weekday campaign's keys, so a new key cannot collide across campaigns.
  const takenKeys = new Set<string>();
  for (const view of views) {
    for (const ad of view.ads) {
      if (ad.utm_content_key && ad.name !== CHALLENGER_AD_NAME) takenKeys.add(normaliseUtmContentKey(ad.utm_content_key));
    }
  }
  for (const view of views) {
    const savedKey = view.challengerRow?.utm_content_key;
    if (savedKey) takenKeys.add(normaliseUtmContentKey(savedKey));
  }

  let allReady = true;
  let anyStopped = false;
  for (const view of views) {
    run.say('');
    run.say(`${view.spec.campaign.label} (${view.spec.campaign.campaignId})`);
    printCopy(run, view.spec);
    for (const note of view.notes) run.say(`  Note: ${note}`);
    try {
      const reached = await advanceCampaign(run, account, view, takenKeys, write);
      if (!reached) allReady = false;
    } catch (error) {
      allReady = false;
      anyStopped = true;
      view.record.stopped = redactSecrets(describeError(error), run.secrets);
      run.say(`  Stopped this campaign: ${describeError(error)}`);
      if (error instanceof RunStop) {
        run.say('  Nothing more is created in this run, because what Meta holds could not be read.');
        throw error;
      }
    }
  }

  printManualChecks(run, ACTIVATE_REQUIRED_CONFIRMATIONS);
  printSummary(run, views);
  if (!write) {
    run.say('');
    run.say(`Dry run only. To create the four ads PAUSED: --apply --confirmed ${APPLY_REQUIRED_CONFIRMATIONS.join(',')}`);
    return !anyStopped;
  }
  return allReady;
}

/**
 * Takes one campaign from wherever it got to as far as S5. In a dry run (`write` false) it
 * prints what it would do and stops at the first step that would need a write. Returns true
 * when the challenger exists on Meta and every read-back check passed.
 */
async function advanceCampaign(
  run: Run,
  account: AccountContext,
  view: CampaignRun,
  takenKeys: Set<string>,
  write: boolean,
): Promise<boolean> {
  const { supabase, meta, management } = run.deps;
  const { spec, record } = view;
  const campaign = view.campaign!;
  const adSet = view.adSet!;
  const accessToken = account.accessToken!;
  const adAccountId = account.adAccountId!;
  const parentShortCode = view.parentShortCode!;

  // ── S1: the key and the row ──────────────────────────────────────────────────────────────
  let row = view.challengerRow;
  if (row && !row.utm_content_key?.trim()) {
    throw new CampaignStop(`the challenger row ${row.id} has no saved key; a key is never built a second time, so reconcile by hand`);
  }
  if (row) assertRowMatchesSpec(row, view);

  const keys = buildChallengerKeys({
    campaignName: campaign.name,
    adSetName: adSet.name,
    creativeFormat: view.creativeFormat,
    savedRow: row,
    takenKeys,
  });
  takenKeys.add(normaliseUtmContentKey(keys.utmContentKey));
  record.utmContentKey = keys.utmContentKey;

  if (row) {
    run.say(`  S1 row: exists (${row.id}); saved key reused: ${keys.utmContentKey}`);
  } else if (!write) {
    run.say(`  S1 row: would insert an ads row named "${CHALLENGER_AD_NAME}", status DRAFT, with key ${keys.utmContentKey}`);
    run.say(`          image ${view.mediaAssetId}, format ${view.creativeFormat}, button ${CHALLENGER_CTA}`);
    run.say(`  S2 link: would ask the management app for a per-ad link under parent ${parentShortCode}, then add it to the campaign snapshot`);
    printRemainingPlan(run, view, 'S3');
    return false;
  } else {
    row = await insertChallengerRow(supabase, view, keys);
    view.challengerRow = row;
    record.adRowId = row.id;
    record.localStatus = row.status;
    markStage(view, row);
    run.say(`  S1 row: inserted ${row.id} with key ${keys.utmContentKey}`);
  }

  // ── S2: the short link and the snapshot ──────────────────────────────────────────────────
  const reservedShortCodes = [
    ...WEEKDAY_CAMPAIGN_LEVEL_SHORT_CODES,
    ...WEEKDAY_CAMPAIGNS.flatMap((weekday) => weekday.originalShortCodes),
  ];
  const savedVariants = findSnapshotVariants(campaign.source_snapshot, keys.utmContentKey);
  const expectation: VariantExpectation = {
    utmContentKey: keys.utmContentKey,
    parentShortCode,
    utmCampaign: spec.campaign.utmCampaign,
    reservedShortCodes,
    savedShortCode: savedVariants[0]?.shortCode ?? null,
  };

  let variant = savedVariants[0] ?? null;
  if (variant) {
    const problem = findVariantProblem(variant, expectation);
    if (problem) throw new CampaignStop(`the saved short link cannot be used: ${problem}`);
    run.say(`  S2 link: saved (${variant.shortUrl})`);
  } else if (!write) {
    run.say(`  S2 link: would ask the management app for a per-ad link under parent ${parentShortCode}, then add it to the campaign snapshot`);
    printRemainingPlan(run, view, 'S3');
    return false;
  } else {
    const request = buildLinkRequest(view, keys);
    let link: ManagementMetaAdsLink;
    try {
      link = await management.createMetaAdsLink(account.management!, request);
    } catch (error) {
      // Safe to run again: the management app returns the same link for the same parent and key.
      throw new CampaignStop(`the management app did not confirm the short link (${describeError(error)}). Run again: the same link comes back.`);
    }
    const selection = selectChallengerVariant(link.variants, expectation);
    if (!selection.ok) throw new CampaignStop(`the short link response cannot be used: ${selection.reason}`);
    variant = selection.variant;
    run.say(`  S2 link: ${variant.alreadyExists ? 'already existed' : 'created'} ${variant.shortUrl}`);

    try {
      campaign.source_snapshot = await saveSnapshotVariant(supabase, campaign.id, variant);
    } catch (error) {
      throw new CampaignStop(`short link ${variant.shortCode} exists in the management app but the snapshot was not saved (${describeError(error)}). Run again: the same link comes back and is saved.`);
    }
    markStage(view, row);
    run.say('  S2 snapshot: per-ad link added; every existing entry left as it was');
  }
  record.shortCode = variant.shortCode;
  record.shortUrl = variant.shortUrl;

  // The creative must point at the challenger's own link, never the campaign-level one.
  const linkUrl = resolveAdLinkUrl({
    campaignKind: campaign.campaign_kind,
    destinationUrl: campaign.destination_url!,
    sourceSnapshot: campaign.source_snapshot,
    utmContentKey: keys.utmContentKey,
  });
  if (!isSameLink(linkUrl, variant.shortUrl) || extractShortCode(linkUrl) === parentShortCode) {
    throw new CampaignStop(`the creative link resolved to ${linkUrl}, not the challenger's own link ${variant.shortUrl}`);
  }

  // ── S3 and S4: the creative and the ad ───────────────────────────────────────────────────
  let creativeId = row.meta_creative_id;
  let adId = row.meta_ad_id;
  const remote = view.remoteChallenger;

  if (!adId && remote) {
    // Meta already holds an ad under the challenger's name: adopt it, never create another.
    const status = remote.configuredStatus?.toUpperCase();
    if (status !== 'PAUSED' && status !== 'ACTIVE') {
      throw new CampaignStop(`Meta already holds challenger ad ${remote.id} in state ${status ?? 'unknown'}; it was not adopted. Reconcile by hand.`);
    }
    if (!remote.creativeId || (creativeId && creativeId !== remote.creativeId)) {
      throw new CampaignStop(`Meta already holds challenger ad ${remote.id}, but its creative (${remote.creativeId ?? 'unknown'}) is not the saved one (${creativeId ?? 'none'}). Reconcile by hand.`);
    }
    if (!write) {
      run.say(`  S3/S4: would save the ids of the ad Meta already holds (${remote.id}, creative ${remote.creativeId}); nothing would be created`);
    } else {
      await saveRow(supabase, row, { meta_creative_id: remote.creativeId, meta_ad_id: remote.id, status, meta_status: status },
        `ad ${remote.id} exists on Meta but its id was not saved`);
      run.say(`  S3/S4: found exactly one ad on Meta under the challenger's name (${remote.id}); its ids are saved, nothing was created`);
    }
    creativeId = remote.creativeId;
    adId = remote.id;
  }

  if (!adId) {
    if (creativeId) {
      // A known creative is recovered by its stored id (a GET), never made again.
      const creative = await readOrStop(() => meta.readAdCreative(creativeId!, accessToken), `the saved creative ${creativeId}`);
      if (creative.name !== CHALLENGER_AD_NAME || !isSameLink(creative.link, variant.shortUrl)) {
        throw new CampaignStop(`the saved creative ${creativeId} is not the challenger's (name "${creative.name ?? 'unknown'}", link ${creative.link ?? 'unknown'}). Reconcile by hand.`);
      }
      run.say(`  S3 creative: saved (${creativeId})`);
    } else {
      const decision = decideReconciliation(await listMatchingCreatives(meta, adAccountId, accessToken, variant.shortUrl));
      if (decision.action === 'stop') {
        throw new CampaignStop(`${decision.matches.length} creatives on Meta carry the challenger's name and link (${decision.matches.map((match) => match.id).join(', ')}). Reconcile by hand.`);
      }
      if (decision.action === 'adopt') {
        creativeId = decision.match.id;
        if (!write) {
          run.say(`  S3 creative: would save the id of the creative Meta already holds (${creativeId}); none would be created`);
        } else {
          await saveRow(supabase, row, { meta_creative_id: creativeId }, `creative ${creativeId} exists on Meta but its id was not saved`);
          run.say(`  S3 creative: found exactly one on Meta (${creativeId}); its id is saved, nothing was created`);
        }
      } else if (!write) {
        printRemainingPlan(run, view, 'S3');
        return false;
      } else {
        creativeId = await createCreative(run, account, view, row, linkUrl);
      }
    }
    record.metaCreativeId = creativeId;
    markStage(view, row);

    if (!write) {
      printRemainingPlan(run, view, 'S4');
      return false;
    }
    adId = await createAd(run, account, view, row, creativeId!);
  }
  record.metaCreativeId = creativeId;
  record.metaAdId = adId;
  record.localStatus = row.status;
  markStage(view, row);

  // ── S5: read back ────────────────────────────────────────────────────────────────────────
  const expectedStatus = row.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
  const readBack = await readOrStop(() => meta.readAdForLaunch(adId!, accessToken), `ad ${adId}`);
  const passed = recordReadBack(run, account, view, readBack, variant.shortUrl, expectedStatus);
  const stored = detectChallengerStage(row, campaign.source_snapshot);
  // S5 is this run's finding, not a stored fact: a paused ad whose every check passed.
  record.stage = passed && stored === 'S4' ? 'S5' : stored;
  run.say(`  Stage: ${record.stage}${passed ? '' : ' (a check above is not a pass)'}`);
  return passed;
}

/** Records how far the stored evidence shows this campaign has got. */
function markStage(view: CampaignRun, row: ChallengerAdRow | null): void {
  view.record.stage = detectChallengerStage(row, view.campaign?.source_snapshot);
}

function assertRowMatchesSpec(row: ChallengerAdRow, view: CampaignRun): void {
  const { copy } = view.spec;
  const differences: string[] = [];
  if (row.headline !== copy.headline) differences.push('headline');
  if (row.primary_text !== copy.primaryText) differences.push('primary text');
  if (row.description !== copy.description) differences.push('description');
  if (row.cta !== CHALLENGER_CTA) differences.push('button');
  if (row.media_asset_id !== view.mediaAssetId) differences.push('image');
  if (differences.length > 0) {
    throw new CampaignStop(`the saved challenger row ${row.id} no longer matches the spec (${differences.join(', ')}); reconcile by hand`);
  }
}

async function insertChallengerRow(
  supabase: SupabaseClientLike,
  view: CampaignRun,
  keys: ChallengerKeys,
): Promise<ChallengerAdRow> {
  const { copy } = view.spec;
  const { data, error } = await supabase
    .from('ads')
    .insert({
      adset_id: view.adSet!.id,
      name: CHALLENGER_AD_NAME,
      headline: copy.headline,
      primary_text: copy.primaryText,
      description: copy.description,
      cta: CHALLENGER_CTA,
      angle: CHALLENGER_ANGLE,
      media_asset_id: view.mediaAssetId,
      creative_brief: CHALLENGER_CREATIVE_BRIEF,
      creative_format: view.creativeFormat,
      creative_variant_key: keys.creativeVariantKey,
      utm_content_key: keys.utmContentKey,
      status: 'DRAFT',
    })
    .select(AD_COLUMNS)
    .single<ChallengerAdRow>();
  if (error || !data) {
    throw new CampaignStop(`the ads row could not be inserted (${error?.message ?? 'no row returned'}); nothing else was done`);
  }
  return data;
}

/** Updates the one challenger row, and fails unless exactly that row was changed. */
async function saveRow(
  supabase: SupabaseClientLike,
  row: ChallengerAdRow,
  patch: Partial<Pick<ChallengerAdRow, 'meta_creative_id' | 'meta_ad_id' | 'status' | 'meta_status'>>,
  whatIsAtStake: string,
): Promise<void> {
  // ads has no account_id column: the row is scoped by its id and its ad set, which was reached
  // through a campaign loaded with the account filter.
  const { data, error } = await supabase
    .from('ads')
    .update(patch)
    .eq('id', row.id)
    .eq('adset_id', row.adset_id)
    .select('id');
  const updated = Array.isArray(data) ? data.length : 0;
  if (error || updated !== 1) {
    throw new CampaignStop(`${whatIsAtStake} (${error?.message ?? `${updated} rows changed`}). The next run finds it on Meta and saves it; nothing is created twice.`);
  }
  Object.assign(row, patch);
}

/**
 * Re-reads the latest snapshot immediately before writing and adds only the one new entry. With
 * the single-run lock held, no other writer touches these snapshots: publishing is done, and the
 * optimiser refuses controlled-test campaigns.
 */
async function saveSnapshotVariant(
  supabase: SupabaseClientLike,
  campaignId: string,
  variant: ManagementMetaAdsLinkVariant,
): Promise<Record<string, unknown>> {
  const { data: latest, error: readError } = await supabase
    .from('meta_campaigns')
    .select('source_snapshot')
    .eq('id', campaignId)
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .maybeSingle<{ source_snapshot: Record<string, unknown> | null }>();
  if (readError || !latest) throw new Error(readError?.message ?? 'the campaign was not found');

  const merged = mergeChallengerVariant(latest.source_snapshot, variant);
  if (!merged.changed) return merged.snapshot;

  const { data, error } = await supabase
    .from('meta_campaigns')
    .update({ source_snapshot: merged.snapshot })
    .eq('id', campaignId)
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .select('id');
  const updated = Array.isArray(data) ? data.length : 0;
  if (error || updated !== 1) throw new Error(error?.message ?? `${updated} rows changed`);
  return merged.snapshot;
}

function buildLinkRequest(view: CampaignRun, keys: ChallengerKeys): ManagementMetaAdsLinkInput {
  const campaign = view.campaign!;
  const snapshot = campaign.source_snapshot ?? {};
  // Built as publishing builds it, so the management app sees a request of the usual shape.
  const [variant] = collectManagementMetaAdVariants({
    campaignName: campaign.name,
    adSets: [{
      name: view.adSet!.name,
      ads: [{
        name: CHALLENGER_AD_NAME,
        angle: CHALLENGER_ANGLE,
        creative_format: view.creativeFormat,
        creative_variant_key: keys.creativeVariantKey,
        utm_content_key: keys.utmContentKey,
      }],
    }],
  });

  return {
    destinationUrl: view.parentDestinationUrl!,
    campaignName: campaign.name,
    eventId: stringValue(snapshot.eventId),
    parentShortCode: view.parentShortCode!,
    variants: [{ utmContent: variant!.utmContent, name: variant!.name, metadata: variant!.metadata }],
    metadata: {
      campaign_kind: campaign.campaign_kind ?? null,
      source_type: snapshot.sourceType ?? null,
      source_id: snapshot.sourceId ?? null,
    },
  };
}

/** Creatives named as the challenger that point at this campaign's own link. */
async function listMatchingCreatives(
  meta: ChallengerMetaClient,
  adAccountId: string,
  accessToken: string,
  shortUrl: string,
): Promise<MetaAdCreativeSummary[]> {
  // All four challengers' creatives share one name, so the link tells them apart.
  const named = await meta.listAdCreativesNamed(adAccountId, accessToken, CHALLENGER_AD_NAME);
  return named.filter((creative) => creative.name === CHALLENGER_AD_NAME && isSameLink(creative.link, shortUrl));
}

async function createCreative(
  run: Run,
  account: AccountContext,
  view: CampaignRun,
  row: ChallengerAdRow,
  linkUrl: string,
): Promise<string> {
  const { supabase, meta } = run.deps;
  const { copy } = view.spec;
  const accessToken = account.accessToken!;
  const adAccountId = account.adAccountId!;

  const imageUrl = await signedImageUrl(run, view.mediaAssetId!);
  let imageHash: string;
  try {
    // An image is stored by its content, so uploading the same bytes again cannot duplicate it.
    ({ hash: imageHash } = await meta.uploadImage(adAccountId, accessToken, imageUrl));
  } catch (error) {
    throw new CampaignStop(`the image could not be uploaded to Meta (${describeError(error)}); no creative or ad was created`);
  }

  let creativeId: string;
  try {
    ({ id: creativeId } = await meta.createAdCreative({
      accessToken,
      adAccountId,
      name: CHALLENGER_AD_NAME,
      pageId: account.pageId!,
      linkUrl,
      imageHash,
      message: copy.primaryText,
      headline: copy.headline,
      description: copy.description,
      callToActionType: CHALLENGER_CTA,
      optOutCreativeEnhancements: true,
    }));
  } catch (error) {
    // Meta did not confirm: it may or may not have made the creative. Ask before anything else.
    run.say(`  S3 creative: Meta did not confirm the creative (${describeError(error)}). Checking what Meta holds.`);
    const after = await listOrStopRun(() => listMatchingCreatives(meta, adAccountId, accessToken, linkUrl));
    const decision = decideReconciliation(after);
    if (decision.action === 'create') {
      throw new CampaignStop('Meta holds no creative for this challenger, so nothing was created. The next run may create it.');
    }
    if (decision.action === 'stop') {
      throw new CampaignStop(`${decision.matches.length} creatives on Meta carry the challenger's name and link (${decision.matches.map((match) => match.id).join(', ')}). Reconcile by hand.`);
    }
    creativeId = decision.match.id;
    run.say(`  S3 creative: Meta holds exactly one (${creativeId}); carrying on with it`);
  }

  // Saved straight away, so a later failure cannot orphan it.
  await saveRow(supabase, row, { meta_creative_id: creativeId }, `creative ${creativeId} exists on Meta but its id was not saved`);
  view.record.metaCreativeId = creativeId;
  markStage(view, row);
  run.say(`  S3 creative: created ${creativeId}, every automatic creative change opted out`);
  return creativeId;
}

async function createAd(
  run: Run,
  account: AccountContext,
  view: CampaignRun,
  row: ChallengerAdRow,
  creativeId: string,
): Promise<string> {
  const { supabase, meta } = run.deps;
  const accessToken = account.accessToken!;
  const metaAdSetId = view.spec.campaign.metaAdSetId;

  const listChallengers = async () =>
    (await meta.listAdSetAds(metaAdSetId, accessToken)).filter((ad) => ad.name === CHALLENGER_AD_NAME);

  // Asked again immediately before creating, so the answer is seconds old: the list taken when
  // the run began could be minutes old by the time the fourth campaign is reached.
  let decision = decideReconciliation(await readOrStop(listChallengers, `Meta's ads for ad set ${metaAdSetId}`));
  let created = false;
  if (decision.action === 'create') {
    try {
      // PAUSED: a paused ad does not deliver or spend. Only --activate switches it on.
      const ad = await meta.createAd({
        accessToken,
        adAccountId: account.adAccountId!,
        name: CHALLENGER_AD_NAME,
        adsetId: metaAdSetId,
        creativeId,
        status: 'PAUSED',
      });
      created = true;
      decision = { action: 'adopt', match: { id: ad.id, name: CHALLENGER_AD_NAME, configuredStatus: 'PAUSED', effectiveStatus: null, creativeId } };
    } catch (error) {
      // Meta did not confirm: it may or may not have made the ad. Ask before anything else.
      run.say(`  S4 ad: Meta did not confirm the ad (${describeError(error)}). Checking what Meta holds.`);
      decision = decideReconciliation(await listOrStopRun(listChallengers));
      if (decision.action === 'create') {
        throw new CampaignStop('Meta holds no challenger ad in this ad set, so nothing was created. The next run may create it.');
      }
    }
  }

  if (decision.action !== 'adopt') {
    const ids = decision.action === 'stop' ? decision.matches.map((match) => match.id).join(', ') : '';
    throw new CampaignStop(`more than one ad on Meta is named as the challenger (${ids}). Peter decides what to pause.`);
  }
  const ad = decision.match;
  if (ad.creativeId !== creativeId) {
    throw new CampaignStop(`Meta holds challenger ad ${ad.id}, but with creative ${ad.creativeId ?? 'unknown'}, not ${creativeId}. Reconcile by hand.`);
  }
  if (ad.configuredStatus?.toUpperCase() !== 'PAUSED') {
    throw new CampaignStop(`Meta holds challenger ad ${ad.id} in state ${ad.configuredStatus ?? 'unknown'}, not PAUSED; it was not adopted. Reconcile by hand.`);
  }
  if (!created) run.say(`  S4 ad: Meta holds exactly one (${ad.id}); carrying on with it, nothing more is created`);

  await saveRow(supabase, row, { meta_ad_id: ad.id, status: 'PAUSED', meta_status: 'PAUSED' }, `ad ${ad.id} exists on Meta, paused, but its id was not saved`);
  view.record.metaAdId = ad.id;
  markStage(view, row);
  run.say(`  S4 ad: ${created ? 'created' : 'saved'} ${ad.id}, PAUSED`);
  return ad.id;
}

async function signedImageUrl(run: Run, assetId: string): Promise<string> {
  const { supabase } = run.deps;
  const { data: asset, error } = await supabase
    .from('media_assets')
    .select('id, storage_path')
    .eq('id', assetId)
    .eq('account_id', WEEKDAY_ACCOUNT_ID)
    .maybeSingle<{ id: string; storage_path: string | null }>();
  if (error || !asset?.storage_path) {
    throw new CampaignStop(`the image could not be loaded (${error?.message ?? 'no storage path'}); nothing was created`);
  }

  const storagePath = asset.storage_path.startsWith(`${MEDIA_BUCKET}/`)
    ? asset.storage_path.slice(MEDIA_BUCKET.length + 1)
    : asset.storage_path;
  // A short-lived signed address for Meta to fetch the image from. It is never printed.
  const { data: signed, error: signError } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(storagePath, 300);
  if (signError || !signed?.signedUrl) {
    throw new CampaignStop(`the image could not be prepared (${signError?.message ?? 'no signed address'}); nothing was created`);
  }
  run.secrets.add(signed.signedUrl);
  return signed.signedUrl;
}

/** A read that must succeed for this campaign to carry on. */
async function readOrStop<T>(read: () => Promise<T>, what: string): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CampaignStop(`${what} could not be read from Meta (${describeError(error)})`);
  }
}

/** The read that follows an unconfirmed create. If it fails, nothing more may be created. */
async function listOrStopRun<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new RunStop(`Meta could not be read after an unconfirmed create (${describeError(error)}). Run --status, then run again: the next run asks Meta what it holds before it creates anything.`);
  }
}

/** Runs the read-back checks, prints them, records them, and says whether every one passed. */
function recordReadBack(
  run: Run,
  account: AccountContext,
  view: CampaignRun,
  readBack: MetaAdLaunchReadBack,
  expectedLink: string,
  expectedStatus: 'ACTIVE' | 'PAUSED',
): boolean {
  const checks: Record<string, ChallengerCheck> = compareChallengerReadBack({
    readBack,
    copy: view.spec.copy,
    expectedLink,
    campaignLevelShortCode: view.parentShortCode ?? '',
    expectedStatus,
    expectedAdSetId: view.spec.campaign.metaAdSetId,
    expectedPageId: account.pageId ?? WEEKDAY_FACEBOOK_PAGE_ID,
  });
  // Runbook check 12: the optimiser refuses a controlled-test campaign, so it cannot rewrite this.
  checks.automation = view.campaign?.controlled_test === true
    ? { result: 'pass', reasons: [] }
    : { result: 'fail', reasons: ['the campaign is not marked as a controlled test, so the optimiser could change it'] };

  view.record.checks = checks;
  view.record.remoteConfiguredStatus = readBack.configuredStatus;
  view.record.remoteEffectiveStatus = readBack.effectiveStatus;

  run.say(`  S5 read-back of ad ${readBack.adId} (Meta: set to ${readBack.configuredStatus ?? 'unknown'}, effective ${readBack.effectiveStatus ?? 'unknown'}):`);
  for (const [name, check] of Object.entries(checks)) run.say(`    ${name}: ${formatCheck(check)}`);
  return Object.values(checks).every((check) => check.result === 'pass');
}

// ─── --status ────────────────────────────────────────────────────────────────────────────────

async function runStatus(run: Run): Promise<boolean> {
  const account = await loadAccountContext(run);
  if (account.problems.length > 0) {
    run.say('');
    run.say('Account problems:');
    for (const problem of account.problems) run.say(`  - ${problem}`);
  }
  run.say('');
  run.say('Account');
  if (account.accessToken && account.adAccountId) {
    try {
      run.manifest.accountCheck = await readAccountCheck(run, account);
      run.say(`  Account check: ${formatCheck(run.manifest.accountCheck)}`);
    } catch (error) {
      run.say(`  Meta could not be read with the stored token (${describeError(error)})`);
      return false;
    }
  }

  let readable = Boolean(account.accessToken);
  const views: CampaignRun[] = [];
  for (const spec of buildChallengerAdSpecs()) {
    const view = await inspectCampaign(run, spec, account);
    run.manifest.campaigns.push(view.record);
    views.push(view);

    run.say('');
    run.say(`${spec.campaign.label} (${spec.campaign.campaignId})`);
    for (const problem of view.problems) run.say(`  Note: ${problem}`);
    const row = view.challengerRow;
    run.say(`  Stage: ${view.record.stage}`);
    run.say(`  Local row: ${row ? `${row.id}, status ${row.status}, Meta status ${row.meta_status ?? 'none'}` : 'none'}`);
    run.say(`  Short link: ${view.record.shortUrl ?? 'none saved'}`);

    const adId = row?.meta_ad_id ?? view.remoteChallenger?.id ?? null;
    if (!adId || !account.accessToken) {
      // "None" is only said when Meta was actually asked.
      run.say(view.remoteListed ? '  On Meta: no challenger ad' : '  On Meta: not checked (Meta could not be read for this ad set)');
      if (!view.remoteListed) readable = false;
      continue;
    }
    if (!row?.meta_ad_id) run.say(`  On Meta: ad ${adId} carries the challenger's name but its id is not saved locally`);
    try {
      const readBack = await run.deps.meta.readAdForLaunch(adId, account.accessToken);
      const expectedStatus = readBack.configuredStatus?.toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
      const passed = recordReadBack(run, account, view, readBack, view.record.shortUrl ?? '', expectedStatus);
      if (passed && view.record.stage === 'S4') view.record.stage = 'S5';
      if (row && row.status !== (readBack.configuredStatus ?? '')) {
        run.say(`  Mismatch: the local row says ${row.status}, Meta says ${readBack.configuredStatus ?? 'unknown'}`);
      }
      run.say(`  Review: ${formatCheck(view.record.checks.review!)}`);
    } catch (error) {
      readable = false;
      run.say(`  Meta could not be read for ad ${adId} (${describeError(error)})`);
    }
  }

  printManualChecks(run, ACTIVATE_REQUIRED_CONFIRMATIONS);
  printSummary(run, views);
  return readable;
}

// ─── --activate ──────────────────────────────────────────────────────────────────────────────

async function runActivate(run: Run): Promise<boolean> {
  const { supabase, meta } = run.deps;
  const missing = ACTIVATE_REQUIRED_CONFIRMATIONS.filter((check) => !run.options.confirmed.includes(check));
  if (missing.length > 0) {
    run.say('');
    run.say('Stopped before any write. These must be confirmed by hand first:');
    for (const check of missing) run.say(`  - ${check}: ${MANUAL_CHECKS[check]}`);
    run.say(`Then run again with --confirmed ${ACTIVATE_REQUIRED_CONFIRMATIONS.join(',')}`);
    run.manifest.stoppedReason = `not confirmed: ${missing.join(', ')}`;
    return false;
  }

  const ready = await preflight(run, { accountCheckMustPass: true });
  if (!ready) return false;
  const { account, views } = ready;
  const accessToken = account.accessToken!;

  // Pass 1, reads and local reconciliation only: every campaign must be at S5 before any is switched on.
  const toActivate: CampaignRun[] = [];
  const blockers: string[] = [];
  for (const view of views) {
    const label = view.spec.campaign.label;
    const row = view.challengerRow;
    run.say('');
    run.say(`${label} (${view.spec.campaign.campaignId})`);
    if (!row?.meta_ad_id || !view.record.shortUrl) {
      blockers.push(`${label}: the challenger has not been created (stage ${view.record.stage}); run --apply first`);
      run.say(`  Not ready: stage ${view.record.stage}`);
      continue;
    }

    let readBack: MetaAdLaunchReadBack;
    try {
      readBack = await meta.readAdForLaunch(row.meta_ad_id, accessToken);
    } catch (error) {
      blockers.push(`${label}: the ad could not be read from Meta (${describeError(error)})`);
      continue;
    }

    const liveOnMeta = readBack.configuredStatus?.toUpperCase() === 'ACTIVE';
    recordReadBack(run, account, view, readBack, view.record.shortUrl, liveOnMeta ? 'ACTIVE' : 'PAUSED');
    const failing = Object.entries(view.record.checks).filter(([name, check]) =>
      // Review of an ad that is already live is allowed to be pending; it is never allowed to fail.
      liveOnMeta && name === 'review' ? check.result === 'fail' : check.result !== 'pass');
    for (const [name, check] of failing) blockers.push(`${label}: ${name} is ${formatCheck(check)}`);

    if (liveOnMeta) {
      if (row.status !== 'ACTIVE' || row.meta_status !== 'ACTIVE') {
        // An earlier activation switched it on but the local save failed: follow Meta's state.
        try {
          await saveRow(supabase, row, { status: 'ACTIVE', meta_status: 'ACTIVE' }, `ad ${row.meta_ad_id} is live on Meta but the local row still says ${row.status}`);
          run.say('  Already live on Meta from an earlier run; the local row now says ACTIVE too');
        } catch (error) {
          blockers.push(`${label}: ${describeError(error)}`);
          run.say(`  ${describeError(error)}`);
          continue;
        }
      } else {
        run.say('  Already live');
      }
      view.record.localStatus = 'ACTIVE';
      view.record.stage = 'S6';
      continue;
    }

    if (failing.length === 0) {
      view.record.stage = 'S5';
      toActivate.push(view);
    }
  }

  if (blockers.length > 0) {
    run.say('');
    run.say('No ad was switched on. Every campaign must pass every check first:');
    for (const blocker of blockers) run.say(`  - ${blocker}`);
    run.manifest.stoppedReason = redactSecrets(blockers.join('; '), run.secrets);
    printSummary(run, views);
    return false;
  }

  // Pass 2: switch on, read Meta back, and only then record it locally.
  let allLive = true;
  for (const view of toActivate) {
    const label = view.spec.campaign.label;
    const row = view.challengerRow!;
    const adId = row.meta_ad_id!;
    run.say('');
    run.say(`${label}: switching on ad ${adId}`);

    let switchError: unknown = null;
    try {
      await meta.setObjectStatus(adId, accessToken, 'ACTIVE');
    } catch (error) {
      switchError = error;
      run.say(`  Meta did not confirm the switch (${describeError(error)}). Reading Meta's state.`);
    }

    const after = await listOrStopRunForStatus(() => meta.readAdForLaunch(adId, accessToken), adId);
    view.record.remoteConfiguredStatus = after.configuredStatus;
    view.record.remoteEffectiveStatus = after.effectiveStatus;
    if (after.configuredStatus?.toUpperCase() !== 'ACTIVE') {
      allLive = false;
      view.record.stopped = `Meta still shows ad ${adId} as ${after.configuredStatus ?? 'unknown'}${switchError ? ` (${redactSecrets(describeError(switchError), run.secrets)})` : ''}`;
      run.say(`  Not switched on: Meta shows ${after.configuredStatus ?? 'unknown'}. The local row is unchanged.`);
      continue;
    }

    try {
      await saveRow(supabase, row, { status: 'ACTIVE', meta_status: 'ACTIVE' }, `ad ${adId} is live on Meta but the local row still says ${row.status}`);
      view.record.localStatus = 'ACTIVE';
      view.record.stage = 'S6';
      run.say('  Live on Meta, confirmed by reading it back; the local row says ACTIVE');
    } catch (error) {
      allLive = false;
      view.record.stopped = redactSecrets(describeError(error), run.secrets);
      run.say(`  Mismatch: ${describeError(error)}`);
    }

    const review = checkAdReview(after, 'ACTIVE');
    view.record.checks.review = review;
    run.say(`  Review: ${formatCheck(review)}`);
  }

  printSummary(run, views);
  run.say('');
  run.say('Meta review after activation shows as pending, never as a pass. Run --status every 15 minutes for up to 2 hours; anything still pending or rejected after that goes to Peter.');
  return allLive;
}

/** After a switch, Meta's state must be read. If it cannot be, the run stops and says so. */
async function listOrStopRunForStatus(read: () => Promise<MetaAdLaunchReadBack>, adId: string): Promise<MetaAdLaunchReadBack> {
  try {
    return await read();
  } catch (error) {
    throw new RunStop(`Meta could not be read after a status change to ad ${adId} (${describeError(error)}), so its state is not known. Run --status now; the next run follows Meta's state.`);
  }
}

// ─── --pause ─────────────────────────────────────────────────────────────────────────────────

/**
 * Rollback. Pauses every identified challenger, by its saved id or else by its name in the ad
 * set. Nothing that only matters for creating (campaign state, copy, flight, object counts)
 * can block it. An ad counts as paused only after Meta has been read back.
 */
async function runPause(run: Run): Promise<boolean> {
  const { supabase, meta } = run.deps;
  const account = await loadAccountContext(run);
  if (!account.accessToken) {
    run.say('');
    run.say('Stopped: the Meta Ads token is not available, so nothing can be paused from here.');
    for (const problem of account.problems) run.say(`  - ${problem}`);
    run.say('Pause the ads through the CheersAI app or the Graph API instead (runbook section 6).');
    run.manifest.stoppedReason = 'the Meta Ads token is not available';
    return false;
  }
  const accessToken = account.accessToken;

  let clean = true;
  const stillActive: string[] = [];
  for (const spec of buildChallengerAdSpecs()) {
    const expected = spec.campaign;
    const record = newRecord(spec);
    run.manifest.campaigns.push(record);
    run.say('');
    run.say(`${expected.label} (${expected.campaignId})`);

    // Local rows, if they can be read. A campaign that is no longer ACTIVE is still handled.
    let rows: ChallengerAdRow[] = [];
    try {
      const records = await loadCampaignRecords(supabase, expected.campaignId);
      rows = records.ads.filter((ad) => ad.name === CHALLENGER_AD_NAME);
      record.stage = detectChallengerStage(rows[0], records.campaign?.source_snapshot);
    } catch (error) {
      clean = false;
      run.say(`  The local records could not be read (${describeError(error)}); pausing by name on Meta only`);
    }

    const protectedIds = new Set([...expected.originalMetaAdIds, ...expected.otherKnownMetaAdIds]);
    const targets = new Map<string, MetaAdSetAdSummary | null>();
    for (const row of rows) {
      if (row.meta_ad_id) targets.set(row.meta_ad_id, null);
    }
    try {
      const remote = (await meta.listAdSetAds(expected.metaAdSetId, accessToken)).filter((ad) => ad.name === CHALLENGER_AD_NAME);
      for (const ad of remote) targets.set(ad.id, ad);
    } catch (error) {
      clean = false;
      run.say(`  Meta's ads for the ad set could not be listed (${describeError(error)}); using saved ids only`);
    }
    for (const id of Array.from(targets.keys())) {
      if (protectedIds.has(id)) {
        // The originals and the paused rewrite are never touched.
        targets.delete(id);
        clean = false;
        run.say(`  Skipped ${id}: it is an original ad, not a challenger`);
      }
    }

    if (targets.size === 0) {
      run.say('  No challenger ad found, by saved id or by name. Nothing to pause.');
      continue;
    }

    for (const [adId, listed] of targets) {
      record.metaAdId = adId;
      let pausedOnMeta = false;
      try {
        const before = await meta.readAdForLaunch(adId, accessToken);
        if (before.configuredStatus?.toUpperCase() === 'PAUSED') {
          pausedOnMeta = true;
          record.remoteConfiguredStatus = before.configuredStatus;
          record.remoteEffectiveStatus = before.effectiveStatus;
          run.say(`  Ad ${adId}: already paused on Meta`);
        }
      } catch {
        // Not readable: try the pause anyway, then read again.
      }

      if (!pausedOnMeta) {
        try {
          await meta.setObjectStatus(adId, accessToken, 'PAUSED');
        } catch (error) {
          run.say(`  Ad ${adId}: Meta did not confirm the pause (${describeError(error)}). Reading Meta's state.`);
        }
        try {
          const after = await meta.readAdForLaunch(adId, accessToken);
          record.remoteConfiguredStatus = after.configuredStatus;
          record.remoteEffectiveStatus = after.effectiveStatus;
          pausedOnMeta = after.configuredStatus?.toUpperCase() === 'PAUSED';
          run.say(pausedOnMeta
            ? `  Ad ${adId}: paused on Meta, confirmed by reading it back`
            : `  Ad ${adId}: NOT paused. Meta shows ${after.configuredStatus ?? 'unknown'}`);
        } catch (error) {
          run.say(`  Ad ${adId}: its state could not be read after the pause (${describeError(error)}). Treat it as still active.`);
        }
      }

      if (!pausedOnMeta) {
        clean = false;
        stillActive.push(adId);
        record.stopped = `ad ${adId} is not confirmed paused`;
        continue;
      }

      // The local row follows Meta. A failure here is reported on its own: the ad is paused.
      const row = rows.find((candidate) => candidate.meta_ad_id === adId)
        ?? (rows.length === 1 && !rows[0]!.meta_ad_id && targets.size === 1 ? rows[0]! : null);
      if (!row) {
        run.say(`  Ad ${adId}: no local row to update`);
        continue;
      }
      record.adRowId = row.id;
      if (row.meta_ad_id && row.status === 'PAUSED' && row.meta_status === 'PAUSED') {
        record.localStatus = 'PAUSED';
        run.say(`  Ad ${adId}: local row ${row.id} already says PAUSED`);
        continue;
      }
      const patch = row.meta_ad_id
        ? { status: 'PAUSED', meta_status: 'PAUSED' }
        : { meta_ad_id: adId, meta_creative_id: listed?.creativeId ?? row.meta_creative_id, status: 'PAUSED', meta_status: 'PAUSED' };
      try {
        await saveRow(supabase, row, patch, `ad ${adId} is paused on Meta but the local row was not updated`);
        record.localStatus = 'PAUSED';
        run.say(`  Ad ${adId}: local row ${row.id} says PAUSED`);
      } catch (error) {
        clean = false;
        record.stopped = redactSecrets(describeError(error), run.secrets);
        run.say(`  Mismatch (the ad IS paused on Meta): ${describeError(error)}`);
      }
    }
  }

  run.manifest.challengerIdsStillActive = stillActive;
  run.say('');
  run.say(stillActive.length > 0
    ? `Challenger ids still active: ${stillActive.join(', ')}. Pause them through the CheersAI app or the Graph API (runbook section 6).`
    : 'Challenger ids still active: none.');
  run.say('The short links and history are kept for reporting.');
  return clean && stillActive.length === 0;
}

// ─── Printing ────────────────────────────────────────────────────────────────────────────────

function printCopy(run: Run, spec: ChallengerAdSpec): void {
  const { copy } = spec;
  run.say(`  Name: ${spec.name}`);
  run.say(`  Headline (${copy.headline.length}/${CHALLENGER_HEADLINE_MAX}): ${copy.headline}`);
  run.say(`  Primary text (${copy.primaryText.length}/${CHALLENGER_PRIMARY_TEXT_MAX}): ${copy.primaryText}`);
  run.say(`  Description (${copy.description.length}/${CHALLENGER_DESCRIPTION_MAX}): ${copy.description}`);
  run.say(`  Button: Book now (${CHALLENGER_CTA}, as the originals)`);
  run.say(`  Claims to re-check today: ${CHALLENGER_PRICE_CLAIMS[spec.campaign.service]}`);
}

function printRemainingPlan(run: Run, view: CampaignRun, from: 'S3' | 'S4'): void {
  if (from === 'S3') {
    run.say('  S3 creative: would upload the same image and create a creative with every automatic creative change opted out, linked to the per-ad link');
  }
  run.say(`  S4 ad: would create the ad PAUSED in Meta ad set ${view.spec.campaign.metaAdSetId} (no delivery, no spend)`);
  run.say('  S5 read-back: would read the ad and creative back from Meta and print each check');
}

function printManualChecks(run: Run, checks: ManualCheck[]): void {
  run.say('');
  run.say('Checks only a person can make (each blocks --activate until confirmed):');
  for (const check of checks) {
    const confirmed = run.options.confirmed.includes(check);
    run.say(`  ${check}: ${confirmed ? 'pass (confirmed by the operator)' : 'pending'} - ${MANUAL_CHECKS[check]}`);
  }
}

function printSummary(run: Run, views: CampaignRun[]): void {
  run.say('');
  run.say('Summary');
  for (const view of views) {
    const { record } = view;
    run.say(`  ${record.label}: stage ${record.stage}; row ${record.adRowId ?? 'none'}; code ${record.shortCode ?? 'none'}; creative ${record.metaCreativeId ?? 'none'}; ad ${record.metaAdId ?? 'none'}${record.stopped ? `; stopped: ${record.stopped}` : ''}`);
  }
}

function formatCheck(check: ChallengerCheck): string {
  return check.reasons.length > 0 ? `${check.result} (${check.reasons.join('; ')})` : check.result;
}

function formatPounds(minorUnits: number): string {
  return `£${(minorUnits / 100).toFixed(2)}`;
}

// ─── Read-only guards ────────────────────────────────────────────────────────────────────────

const SUPABASE_WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

function refuse(what: string): never {
  throw new Error(`Refused: ${what} was attempted in a read-only mode. This is a bug; nothing was written.`);
}

/**
 * Wraps the database client for the read-only modes so that an insert, update, upsert, delete,
 * stored procedure call or storage call throws instead of running. The read-only code paths do
 * not call them; this makes that impossible rather than merely true.
 */
export function refuseSupabaseWrites(client: SupabaseClientLike): SupabaseClientLike {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'rpc') return () => refuse('a database procedure call');
      if (property === 'storage') return { from: () => refuse('a storage call') };
      if (property === 'from') {
        return (table: string) => {
          const builder = target.from(table);
          return new Proxy(builder, {
            get(inner, method) {
              if (typeof method === 'string' && SUPABASE_WRITE_METHODS.has(method)) {
                return () => refuse(`${method} on ${table}`);
              }
              const value: unknown = Reflect.get(inner, method, inner);
              return typeof value === 'function' ? value.bind(inner) : value;
            },
          });
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function refuseMetaWrites(meta: ChallengerMetaClient): ChallengerMetaClient {
  return {
    fetchAdAccountSpendStatus: (...args) => meta.fetchAdAccountSpendStatus(...args),
    fetchAdSetBudgetRemaining: (...args) => meta.fetchAdSetBudgetRemaining(...args),
    listAdSetAds: (...args) => meta.listAdSetAds(...args),
    listAdCreativesNamed: (...args) => meta.listAdCreativesNamed(...args),
    readAdForLaunch: (...args) => meta.readAdForLaunch(...args),
    readAdCreative: (...args) => meta.readAdCreative(...args),
    uploadImage: () => refuse('an image upload to Meta'),
    createAdCreative: () => refuse('creating a Meta creative'),
    createAd: () => refuse('creating a Meta ad'),
    setObjectStatus: () => refuse('a Meta status change'),
  };
}

export function refuseManagementWrites(): ChallengerManagementClient {
  return { createMetaAdsLink: () => refuse('a short-link request to the management app') };
}

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────

function redactManifest(manifest: ChallengerManifest, secrets: Set<string>): ChallengerManifest {
  return JSON.parse(redactSecrets(JSON.stringify(manifest), secrets)) as ChallengerManifest;
}

function describeError(error: unknown): string {
  if (error instanceof MetaApiError) {
    const code = error.subcode ? `${error.code}/${error.subcode}` : String(error.code);
    const hint = error.code === 190 ? ' (the Meta token has expired or been revoked; reconnect Meta Ads in Connections)' : '';
    // Meta's own explanation, when it sends one: it names the field it objected to.
    const detail = [error.userTitle, error.userMessage].filter(Boolean).join(': ');
    return `Meta error ${code}: ${error.message}${detail ? ` [${detail}]` : ''}${hint}`;
  }
  if (error instanceof ManagementApiError) return `management app ${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function toCheck(reasons: string[]): ChallengerCheck {
  return { result: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function stripTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

/** Same address, ignoring letter case in the host and a trailing slash on the path. */
function isSameLink(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = parseUrl(left);
  const b = parseUrl(right);
  if (!a || !b) return false;
  const shape = (url: URL) => `${url.protocol}//${url.host.toLowerCase()}${stripTrailingSlash(url.pathname)}${url.search}`;
  return shape(a) === shape(b);
}

/** The short code of an l.the-anchor.pub link, lower case, or null for anything else. */
function extractShortCode(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  if (!url || url.hostname.toLowerCase() !== WEEKDAY_SHORT_LINK_HOST) return null;
  const [code] = url.pathname.split('/').filter(Boolean);
  return code?.trim().toLowerCase() || null;
}

function extractTrustedShortCode(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  if (!url || !TRUSTED_SHORT_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [code] = url.pathname.split('/').filter(Boolean);
  return code?.trim().toLowerCase() || null;
}
