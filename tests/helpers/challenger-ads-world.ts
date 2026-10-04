/**
 * An in-memory world for the weekday challenger ads tests: a fake database, a fake Meta, a fake
 * management app and a fake lock, seeded with the four campaigns exactly as the runbook
 * describes them. Nothing here can reach a live service.
 *
 * Every fake records what was asked of it, and can be told to fail once at a chosen point, so a
 * test can break a run after any external success and before the local save that follows.
 */
import crypto from 'node:crypto';

import { buildAdUtmContentKey, CREATIVE_FORMAT_SEQUENCE } from '@/lib/campaigns/ad-attribution';
import {
  CHALLENGER_AD_NAME,
  WEEKDAY_ACCOUNT_ID,
  WEEKDAY_CAMPAIGNS,
  WEEKDAY_FACEBOOK_PAGE_ID,
  WEEKDAY_LANDING_PAGE_URL,
  WEEKDAY_META_AD_ACCOUNT_ID,
  type ChallengerDeps,
  type ChallengerLock,
  type ChallengerManagementClient,
  type ChallengerManifest,
  type ChallengerMetaClient,
  type WeekdayCampaign,
} from '@/lib/campaigns/challenger-ads';
import {
  ManagementApiError,
  type ManagementApiConfig,
  type ManagementMetaAdsLinkInput,
  type ManagementMetaAdsLinkVariant,
} from '@/lib/management-app/client';
import {
  MetaApiError,
  RECORDED_CREATIVE_FEATURES,
  type CreateAdCreativeParams,
  type CreateAdParams,
  type MetaAdLaunchReadBack,
  type MetaCreativeLaunchReadBack,
} from '@/lib/meta/marketing';
import { encryptPayload } from '@/lib/token-vault';

/** Stub TOKEN_VAULT_KEY with this (hex) so the real token path can decrypt the fake token. */
export const VAULT_KEY = crypto.randomBytes(32);

/** Values that must never appear in any output or manifest. */
export const SECRETS = {
  accessToken: 'EAAtestMetaAccessToken0123456789abcdef',
  managementApiKey: 'anch_test_management_key_9f8e7d6c5b4a',
  signedUrlToken: 'signedurlsecret0f1e2d3c4b5a',
};

const PARENT_CODES: Record<WeekdayCampaign['key'], string> = {
  lunch_a: '0ai0j0',
  lunch_b: 'eff8sa',
  dinner_a: 'hrfowp',
  dinner_b: '9sie8u',
};

const CAMPAIGN_NAMES: Record<WeekdayCampaign['key'], string> = {
  lunch_a: 'Weekday Lunch A (cod and chips)',
  lunch_b: 'Weekday Lunch B (spicy chicken stack)',
  dinner_a: 'Weekday Dinner A (pizza)',
  dinner_b: 'Weekday Dinner B (beef and ale pie)',
};

const ORIGINAL_ANGLES = {
  lunch: ['Now serving lunch', 'Lunch from £9', 'Proper pub lunch'],
  dinner: ['No cooking tonight', 'Midweek dinner and a pint', 'Proper pub dinner'],
};

export const AD_SET_NAME = 'Evergreen Test';
export const REWRITE_AD_NAME = 'Var 1 - booking rewrite';

type Row = Record<string, unknown>;

// ─── Fake database ───────────────────────────────────────────────────────────────────────────

export interface DbCall {
  table: string;
  op: string;
  columns?: string;
  filters: Array<[kind: 'eq' | 'in', column: string, value: unknown]>;
  payload?: unknown;
}

interface DbFailure {
  table: string;
  op: string;
  message: string;
  /** True: the write happens but the caller is told it failed (a lost response). */
  apply: boolean;
  match?: (call: DbCall) => boolean;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  calls: DbCall[] = [];
  private failures: DbFailure[] = [];
  private nextId = 1;

  /** The next matching call fails once. */
  failNext(failure: Omit<DbFailure, 'apply'> & { apply?: boolean }): void {
    this.failures.push({ apply: false, ...failure });
  }

  takeFailure(call: DbCall): DbFailure | null {
    const index = this.failures.findIndex((failure) =>
      failure.table === call.table && failure.op === call.op && (!failure.match || failure.match(call)));
    if (index === -1) return null;
    return this.failures.splice(index, 1)[0]!;
  }

  pendingFailures(): number {
    return this.failures.length;
  }

  newId(): string {
    const id = `row-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** Everything that is not a select, including storage and procedure calls. */
  writes(): DbCall[] {
    return this.calls.filter((call) => call.op !== 'select');
  }

  client(): unknown {
    return {
      from: (table: string) => new FakeQuery(this, table),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, expiresIn: number) => {
            this.calls.push({ table: `storage:${bucket}`, op: 'createSignedUrl', filters: [], payload: { path, expiresIn } });
            return {
              data: { signedUrl: `https://storage.example.test/object/sign/${bucket}/${path}?token=${SECRETS.signedUrlToken}` },
              error: null,
            };
          },
        }),
      },
      rpc: async (name: string) => {
        this.calls.push({ table: `rpc:${name}`, op: 'rpc', filters: [] });
        return { data: null, error: { message: 'no procedures in the fake' } };
      },
    };
  }
}

interface QueryResult {
  data: Row[] | null;
  error: { message: string } | null;
}

class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private columns: string | undefined;
  private payload: Row | undefined;
  private returning = false;
  private filters: DbCall['filters'] = [];

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(columns?: string): this {
    if (this.op === 'select') this.columns = columns;
    else this.returning = true;
    return this;
  }

  insert(payload: Row): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row): this {
    this.op = 'upsert';
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push(['eq', column, value]);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push(['in', column, values]);
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const { data, error } = this.run();
    return { data: error ? null : data?.[0] ?? null, error };
  }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const row = data?.[0] ?? null;
    return { data: row, error: row ? null : { message: 'no rows returned' } };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }

  private run(): QueryResult {
    const call: DbCall = {
      table: this.table,
      op: this.op,
      columns: this.columns,
      filters: [...this.filters],
      payload: this.payload ? structuredClone(this.payload) : undefined,
    };
    this.db.calls.push(call);

    const failure = this.db.takeFailure(call);
    if (failure && !failure.apply) return { data: null, error: { message: failure.message } };

    const rows = this.db.rows(this.table);
    const matches = (row: Row) => this.filters.every(([kind, column, value]) =>
      kind === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column]));

    let touched: Row[] = [];
    if (this.op === 'select') {
      touched = rows.filter(matches);
    } else if (this.op === 'insert') {
      const inserted: Row = {
        id: this.db.newId(),
        meta_ad_id: null,
        meta_creative_id: null,
        meta_status: null,
        ...structuredClone(this.payload ?? {}),
      };
      rows.push(inserted);
      touched = [inserted];
    } else if (this.op === 'update') {
      touched = rows.filter(matches);
      for (const row of touched) Object.assign(row, structuredClone(this.payload ?? {}));
    } else if (this.op === 'delete') {
      touched = rows.filter(matches);
      this.db.tables[this.table] = rows.filter((row) => !matches(row));
    } else {
      throw new Error('upsert is not supported by the fake; the challenger code never uses it');
    }

    if (failure) return { data: null, error: { message: failure.message } };
    const visible = this.op === 'select' || this.returning;
    return { data: visible ? structuredClone(touched) : null, error: null };
  }
}

// ─── Fake Meta ───────────────────────────────────────────────────────────────────────────────

export interface FakeMetaAd {
  id: string;
  name: string;
  adset_id: string;
  creative_id: string;
  configured_status: string;
  effective_status: string;
  ad_review_feedback: Record<string, unknown> | null;
}

export interface FakeMetaCreative {
  id: string;
  name: string;
  pageId: string;
  link: string;
  message: string;
  headline: string | null;
  description: string | null;
  callToActionType: string | null;
  callToActionLink: string | null;
  features: Record<string, unknown> | null;
  imageHash: string;
}

type MetaMethod = keyof ChallengerMetaClient;

interface MetaFailure {
  method: MetaMethod;
  /** `before`: nothing happens on Meta. `after`: Meta does it, then the caller sees an error. */
  when: 'before' | 'after';
  error?: Error;
  match?: (args: unknown[]) => boolean;
}

const META_WRITE_METHODS: MetaMethod[] = ['uploadImage', 'createAdCreative', 'createAd', 'setObjectStatus'];

export class FakeMeta implements ChallengerMetaClient {
  ads = new Map<string, FakeMetaAd>();
  creatives = new Map<string, FakeMetaCreative>();
  images: string[] = [];
  account = { accountStatus: 1 as number | null, spendCapMinor: 50_000 as number | null, amountSpentMinor: 21_000 as number | null };
  budgetRemaining = new Map<string, number | null>();
  calls: Array<{ method: MetaMethod; args: unknown[] }> = [];
  tokenExpired = false;
  /** What Meta reports as the effective status straight after an ad is switched on. */
  effectiveStatusOnActivate = 'PENDING_REVIEW';
  private failures: MetaFailure[] = [];
  private nextId = 1;

  fail(failure: MetaFailure): void {
    this.failures.push(failure);
  }

  pendingFailures(): number {
    return this.failures.length;
  }

  writes(): Array<{ method: MetaMethod; args: unknown[] }> {
    return this.calls.filter((call) => META_WRITE_METHODS.includes(call.method));
  }

  callsTo(method: MetaMethod): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  private begin(method: MetaMethod, accessToken: string, args: unknown[]): MetaFailure | null {
    this.calls.push({ method, args });
    if (this.tokenExpired || accessToken !== SECRETS.accessToken) {
      throw new MetaApiError('Error validating access token: Session has expired.', 190, 463);
    }
    const index = this.failures.findIndex((failure) => failure.method === method && (!failure.match || failure.match(args)));
    const failure = index === -1 ? null : this.failures.splice(index, 1)[0]!;
    if (failure?.when === 'before') throw failure.error ?? new Error('fetch failed');
    return failure;
  }

  private finish(failure: MetaFailure | null): void {
    if (failure?.when === 'after') throw failure.error ?? new Error('The operation was aborted due to timeout');
  }

  async fetchAdAccountSpendStatus(adAccountId: string, accessToken: string) {
    this.finish(this.begin('fetchAdAccountSpendStatus', accessToken, [adAccountId]));
    return { ...this.account };
  }

  async fetchAdSetBudgetRemaining(adSetId: string, accessToken: string) {
    this.finish(this.begin('fetchAdSetBudgetRemaining', accessToken, [adSetId]));
    return this.budgetRemaining.get(adSetId) ?? null;
  }

  async listAdSetAds(adSetId: string, accessToken: string) {
    this.finish(this.begin('listAdSetAds', accessToken, [adSetId]));
    return Array.from(this.ads.values())
      .filter((ad) => ad.adset_id === adSetId && ad.configured_status !== 'DELETED')
      .map((ad) => ({
        id: ad.id,
        name: ad.name,
        configuredStatus: ad.configured_status,
        effectiveStatus: ad.effective_status,
        creativeId: ad.creative_id,
      }));
  }

  async listAdCreativesNamed(adAccountId: string, accessToken: string, name: string) {
    this.finish(this.begin('listAdCreativesNamed', accessToken, [adAccountId, name]));
    return Array.from(this.creatives.values())
      .filter((creative) => creative.name === name)
      .map((creative) => ({ id: creative.id, name: creative.name, link: creative.link }));
  }

  private shapeCreative(creative: FakeMetaCreative | undefined): MetaCreativeLaunchReadBack {
    return {
      id: creative?.id ?? null,
      name: creative?.name ?? null,
      pageId: creative?.pageId ?? null,
      link: creative?.link ?? null,
      message: creative?.message ?? null,
      headline: creative?.headline ?? null,
      description: creative?.description ?? null,
      callToActionType: creative?.callToActionType ?? null,
      callToActionLink: creative?.callToActionLink ?? null,
      creativeFeaturesSpec: creative?.features ? structuredClone(creative.features) : null,
    };
  }

  async readAdForLaunch(adId: string, accessToken: string): Promise<MetaAdLaunchReadBack> {
    this.finish(this.begin('readAdForLaunch', accessToken, [adId]));
    const ad = this.ads.get(adId);
    if (!ad) throw new MetaApiError('Unsupported get request. Object does not exist.', 100, 33);
    return {
      adId: ad.id,
      name: ad.name,
      adSetId: ad.adset_id,
      configuredStatus: ad.configured_status,
      effectiveStatus: ad.effective_status,
      reviewFeedback: ad.ad_review_feedback,
      creative: this.shapeCreative(this.creatives.get(ad.creative_id)),
    };
  }

  async readAdCreative(creativeId: string, accessToken: string) {
    this.finish(this.begin('readAdCreative', accessToken, [creativeId]));
    const creative = this.creatives.get(creativeId);
    if (!creative) throw new MetaApiError('Unsupported get request. Object does not exist.', 100, 33);
    return this.shapeCreative(creative);
  }

  async uploadImage(adAccountId: string, accessToken: string, imageUrl: string) {
    const failure = this.begin('uploadImage', accessToken, [adAccountId, imageUrl]);
    this.images.push(imageUrl);
    this.finish(failure);
    // Meta stores an image by its content, so the same picture always has the same hash.
    return { hash: `hash-${imageUrl.split('?')[0]!.split('/').pop()}` };
  }

  async createAdCreative(params: CreateAdCreativeParams) {
    const failure = this.begin('createAdCreative', params.accessToken, [params]);
    const id = `creative-${this.nextId}`;
    this.nextId += 1;
    this.creatives.set(id, {
      id,
      name: params.name,
      pageId: params.pageId,
      link: params.linkUrl,
      message: params.message,
      headline: params.headline ?? null,
      description: params.description ?? null,
      // Meta stores BOOK_NOW as BOOK_TRAVEL.
      callToActionType: params.callToActionType === 'BOOK_NOW' ? 'BOOK_TRAVEL' : params.callToActionType ?? null,
      callToActionLink: params.callToActionType ? params.linkUrl : null,
      features: params.optOutCreativeEnhancements
        ? Object.fromEntries(RECORDED_CREATIVE_FEATURES.map((feature) => [feature, { enroll_status: 'OPT_OUT' }]))
        : null,
      imageHash: params.imageHash,
    });
    this.finish(failure);
    return { id };
  }

  async createAd(params: CreateAdParams) {
    const failure = this.begin('createAd', params.accessToken, [params]);
    const id = `ad-${this.nextId}`;
    this.nextId += 1;
    this.ads.set(id, {
      id,
      name: params.name,
      adset_id: params.adsetId,
      creative_id: params.creativeId,
      configured_status: params.status,
      effective_status: params.status,
      ad_review_feedback: null,
    });
    this.finish(failure);
    return { id };
  }

  async setObjectStatus(objectId: string, accessToken: string, status: 'ACTIVE' | 'PAUSED') {
    const failure = this.begin('setObjectStatus', accessToken, [objectId, status]);
    const ad = this.ads.get(objectId);
    if (!ad) throw new MetaApiError('Unsupported post request. Object does not exist.', 100, 33);
    ad.configured_status = status;
    ad.effective_status = status === 'ACTIVE' ? this.effectiveStatusOnActivate : 'PAUSED';
    this.finish(failure);
  }
}

// ─── Fake management app ─────────────────────────────────────────────────────────────────────

export class FakeManagement implements ChallengerManagementClient {
  links = new Map<string, ManagementMetaAdsLinkVariant>();
  posts: Array<{ config: ManagementApiConfig; input: ManagementMetaAdsLinkInput }> = [];
  private failures: Array<'before' | 'after'> = [];
  private nextCode = 1;

  constructor(private readonly utmCampaignByParent: Map<string, string>) {}

  /** `before`: no link is made. `after`: the link is made, then the caller sees a timeout. */
  fail(when: 'before' | 'after'): void {
    this.failures.push(when);
  }

  pendingFailures(): number {
    return this.failures.length;
  }

  async createMetaAdsLink(config: ManagementApiConfig, input: ManagementMetaAdsLinkInput) {
    this.posts.push({ config, input });
    if (config.apiKey !== SECRETS.managementApiKey) {
      throw new ManagementApiError('UNAUTHORIZED', 'Management API rejected the API key.', 401);
    }
    const failure = this.failures.shift();
    if (failure === 'before') throw new ManagementApiError('NETWORK', 'Management API is unreachable.');

    const parent = input.parentShortCode ?? '';
    const utmCampaign = this.utmCampaignByParent.get(parent) ?? 'unknown';
    const variants = (input.variants ?? []).map((requested) => {
      const key = `${parent}|${requested.utmContent}`;
      const existing = this.links.get(key);
      if (existing) return { ...existing, alreadyExists: true };

      const shortCode = `w4lk${String(this.nextCode).padStart(2, '0')}`;
      this.nextCode += 1;
      const created: ManagementMetaAdsLinkVariant = {
        shortUrl: `https://l.the-anchor.pub/${shortCode}`,
        shortCode,
        destinationUrl: input.destinationUrl,
        utmDestinationUrl: `${WEEKDAY_LANDING_PAGE_URL}?utm_source=facebook&utm_medium=paid_social&utm_campaign=${utmCampaign}&utm_content=${requested.utmContent}`,
        utmContent: requested.utmContent,
        parentShortCode: parent,
        alreadyExists: false,
      };
      this.links.set(key, created);
      return created;
    });

    if (failure === 'after') throw new ManagementApiError('NETWORK', 'Management API request timed out.');
    return {
      shortUrl: `https://l.the-anchor.pub/${parent}`,
      shortCode: parent,
      destinationUrl: input.destinationUrl,
      utmDestinationUrl: input.destinationUrl,
      alreadyExists: true,
      variants,
    };
  }
}

// ─── Fake lock ───────────────────────────────────────────────────────────────────────────────

export class FakeLock implements ChallengerLock {
  heldBy: string | null = null;
  acquired: string[] = [];
  released: string[] = [];

  async acquire(runId: string) {
    if (this.heldBy) return { acquired: false as const, reason: `another run holds the single-run lock (run ${this.heldBy})` };
    this.heldBy = runId;
    this.acquired.push(runId);
    return { acquired: true as const };
  }

  async release(runId: string) {
    if (this.heldBy !== runId) return;
    this.heldBy = null;
    this.released.push(runId);
  }
}

// ─── The seeded world ────────────────────────────────────────────────────────────────────────

export interface World {
  db: FakeDb;
  meta: FakeMeta;
  management: FakeManagement;
  lock: FakeLock;
  output: string[];
  manifests: ChallengerManifest[];
  now: Date;
  graphVersion: string;
  deps(): ChallengerDeps;
  text(): string;
  campaignRow(key: WeekdayCampaign['key']): Row;
  adSetId(key: WeekdayCampaign['key']): string;
  challengerRows(key: WeekdayCampaign['key']): Row[];
  parentCode(key: WeekdayCampaign['key']): string;
}

export function adSetIdFor(key: WeekdayCampaign['key']): string {
  return `adset-${key}`;
}

function parentUtmUrl(campaign: WeekdayCampaign): string {
  return `${WEEKDAY_LANDING_PAGE_URL}?utm_source=facebook&utm_medium=paid_social&utm_campaign=${campaign.utmCampaign}&utm_content=meta_ads_main`;
}

export function createWorld(): World {
  const db = new FakeDb();
  const meta = new FakeMeta();
  const lock = new FakeLock();
  const management = new FakeManagement(new Map(WEEKDAY_CAMPAIGNS.map((campaign) => [PARENT_CODES[campaign.key], campaign.utmCampaign])));

  const token = encryptPayload(SECRETS.accessToken, VAULT_KEY, 1);
  db.tables.meta_ad_accounts = [{
    account_id: WEEKDAY_ACCOUNT_ID,
    meta_account_id: WEEKDAY_META_AD_ACCOUNT_ID,
    token_expires_at: null,
    // The dead legacy column: held empty in production, and never read by the challenger code.
    access_token: '',
  }];
  db.tables.meta_ad_account_tokens = [{
    account_id: WEEKDAY_ACCOUNT_ID,
    token_type: 'access',
    ciphertext: token.ciphertext,
    iv: token.iv,
    tag: token.tag,
    key_version: token.keyVersion,
  }];
  db.tables.social_connections = [{ account_id: WEEKDAY_ACCOUNT_ID, provider: 'facebook', metadata: { pageId: WEEKDAY_FACEBOOK_PAGE_ID } }];
  db.tables.management_app_connections = [{
    account_id: WEEKDAY_ACCOUNT_ID,
    base_url: 'https://management.example.test',
    api_key: SECRETS.managementApiKey,
    enabled: true,
  }];
  db.tables.meta_campaigns = [];
  db.tables.ad_sets = [];
  db.tables.ads = [];
  db.tables.media_assets = [];

  for (const campaign of WEEKDAY_CAMPAIGNS) {
    const parent = PARENT_CODES[campaign.key];
    const name = CAMPAIGN_NAMES[campaign.key];
    const adSetId = adSetIdFor(campaign.key);
    const assetId = `asset-${campaign.key}`;
    const variants: Row[] = [];

    db.tables.media_assets.push({ id: assetId, account_id: WEEKDAY_ACCOUNT_ID, storage_path: `media/${WEEKDAY_ACCOUNT_ID}/${campaign.key}.png` });
    db.tables.ad_sets.push({ id: adSetId, campaign_id: campaign.campaignId, name: AD_SET_NAME, meta_adset_id: campaign.metaAdSetId, adset_media_asset_id: assetId });
    meta.budgetRemaining.set(campaign.metaAdSetId, 7_000);

    campaign.originalMetaAdIds.forEach((metaAdId, index) => {
      const angle = ORIGINAL_ANGLES[campaign.service][index]!;
      const adName = `${AD_SET_NAME} | ${angle} | Var ${index + 1}`;
      const creativeFormat = CREATIVE_FORMAT_SEQUENCE[index]!;
      const key = buildAdUtmContentKey({ campaignName: name, adSetName: AD_SET_NAME, adName, angle, creativeFormat });
      const code = campaign.originalShortCodes[index]!;
      const shortUrl = `https://l.the-anchor.pub/${code}`;

      db.tables.ads!.push({
        id: `orig-${campaign.key}-${index + 1}`,
        adset_id: adSetId,
        name: adName,
        headline: `Original headline ${index + 1}`,
        primary_text: `Original text ${index + 1}`,
        description: `Original ${index + 1}`,
        cta: 'BOOK_NOW',
        angle,
        // The image sits on the ad set, as the wizard stores a shared image.
        media_asset_id: null,
        creative_format: creativeFormat,
        creative_variant_key: `variant-${campaign.key}-${index + 1}`,
        utm_content_key: key,
        meta_ad_id: metaAdId,
        meta_creative_id: `creative-orig-${metaAdId}`,
        status: 'ACTIVE',
        meta_status: 'ACTIVE',
      });
      variants.push({
        utmContent: key,
        shortUrl,
        shortCode: code,
        destinationUrl: parentUtmUrl(campaign),
        utmDestinationUrl: `${WEEKDAY_LANDING_PAGE_URL}?utm_source=facebook&utm_medium=paid_social&utm_campaign=${campaign.utmCampaign}&utm_content=${key}`,
        parentShortCode: parent,
        alreadyExists: false,
      });
      meta.ads.set(metaAdId, {
        id: metaAdId,
        name: adName,
        adset_id: campaign.metaAdSetId,
        creative_id: `creative-orig-${metaAdId}`,
        configured_status: 'ACTIVE',
        effective_status: 'ACTIVE',
        ad_review_feedback: null,
      });
      meta.creatives.set(`creative-orig-${metaAdId}`, {
        id: `creative-orig-${metaAdId}`,
        name: adName,
        pageId: WEEKDAY_FACEBOOK_PAGE_ID,
        link: shortUrl,
        message: `Original text ${index + 1}`,
        headline: `Original headline ${index + 1}`,
        description: `Original ${index + 1}`,
        callToActionType: 'BOOK_TRAVEL',
        callToActionLink: shortUrl,
        features: null,
        imageHash: `hash-${campaign.key}.png`,
      });
    });

    for (const metaAdId of campaign.otherKnownMetaAdIds) {
      // Lunch A's paused rewrite: its link is the campaign-level code.
      db.tables.ads!.push({
        id: `rewrite-${campaign.key}`,
        adset_id: adSetId,
        name: REWRITE_AD_NAME,
        headline: 'Book Weekday Lunch A (cod and chips)',
        primary_text: 'Rewrite text',
        description: 'Rewrite',
        cta: 'BOOK_NOW',
        angle: 'booking rewrite',
        media_asset_id: assetId,
        creative_format: 'venue_photo',
        creative_variant_key: `variant-${campaign.key}-rewrite`,
        utm_content_key: `rewrite_key_${campaign.key}`,
        meta_ad_id: metaAdId,
        meta_creative_id: `creative-orig-${metaAdId}`,
        status: 'PAUSED',
        meta_status: 'PAUSED',
      });
      meta.ads.set(metaAdId, {
        id: metaAdId,
        name: REWRITE_AD_NAME,
        adset_id: campaign.metaAdSetId,
        creative_id: `creative-orig-${metaAdId}`,
        configured_status: 'PAUSED',
        effective_status: 'PAUSED',
        ad_review_feedback: null,
      });
      meta.creatives.set(`creative-orig-${metaAdId}`, {
        id: `creative-orig-${metaAdId}`,
        name: REWRITE_AD_NAME,
        pageId: WEEKDAY_FACEBOOK_PAGE_ID,
        link: `https://l.the-anchor.pub/${parent}`,
        message: 'Rewrite text',
        headline: 'Book Weekday Lunch A (cod and chips)',
        description: 'Rewrite',
        callToActionType: 'BOOK_TRAVEL',
        callToActionLink: `https://l.the-anchor.pub/${parent}`,
        features: null,
        imageHash: `hash-${campaign.key}.png`,
      });
    }

    db.tables.meta_campaigns.push({
      id: campaign.campaignId,
      account_id: WEEKDAY_ACCOUNT_ID,
      name,
      status: 'ACTIVE',
      meta_campaign_id: campaign.metaCampaignId,
      campaign_kind: 'evergreen',
      controlled_test: true,
      destination_url: `https://l.the-anchor.pub/${parent}`,
      end_date: '2026-10-16',
      source_snapshot: {
        sourceType: 'custom_promotion',
        shortCode: parent,
        paidCtaUrl: `https://l.the-anchor.pub/${parent}`,
        utmDestinationUrl: parentUtmUrl(campaign),
        managementMetaAdsLink: { shortCode: parent, shortUrl: `https://l.the-anchor.pub/${parent}` },
        managementMetaAdVariants: variants,
      },
    });
  }

  const output: string[] = [];
  const manifests: ChallengerManifest[] = [];
  let runNumber = 0;

  const world: World = {
    db,
    meta,
    management,
    lock,
    output,
    manifests,
    // Monday 5 October 2026, 10:00 in London (BST): inside the flight.
    now: new Date('2026-10-05T09:00:00.000Z'),
    graphVersion: 'v24.0',
    deps() {
      runNumber += 1;
      return {
        supabase: db.client() as ChallengerDeps['supabase'],
        meta,
        management,
        lock,
        writeManifest: async (manifest) => {
          manifests.push(structuredClone(manifest));
          return `/outside/git/manifests/${manifest.runId}.json`;
        },
        now: () => world.now,
        log: (line) => output.push(line),
        runId: `run-${runNumber}`,
        graphVersion: world.graphVersion,
      };
    },
    text: () => output.join('\n'),
    campaignRow: (key) => db.rows('meta_campaigns').find((row) => row.id === WEEKDAY_CAMPAIGNS.find((campaign) => campaign.key === key)!.campaignId)!,
    adSetId: adSetIdFor,
    challengerRows: (key) => db.rows('ads').filter((row) => row.adset_id === adSetIdFor(key) && row.name === CHALLENGER_AD_NAME),
    parentCode: (key) => PARENT_CODES[key],
  };
  return world;
}

/** How many of each challenger object exist per campaign. A finished run has exactly one of each. */
export function challengerCounts(world: World): Record<string, { rows: number; links: number; creatives: number; ads: number }> {
  const counts: Record<string, { rows: number; links: number; creatives: number; ads: number }> = {};
  for (const campaign of WEEKDAY_CAMPAIGNS) {
    const parent = PARENT_CODES[campaign.key];
    const links = Array.from(world.management.links.values()).filter((link) => link.parentShortCode === parent);
    const linkUrls = new Set(links.map((link) => link.shortUrl));
    counts[campaign.key] = {
      rows: world.challengerRows(campaign.key).length,
      links: links.length,
      creatives: Array.from(world.meta.creatives.values())
        .filter((creative) => creative.name === CHALLENGER_AD_NAME && linkUrls.has(creative.link)).length,
      ads: Array.from(world.meta.ads.values())
        .filter((ad) => ad.name === CHALLENGER_AD_NAME && ad.adset_id === campaign.metaAdSetId).length,
    };
  }
  return counts;
}

export const ONE_OF_EACH = Object.fromEntries(
  WEEKDAY_CAMPAIGNS.map((campaign) => [campaign.key, { rows: 1, links: 1, creatives: 1, ads: 1 }]),
);

/**
 * Everything that must never change: the 12 originals and the paused rewrite (rows, Meta ads and
 * creatives), the ad sets, the campaigns' own fields, and every snapshot entry that was there
 * before. Compare it before and after a scenario.
 */
export function untouchedFingerprint(world: World): string {
  const originalRows = world.db.rows('ads').filter((row) => row.name !== CHALLENGER_AD_NAME);
  const originalKeys = new Set(originalRows.map((row) => row.utm_content_key));
  const campaigns = world.db.rows('meta_campaigns').map((row) => {
    const snapshot = row.source_snapshot as Record<string, unknown>;
    const variants = (snapshot.managementMetaAdVariants as Row[]).filter((variant) => originalKeys.has(variant.utmContent));
    return { ...row, source_snapshot: { ...snapshot, managementMetaAdVariants: variants } };
  });
  return JSON.stringify({
    originalRows,
    campaigns,
    adSets: world.db.rows('ad_sets'),
    metaAds: Array.from(world.meta.ads.values()).filter((ad) => ad.name !== CHALLENGER_AD_NAME),
    metaCreatives: Array.from(world.meta.creatives.values()).filter((creative) => creative.name !== CHALLENGER_AD_NAME),
    budgets: Array.from(world.meta.budgetRemaining.entries()),
    account: world.meta.account,
  });
}
