import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../../scripts/ops/add-weekday-challenger-ads';
import {
  ACTIVATE_REQUIRED_CONFIRMATIONS,
  APPLY_REQUIRED_CONFIRMATIONS,
  CHALLENGER_AD_NAME,
  CHALLENGER_COPY,
  runChallengerAds,
  WEEKDAY_ACCOUNT_ID,
  WEEKDAY_CAMPAIGNS,
  type ChallengerMode,
  type ChallengerRunResult,
  type ManualCheck,
} from '@/lib/campaigns/challenger-ads';
import {
  createFileRunLock,
  createManifestWriter,
  defaultStateDirectory,
  LOCK_FILE_NAME,
  LOCK_STALE_AFTER_MS,
  resolveStateDirectory,
} from '@/lib/campaigns/challenger-ads-files';
import { MetaApiError, type CreateAdCreativeParams, type CreateAdParams } from '@/lib/meta/marketing';

import {
  AD_SET_NAME,
  challengerCounts,
  createWorld,
  ONE_OF_EACH,
  SECRETS,
  untouchedFingerprint,
  VAULT_KEY,
  type DbCall,
  type World,
} from '../helpers/challenger-ads-world';

const APPLY = APPLY_REQUIRED_CONFIRMATIONS;
const ALL = ACTIVATE_REQUIRED_CONFIRMATIONS;

/**
 * What must never change, noted the first time each world is run: the 12 originals, the paused
 * rewrite, the ad sets, the campaigns and every snapshot entry that was already there. It is
 * checked again after every test in this file, whatever the test was about.
 */
const untouchedBaselines = new Map<World, string>();

function run(world: World, mode: ChallengerMode, confirmed: ManualCheck[] = []): Promise<ChallengerRunResult> {
  if (!untouchedBaselines.has(world)) untouchedBaselines.set(world, untouchedFingerprint(world));
  return runChallengerAds({ mode, confirmed: [...confirmed] }, world.deps());
}

/** For a test that itself changes the seeded world between runs: note the new starting point. */
function rebaseline(world: World): void {
  untouchedBaselines.set(world, untouchedFingerprint(world));
}

/** No short-link POST, image upload, database write, creative or ad creation, or status call. */
function expectNoWritesAnywhere(world: World): void {
  expect(world.db.writes()).toEqual([]);
  expect(world.meta.writes()).toEqual([]);
  expect(world.management.posts).toEqual([]);
}

function expectNoSecrets(text: string): void {
  for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/EAA[0-9A-Za-z_-]{10,}/);
}

function challengerAdIds(world: World): string[] {
  return Array.from(world.meta.ads.values()).filter((ad) => ad.name === CHALLENGER_AD_NAME).map((ad) => ad.id);
}

function payloadOf(call: DbCall): Record<string, unknown> {
  return (call.payload ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv('TOKEN_VAULT_KEY', VAULT_KEY.toString('hex'));
  vi.stubEnv('TOKEN_VAULT_KEY_VERSION', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterEach(() => {
  const worlds = Array.from(untouchedBaselines.entries());
  untouchedBaselines.clear();
  // The originals, the paused rewrite and the existing snapshot variants: unchanged after every scenario.
  for (const [world, fingerprint] of worlds) expect(untouchedFingerprint(world)).toBe(fingerprint);
});

describe('--dry-run', () => {
  it('writes nothing of any kind, takes no lock and saves no manifest', async () => {
    const world = createWorld();
    const before = untouchedFingerprint(world);

    const result = await run(world, 'dry-run');

    expect(result.ok).toBe(true);
    expectNoWritesAnywhere(world);
    expect(world.lock.acquired).toEqual([]);
    expect(world.manifests).toEqual([]);
    expect(challengerCounts(world)).toEqual(
      Object.fromEntries(WEEKDAY_CAMPAIGNS.map((campaign) => [campaign.key, { rows: 0, links: 0, creatives: 0, ads: 0 }])),
    );
    expect(untouchedFingerprint(world)).toBe(before);
  });

  it('prints what it would do for all four campaigns, with the exact copy', async () => {
    const world = createWorld();

    await run(world, 'dry-run');
    const text = world.text();

    for (const label of ['Lunch A', 'Lunch B', 'Dinner A', 'Dinner B']) expect(text).toContain(label);
    expect(text).toContain('This mode is read only: nothing is written anywhere.');
    expect(text).toContain(`would insert an ads row named "${CHALLENGER_AD_NAME}"`);
    expect(text).toContain('would ask the management app for a per-ad link under parent 0ai0j0');
    expect(text).toContain('would create the ad PAUSED in Meta ad set 120246019242330609');
    expect(text).toContain(`Headline (36/40): ${CHALLENGER_COPY.lunch.headline}`);
    expect(text).toContain(`Headline (40/40): ${CHALLENGER_COPY.dinner.headline}`);
    expect(text).toContain(CHALLENGER_COPY.lunch.primaryText);
    expect(text).toContain(CHALLENGER_COPY.dinner.description);
    expect(text).toContain('Graph API version: v24.0');
    expect(text).toContain('--apply --confirmed owner-go-ahead,claims');
  });

  it('prints no token, connection secret or signed address', async () => {
    const world = createWorld();

    await run(world, 'dry-run');

    expectNoSecrets(world.text());
  });

  it('redacts a token that Meta echoes back in an error, and stops', async () => {
    const world = createWorld();
    world.meta.fail({
      method: 'fetchAdAccountSpendStatus',
      when: 'before',
      error: new MetaApiError(`Invalid OAuth access token: ${SECRETS.accessToken}`, 190),
    });

    const result = await run(world, 'dry-run');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Meta error 190');
    expectNoSecrets(world.text());
    expectNoWritesAnywhere(world);
  });

  it('is never blocked by a held lock', async () => {
    const world = createWorld();
    world.lock.heldBy = 'another-run';

    const result = await run(world, 'dry-run');

    expect(result.ok).toBe(true);
    expect(world.lock.heldBy).toBe('another-run');
  });

  it('names the keys that --apply then saves', async () => {
    const world = createWorld();
    await run(world, 'dry-run');
    const dryRunText = world.text();

    await run(world, 'apply', APPLY);

    for (const campaign of WEEKDAY_CAMPAIGNS) {
      const [row] = world.challengerRows(campaign.key);
      expect(dryRunText).toContain(`with key ${String(row!.utm_content_key)}`);
    }
  });

  it('after the ads exist, checks them with reads only', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    const writesAfterApply = { db: world.db.writes().length, meta: world.meta.writes().length, posts: world.management.posts.length };
    world.output.length = 0;

    const result = await run(world, 'dry-run');

    expect(result.ok).toBe(true);
    expect(world.db.writes()).toHaveLength(writesAfterApply.db);
    expect(world.meta.writes()).toHaveLength(writesAfterApply.meta);
    expect(world.management.posts).toHaveLength(writesAfterApply.posts);
    expect(world.text()).toContain('Stage: S5');
    expectNoSecrets(world.text());
  });
});

describe('--apply', () => {
  it('stops before any read or write until the go-ahead and the price check are confirmed', async () => {
    const world = createWorld();

    const result = await run(world, 'apply', ['claims']);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('owner-go-ahead');
    expectNoWritesAnywhere(world);
    expect(world.meta.calls).toEqual([]);
  });

  it('creates one paused challenger per campaign and reaches S5 on all four', async () => {
    const world = createWorld();
    const before = untouchedFingerprint(world);

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(true);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
    expect(untouchedFingerprint(world)).toBe(before);

    // Exactly the writes the spec lists: 4 short links, 4 rows, 4 snapshot updates, 4 creatives, 4 ads.
    expect(world.management.posts).toHaveLength(4);
    expect(world.db.writes().filter((call) => call.table === 'ads' && call.op === 'insert')).toHaveLength(4);
    expect(world.db.writes().filter((call) => call.table === 'meta_campaigns' && call.op === 'update')).toHaveLength(4);
    expect(world.meta.callsTo('createAdCreative')).toHaveLength(4);
    expect(world.meta.callsTo('createAd')).toHaveLength(4);
    expect(world.meta.callsTo('setObjectStatus')).toEqual([]);

    for (const campaign of WEEKDAY_CAMPAIGNS) {
      const [row] = world.challengerRows(campaign.key);
      expect(row).toMatchObject({
        name: CHALLENGER_AD_NAME,
        headline: CHALLENGER_COPY[campaign.service].headline,
        primary_text: CHALLENGER_COPY[campaign.service].primaryText,
        description: CHALLENGER_COPY[campaign.service].description,
        cta: 'BOOK_NOW',
        angle: 'Walk in',
        media_asset_id: `asset-${campaign.key}`,
        status: 'PAUSED',
        meta_status: 'PAUSED',
      });
      const ad = world.meta.ads.get(String(row!.meta_ad_id))!;
      expect(ad).toMatchObject({ adset_id: campaign.metaAdSetId, configured_status: 'PAUSED', creative_id: row!.meta_creative_id });
    }
  });

  it('sends each creative with the opt-out, the same image and button, and its own short link', async () => {
    const world = createWorld();

    await run(world, 'apply', APPLY);

    const creatives = world.meta.callsTo('createAdCreative').map(([params]) => params as CreateAdCreativeParams);
    const links = new Set<string>();
    creatives.forEach((params, index) => {
      const campaign = WEEKDAY_CAMPAIGNS[index]!;
      expect(params.optOutCreativeEnhancements).toBe(true);
      expect(params.name).toBe(CHALLENGER_AD_NAME);
      expect(params.callToActionType).toBe('BOOK_NOW');
      expect(params.pageId).toBe('628953850871830');
      expect(params.adAccountId).toBe('act_1640006396819878');
      expect(params.headline).toBe(CHALLENGER_COPY[campaign.service].headline);
      expect(params.message).toBe(CHALLENGER_COPY[campaign.service].primaryText);
      expect(params.description).toBe(CHALLENGER_COPY[campaign.service].description);
      // The same image the originals use.
      expect(params.imageHash).toBe(`hash-${campaign.key}.png`);
      // Its own per-ad link: never the campaign-level code, never an original's code.
      expect(params.linkUrl).toMatch(/^https:\/\/l\.the-anchor\.pub\/w4lk0[1-4]$/);
      expect(params.linkUrl).not.toContain(world.parentCode(campaign.key));
      for (const code of campaign.originalShortCodes) expect(params.linkUrl).not.toContain(code);
      links.add(params.linkUrl);
    });
    expect(links.size).toBe(4);

    const ads = world.meta.callsTo('createAd').map(([params]) => params as CreateAdParams);
    expect(ads.map((params) => params.status)).toEqual(['PAUSED', 'PAUSED', 'PAUSED', 'PAUSED']);
    expect(ads.map((params) => params.adsetId)).toEqual(WEEKDAY_CAMPAIGNS.map((campaign) => campaign.metaAdSetId));
  });

  it('asks the management app for one variant under the campaign parent, with the saved key', async () => {
    const world = createWorld();

    await run(world, 'apply', APPLY);

    world.management.posts.forEach(({ config, input }, index) => {
      const campaign = WEEKDAY_CAMPAIGNS[index]!;
      const [row] = world.challengerRows(campaign.key);
      expect(config.baseUrl).toBe('https://management.example.test');
      expect(input.parentShortCode).toBe(world.parentCode(campaign.key));
      expect(input.variants).toHaveLength(1);
      expect(input.variants![0]!.utmContent).toBe(row!.utm_content_key);
      expect(input.destinationUrl).toContain(`utm_campaign=${campaign.utmCampaign}`);
    });
  });

  it('adds the new link to each snapshot and keeps every existing entry', async () => {
    const world = createWorld();
    const originalVariants = WEEKDAY_CAMPAIGNS.map((campaign) =>
      structuredClone((world.campaignRow(campaign.key).source_snapshot as Record<string, unknown>).managementMetaAdVariants));

    await run(world, 'apply', APPLY);

    WEEKDAY_CAMPAIGNS.forEach((campaign, index) => {
      const snapshot = world.campaignRow(campaign.key).source_snapshot as Record<string, unknown>;
      const variants = snapshot.managementMetaAdVariants as Array<Record<string, unknown>>;
      const [row] = world.challengerRows(campaign.key);
      expect(variants).toHaveLength(4);
      expect(variants.slice(0, 3)).toEqual(originalVariants[index]);
      expect(Object.keys(variants[3]!).sort()).toEqual(
        ['alreadyExists', 'destinationUrl', 'parentShortCode', 'shortCode', 'shortUrl', 'utmContent', 'utmDestinationUrl'],
      );
      expect(variants[3]).toMatchObject({ utmContent: row!.utm_content_key, parentShortCode: world.parentCode(campaign.key) });
      expect(snapshot.shortCode).toBe(world.parentCode(campaign.key));
    });
  });

  it('saves the row and its key before any external write', async () => {
    const world = createWorld();
    const order: string[] = [];
    const originalPost = world.management.createMetaAdsLink.bind(world.management);
    world.management.createMetaAdsLink = async (config, input) => {
      order.push(`link:${world.db.rows('ads').filter((row) => row.name === CHALLENGER_AD_NAME).length}`);
      return originalPost(config, input);
    };

    await run(world, 'apply', APPLY);

    // When each link was requested, that campaign's row (and every earlier one) already existed.
    expect(order).toEqual(['link:1', 'link:2', 'link:3', 'link:4']);
  });

  it('does nothing more when run a second time', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    const keys = WEEKDAY_CAMPAIGNS.map((campaign) => world.challengerRows(campaign.key)[0]!.utm_content_key);
    const writes = { db: world.db.writes().length, meta: world.meta.writes().length, posts: world.management.posts.length };

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(true);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
    expect(world.db.writes()).toHaveLength(writes.db);
    expect(world.meta.writes()).toHaveLength(writes.meta);
    expect(world.management.posts).toHaveLength(writes.posts);
    expect(WEEKDAY_CAMPAIGNS.map((campaign) => world.challengerRows(campaign.key)[0]!.utm_content_key)).toEqual(keys);
  });

  it('gives Lunch B a different key when it would collide with Lunch A', async () => {
    const world = createWorld();
    // Same campaign and ad set names: the two keys would be identical without the cross-campaign check.
    world.campaignRow('lunch_b').name = world.campaignRow('lunch_a').name;

    const result = await run(world, 'apply', APPLY);

    const keyA = String(world.challengerRows('lunch_a')[0]!.utm_content_key);
    const keyB = String(world.challengerRows('lunch_b')[0]!.utm_content_key);
    expect(result.ok).toBe(true);
    expect(keyB).toBe(`${keyA}__2`);
    expect(world.challengerRows('lunch_a')[0]!.meta_ad_id).not.toBe(world.challengerRows('lunch_b')[0]!.meta_ad_id);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });

  it('says so when the originals carry different format labels, and uses Var 1\'s', async () => {
    const world = createWorld();

    await run(world, 'apply', APPLY);

    expect(world.text()).toContain('different creative format labels');
    expect(world.challengerRows('lunch_a')[0]!.creative_format).toBe('venue_photo');
  });

  it('writes a manifest with the ids and results, and no secret', async () => {
    const world = createWorld();

    const result = await run(world, 'apply', APPLY);

    expect(world.manifests).toHaveLength(1);
    const manifest = world.manifests[0]!;
    expect(manifest).toMatchObject({ runId: 'run-1', mode: 'apply', accountId: WEEKDAY_ACCOUNT_ID, outcome: 'completed', confirmed: APPLY });
    expect(manifest.campaigns).toHaveLength(4);
    for (const campaign of manifest.campaigns) {
      const [row] = world.challengerRows(campaign.key as 'lunch_a');
      expect(campaign).toMatchObject({
        stage: 'S5',
        adRowId: row!.id,
        utmContentKey: row!.utm_content_key,
        metaCreativeId: row!.meta_creative_id,
        metaAdId: row!.meta_ad_id,
        stopped: null,
      });
      expect(campaign.shortCode).toMatch(/^w4lk0[1-4]$/);
      expect(Object.values(campaign.checks).map((check) => check.result)).toEqual(
        ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass'],
      );
    }
    expectNoSecrets(JSON.stringify(manifest));
    expectNoSecrets(JSON.stringify(result.manifest));
    expectNoSecrets(world.text());
  });

  it('takes the lock for the run and releases it afterwards', async () => {
    const world = createWorld();

    await run(world, 'apply', APPLY);

    expect(world.lock.acquired).toEqual(['run-1']);
    expect(world.lock.released).toEqual(['run-1']);
    expect(world.lock.heldBy).toBeNull();
  });

  it('stops a campaign whose saved row no longer matches the spec, and creates nothing for it', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    world.challengerRows('dinner_a')[0]!.headline = 'Edited by hand';
    const metaWrites = world.meta.writes().length;

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('no longer matches the spec');
    expect(world.meta.writes()).toHaveLength(metaWrites);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });
});

describe('--apply restarts: a failure at any point, then a retry, ends with exactly one challenger per campaign', () => {
  const nth = (target: number) => {
    let seen = 0;
    return () => {
      seen += 1;
      return seen === target;
    };
  };

  const scenarios: Array<{ name: string; arrange: (world: World) => void; firstRunOk?: boolean }> = [
    {
      name: 'the row is inserted but the response is lost',
      arrange: (world) => world.db.failNext({ table: 'ads', op: 'insert', message: 'connection reset', apply: true }),
    },
    {
      name: 'the row insert fails',
      arrange: (world) => world.db.failNext({ table: 'ads', op: 'insert', message: 'connection reset' }),
    },
    {
      name: 'the management app is unreachable',
      arrange: (world) => world.management.fail('before'),
    },
    {
      name: 'the short link is made but the management app times out',
      arrange: (world) => world.management.fail('after'),
    },
    {
      name: 'the short link is made but the snapshot save fails',
      arrange: (world) => world.db.failNext({ table: 'meta_campaigns', op: 'update', message: 'deadlock detected' }),
    },
    {
      name: 'the image upload fails',
      arrange: (world) => world.meta.fail({ method: 'uploadImage', when: 'before' }),
    },
    {
      name: 'Meta refuses the creative',
      arrange: (world) => world.meta.fail({ method: 'createAdCreative', when: 'before', error: new MetaApiError('Invalid parameter', 100) }),
    },
    {
      name: 'the creative is made but Meta times out (reconciled in the same run)',
      arrange: (world) => world.meta.fail({ method: 'createAdCreative', when: 'after' }),
      firstRunOk: true,
    },
    {
      name: 'the creative is made but its id is not saved',
      arrange: (world) => world.db.failNext({
        table: 'ads',
        op: 'update',
        message: 'connection reset',
        match: (call) => 'meta_creative_id' in payloadOf(call) && !('meta_ad_id' in payloadOf(call)),
      }),
    },
    {
      name: 'the creative is made, Meta times out, and Meta then cannot be read',
      arrange: (world) => {
        world.meta.fail({ method: 'createAdCreative', when: 'after' });
        // The first list is the check before creating; the second is the one after the timeout.
        world.meta.fail({ method: 'listAdCreativesNamed', when: 'before', match: nth(2) });
      },
    },
    {
      name: 'Meta refuses the ad',
      arrange: (world) => world.meta.fail({ method: 'createAd', when: 'before', error: new MetaApiError('Invalid parameter', 100) }),
    },
    {
      name: 'Meta cannot be read immediately before the ad is created',
      arrange: (world) => world.meta.fail({ method: 'listAdSetAds', when: 'before', match: nth(5) }),
    },
    {
      name: 'the ad is made but Meta times out (reconciled in the same run)',
      arrange: (world) => world.meta.fail({ method: 'createAd', when: 'after' }),
      firstRunOk: true,
    },
    {
      name: 'the ad is made but its id is not saved',
      arrange: (world) => world.db.failNext({
        table: 'ads',
        op: 'update',
        message: 'connection reset',
        match: (call) => 'meta_ad_id' in payloadOf(call),
      }),
    },
    {
      name: 'the ad is made, Meta times out, and Meta then cannot be read',
      arrange: (world) => {
        world.meta.fail({ method: 'createAd', when: 'after' });
        // Four lists happen in the checks before anything is written and a fifth immediately
        // before the ad is created; the sixth is the one that follows the timeout.
        world.meta.fail({ method: 'listAdSetAds', when: 'before', match: nth(6) });
      },
    },
    {
      name: 'the read-back fails',
      arrange: (world) => world.meta.fail({ method: 'readAdForLaunch', when: 'before' }),
    },
  ];

  it.each(scenarios)('$name', async ({ arrange, firstRunOk }) => {
    const world = createWorld();
    const before = untouchedFingerprint(world);
    arrange(world);

    const first = await run(world, 'apply', APPLY);

    expect(first.ok).toBe(firstRunOk ?? false);
    // The failure really happened: nothing injected is left waiting, and the run said so.
    expect(world.db.pendingFailures() + world.meta.pendingFailures() + world.management.pendingFailures()).toBe(0);
    expect(world.text()).toMatch(/Stopped this campaign|did not confirm/);
    // Never more than one of anything, even part-way through.
    for (const counts of Object.values(challengerCounts(world))) {
      for (const count of Object.values(counts)) expect(count).toBeLessThanOrEqual(1);
    }
    const keysAfterFirst = new Map(WEEKDAY_CAMPAIGNS.map((campaign) => [campaign.key, world.challengerRows(campaign.key)[0]?.utm_content_key]));
    expect(untouchedFingerprint(world)).toBe(before);
    expect(world.lock.heldBy).toBeNull();

    const second = await run(world, 'apply', APPLY);

    expect(second.ok).toBe(true);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
    expect(untouchedFingerprint(world)).toBe(before);
    // A key saved in the first run is the key in use after the second: it is never built again.
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      const saved = keysAfterFirst.get(campaign.key);
      if (saved) expect(world.challengerRows(campaign.key)[0]!.utm_content_key).toBe(saved);
    }
    // Every row points at the one ad and creative Meta holds for it.
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      const [row] = world.challengerRows(campaign.key);
      const ad = world.meta.ads.get(String(row!.meta_ad_id))!;
      expect(ad.adset_id).toBe(campaign.metaAdSetId);
      expect(ad.creative_id).toBe(row!.meta_creative_id);
      expect(ad.configured_status).toBe('PAUSED');
    }
    expectNoSecrets(world.text());
  });

  it('stops the whole run when Meta cannot be read after an unconfirmed create', async () => {
    const world = createWorld();
    world.meta.fail({ method: 'createAd', when: 'after' });
    let lists = 0;
    world.meta.fail({ method: 'listAdSetAds', when: 'before', match: () => (lists += 1) === 6 });

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Meta could not be read after an unconfirmed create');
    // Lunch A's ad exists on Meta; nothing was started for the three campaigns after it.
    expect(challengerCounts(world).lunch_a).toEqual({ rows: 1, links: 1, creatives: 1, ads: 1 });
    for (const key of ['lunch_b', 'dinner_a', 'dinner_b']) {
      expect(challengerCounts(world)[key]).toEqual({ rows: 0, links: 0, creatives: 0, ads: 0 });
    }
    expect(world.manifests[0]!.outcome).toBe('stopped');
  });

  it('adopts the one ad Meta already holds under the challenger\'s name instead of creating another', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    // As if the ids were never saved: the row is back at S2.
    const [row] = world.challengerRows('lunch_b');
    const adId = row!.meta_ad_id;
    const creativeId = row!.meta_creative_id;
    Object.assign(row!, { meta_ad_id: null, meta_creative_id: null, status: 'DRAFT', meta_status: null });
    const creates = world.meta.callsTo('createAd').length + world.meta.callsTo('createAdCreative').length;

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(true);
    expect(world.meta.callsTo('createAd').length + world.meta.callsTo('createAdCreative').length).toBe(creates);
    expect(world.challengerRows('lunch_b')[0]).toMatchObject({ meta_ad_id: adId, meta_creative_id: creativeId, status: 'PAUSED', meta_status: 'PAUSED' });
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });

  it('adopts an ad that appeared on Meta after the run\'s first checks, rather than creating a second', async () => {
    const world = createWorld();
    // Lunch A's creative is made, then an ad under the challenger's name appears on Meta
    // before this run reaches the point of creating one.
    const originalCreate = world.meta.createAdCreative.bind(world.meta);
    let planted = false;
    world.meta.createAdCreative = async (params) => {
      const creative = await originalCreate(params);
      if (!planted) {
        planted = true;
        world.meta.ads.set('ad-from-elsewhere', {
          id: 'ad-from-elsewhere',
          name: CHALLENGER_AD_NAME,
          adset_id: WEEKDAY_CAMPAIGNS[0]!.metaAdSetId,
          creative_id: creative.id,
          configured_status: 'PAUSED',
          effective_status: 'PAUSED',
          ad_review_feedback: null,
        });
      }
      return creative;
    };

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(true);
    expect(world.challengerRows('lunch_a')[0]!.meta_ad_id).toBe('ad-from-elsewhere');
    expect(world.meta.callsTo('createAd')).toHaveLength(3);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });

  it('refuses to adopt an ad that is already live when a paused one was expected', async () => {
    const world = createWorld();
    const originalCreate = world.meta.createAdCreative.bind(world.meta);
    let planted = false;
    world.meta.createAdCreative = async (params) => {
      const creative = await originalCreate(params);
      if (!planted) {
        planted = true;
        world.meta.ads.set('live-ad-from-elsewhere', {
          id: 'live-ad-from-elsewhere',
          name: CHALLENGER_AD_NAME,
          adset_id: WEEKDAY_CAMPAIGNS[0]!.metaAdSetId,
          creative_id: creative.id,
          configured_status: 'ACTIVE',
          effective_status: 'ACTIVE',
          ad_review_feedback: null,
        });
      }
      return creative;
    };

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('in state ACTIVE, not PAUSED; it was not adopted');
    expect(world.challengerRows('lunch_a')[0]!.meta_ad_id).toBeNull();
    // No second ad was made for Lunch A.
    expect(challengerCounts(world).lunch_a!.ads).toBe(1);
  });

  it('recovers a saved creative by its id, with a read, and does not make another', async () => {
    const world = createWorld();
    world.meta.fail({ method: 'createAd', when: 'before', error: new MetaApiError('Invalid parameter', 100) });
    await run(world, 'apply', APPLY);
    const creativeId = String(world.challengerRows('lunch_a')[0]!.meta_creative_id);
    const creatives = world.meta.callsTo('createAdCreative').length;

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(true);
    expect(world.meta.callsTo('readAdCreative')).toContainEqual([creativeId]);
    expect(world.meta.callsTo('createAdCreative')).toHaveLength(creatives);
    expect(world.meta.ads.get(String(world.challengerRows('lunch_a')[0]!.meta_ad_id))!.creative_id).toBe(creativeId);
  });
});

describe('preflight: stop before any write', () => {
  const stops: Array<{ name: string; arrange: (world: World) => void; says: string | RegExp }> = [
    {
      name: 'the Meta token is missing',
      arrange: (world) => { world.db.tables.meta_ad_account_tokens = []; },
      says: 'the Meta Ads token is missing',
    },
    {
      name: 'the stored token expiry has passed',
      arrange: (world) => { world.db.rows('meta_ad_accounts')[0]!.token_expires_at = '2026-10-01T00:00:00.000Z'; },
      says: 'the Meta Ads token has expired',
    },
    {
      name: 'Meta rejects the token as expired',
      arrange: (world) => { world.meta.tokenExpired = true; },
      says: 'Meta error 190/463',
    },
    {
      name: 'no Meta ad account is connected',
      arrange: (world) => { world.db.tables.meta_ad_accounts = []; },
      says: 'no Meta ad account is connected',
    },
    {
      name: 'the ad account is not the expected one',
      arrange: (world) => { world.db.rows('meta_ad_accounts')[0]!.meta_account_id = 'act_999'; },
      says: 'the Meta ad account is act_999',
    },
    {
      name: 'the Facebook Page is not the expected one',
      arrange: (world) => { world.db.rows('social_connections')[0]!.metadata = { pageId: '111' }; },
      says: 'the Facebook Page is 111',
    },
    {
      name: 'the management app connection is disabled',
      arrange: (world) => { world.db.rows('management_app_connections')[0]!.enabled = false; },
      says: 'the management app connection is disabled',
    },
    {
      name: 'the campaign kind is not supported',
      arrange: (world) => { world.campaignRow('dinner_a').campaign_kind = 'event'; },
      says: 'Dinner A: the campaign kind is event, not evergreen',
    },
    {
      name: 'the campaign is not a controlled test',
      arrange: (world) => { world.campaignRow('lunch_b').controlled_test = false; },
      says: 'Lunch B: the campaign is not marked as a controlled test',
    },
    {
      name: 'the campaign is not ACTIVE',
      arrange: (world) => { world.campaignRow('lunch_a').status = 'PAUSED'; },
      says: 'Lunch A: the campaign is PAUSED, not ACTIVE',
    },
    {
      name: 'the campaign belongs to another account',
      arrange: (world) => { world.campaignRow('lunch_a').account_id = 'another-account'; },
      says: 'Lunch A: the campaign was not found for this account',
    },
    {
      // 00:30 on 17 October in London (BST), which is still 16 October in UTC.
      name: 'the flight has ended',
      arrange: (world) => { world.now = new Date('2026-10-16T23:30:00.000Z'); },
      says: 'the flight has ended',
    },
    {
      name: 'a campaign has two ad sets',
      arrange: (world) => {
        world.db.rows('ad_sets').push({ id: 'adset-extra', campaign_id: WEEKDAY_CAMPAIGNS[3]!.campaignId, name: 'Extra', meta_adset_id: '999', adset_media_asset_id: null });
      },
      says: 'Dinner B: the campaign has 2 ad sets, expected exactly 1',
    },
    {
      name: 'a campaign has an extra ad locally',
      arrange: (world) => {
        world.db.rows('ads').push({ ...structuredClone(world.db.rows('ads')[0]!), id: 'extra-row', name: 'Someone else\'s ad', meta_ad_id: '555' });
      },
      says: 'Lunch A: the existing ads do not match the runbook: found 5',
    },
    {
      name: 'an original ad is missing locally',
      arrange: (world) => { world.db.tables.ads = world.db.rows('ads').filter((row) => row.id !== 'orig-dinner_b-2'); },
      says: 'Dinner B: the existing ads do not match the runbook: found 2',
    },
    {
      name: 'Meta holds an unexpected ad in the ad set',
      arrange: (world) => {
        world.meta.ads.set('777', { id: '777', name: 'Made in Ads Manager', adset_id: WEEKDAY_CAMPAIGNS[1]!.metaAdSetId, creative_id: 'c', configured_status: 'ACTIVE', effective_status: 'ACTIVE', ad_review_feedback: null });
      },
      says: 'Lunch B: Meta\'s ad set does not match the runbook: found 4 other ads',
    },
    {
      name: 'two local rows carry the challenger name',
      arrange: (world) => {
        for (const id of ['dup-1', 'dup-2']) {
          world.db.rows('ads').push({ ...structuredClone(world.db.rows('ads')[0]!), id, name: CHALLENGER_AD_NAME, meta_ad_id: null, meta_creative_id: null, utm_content_key: id, status: 'DRAFT' });
        }
      },
      says: /Lunch A: \d ads rows are named "Evergreen Test \| Walk in \| Var 4" \(.*dup-1, dup-2\); reconcile by hand/,
    },
    {
      name: 'Meta holds two ads under the challenger name',
      arrange: (world) => {
        for (const id of ['dup-ad-1', 'dup-ad-2']) {
          world.meta.ads.set(id, { id, name: CHALLENGER_AD_NAME, adset_id: WEEKDAY_CAMPAIGNS[2]!.metaAdSetId, creative_id: 'c', configured_status: 'PAUSED', effective_status: 'PAUSED', ad_review_feedback: null });
        }
      },
      says: /Dinner A: \d ads on Meta are named .*dup-ad-1, dup-ad-2\); Peter decides what to pause/,
    },
    {
      name: 'the Graph version is not the one the features were recorded on',
      arrange: (world) => { world.graphVersion = 'v25.0'; },
      says: 'the Graph API version is v25.0',
    },
    {
      name: 'the campaign-level short code is not one of the runbook\'s four',
      arrange: (world) => {
        const row = world.campaignRow('dinner_b');
        row.source_snapshot = { ...(row.source_snapshot as Record<string, unknown>), shortCode: 'zzzzzz' };
      },
      says: 'Dinner B: the campaign-level short code is zzzzzz',
    },
    {
      name: 'the originals do not share one image',
      arrange: (world) => { world.db.rows('ads').find((row) => row.id === 'orig-lunch_a-2')!.media_asset_id = 'another-asset'; },
      says: 'Lunch A: the three original ads do not share one image',
    },
    {
      name: 'the originals do not use the Book now button',
      arrange: (world) => { for (const row of world.db.rows('ads')) if (String(row.id).startsWith('orig-lunch_b')) row.cta = 'LEARN_MORE'; },
      says: 'Lunch B: the original ads\' button is LEARN_MORE, expected BOOK_NOW',
    },
  ];

  it.each(stops)('--apply stops when $name', async ({ arrange, says }) => {
    const world = createWorld();
    arrange(world);
    const before = untouchedFingerprint(world);

    const result = await run(world, 'apply', APPLY);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Stopped before any write');
    expect(world.text()).toMatch(says);
    expectNoWritesAnywhere(world);
    expect(untouchedFingerprint(world)).toBe(before);
    expect(world.lock.heldBy).toBeNull();
    expectNoSecrets(world.text());
  });

  it.each(stops)('--dry-run reports the same stop when $name', async ({ arrange, says }) => {
    const world = createWorld();
    arrange(world);

    const result = await run(world, 'dry-run');

    expect(result.ok).toBe(false);
    expect(world.text()).toMatch(says);
    expectNoWritesAnywhere(world);
  });

  it.each(stops)('--activate stops when $name', async ({ arrange, says }) => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    arrange(world);
    rebaseline(world);
    const writes = { db: world.db.writes().length, meta: world.meta.writes().length };
    world.output.length = 0;

    const result = await run(world, 'activate', ALL);

    expect(result.ok).toBe(false);
    expect(world.text()).toMatch(says);
    expect(world.db.writes()).toHaveLength(writes.db);
    expect(world.meta.writes()).toHaveLength(writes.meta);
    expect(world.meta.callsTo('setObjectStatus')).toEqual([]);
  });
});

describe('the single-run lock', () => {
  it.each(['apply', 'activate', 'pause'] as const)('refuses --%s while another run holds the lock, before reading or writing anything', async (mode) => {
    const world = createWorld();
    world.lock.heldBy = 'the-first-run';

    const result = await run(world, mode, ALL);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Stopped before any write: another run holds the single-run lock');
    expect(world.db.calls).toEqual([]);
    expect(world.meta.calls).toEqual([]);
    expect(world.management.posts).toEqual([]);
    expect(world.manifests).toEqual([]);
    // The other run's lock is left alone.
    expect(world.lock.heldBy).toBe('the-first-run');
  });

  it('never blocks --status', async () => {
    const world = createWorld();
    world.lock.heldBy = 'the-first-run';

    const result = await run(world, 'status');

    expect(result.ok).toBe(true);
    expect(world.lock.acquired).toEqual([]);
  });

  it('stops before any write when the lock location cannot be used', async () => {
    const world = createWorld();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'challenger-lock-'));
    try {
      // A file where the lock's directory should be: nothing can be created under it.
      const blocked = path.join(directory, 'not-a-directory');
      await writeFile(blocked, 'x');
      const deps = { ...world.deps(), lock: createFileRunLock({ directory: path.join(blocked, 'state') }) };

      const result = await runChallengerAds({ mode: 'apply', confirmed: [...APPLY] }, deps);

      expect(result.ok).toBe(false);
      expect(world.text()).toContain('Stopped before any write');
      expect(world.text()).toContain('cannot be used');
      expect(world.db.calls).toEqual([]);
      expect(world.meta.calls).toEqual([]);
      expect(world.management.posts).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops before any write when taking the lock throws', async () => {
    const world = createWorld();
    const deps = {
      ...world.deps(),
      lock: { acquire: async () => { throw new Error('disk is read only'); }, release: async () => undefined },
    };

    const result = await runChallengerAds({ mode: 'apply', confirmed: [...APPLY] }, deps);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('disk is read only');
    expect(world.db.calls).toEqual([]);
    expect(world.meta.calls).toEqual([]);
  });

  it('is released after a run that stopped part-way', async () => {
    const world = createWorld();
    world.meta.fail({ method: 'createAd', when: 'before' });

    await run(world, 'apply', APPLY);

    expect(world.lock.heldBy).toBeNull();
    expect(world.lock.released).toEqual(['run-1']);
  });
});

describe('the lock file and the manifest on disk', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'challenger-state-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lets one run in and refuses a second while the first holds it', async () => {
    const lock = createFileRunLock({ directory });

    expect(await lock.acquire('run-a')).toEqual({ acquired: true });
    const second = await lock.acquire('run-b');

    expect(second.acquired).toBe(false);
    expect(second.acquired === false && second.reason).toContain('run-a');
    expect(JSON.parse(await readFile(path.join(directory, LOCK_FILE_NAME), 'utf8'))).toMatchObject({ runId: 'run-a' });
  });

  it('lets only one of two runs started together in', async () => {
    const results = await Promise.all(
      ['run-a', 'run-b', 'run-c'].map((runId) => createFileRunLock({ directory }).acquire(runId)),
    );

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it('is released only by the run that holds it', async () => {
    const lock = createFileRunLock({ directory });
    await lock.acquire('run-a');

    await lock.release('run-b');
    expect((await lock.acquire('run-c')).acquired).toBe(false);

    await lock.release('run-a');
    expect(await lock.acquire('run-c')).toEqual({ acquired: true });
  });

  it('treats a lock older than 30 minutes as stale and takes it over', async () => {
    expect(LOCK_STALE_AFTER_MS).toBe(30 * 60 * 1000);
    let now = new Date('2026-10-05T09:00:00.000Z');
    const lock = createFileRunLock({ directory, now: () => now });
    await lock.acquire('run-that-died');

    now = new Date('2026-10-05T09:29:59.000Z');
    expect((await lock.acquire('run-b')).acquired).toBe(false);

    now = new Date('2026-10-05T09:30:00.000Z');
    expect(await lock.acquire('run-b')).toEqual({ acquired: true });
    expect(JSON.parse(await readFile(path.join(directory, LOCK_FILE_NAME), 'utf8'))).toMatchObject({ runId: 'run-b' });

    // The run that died cannot release the lock it no longer holds.
    await lock.release('run-that-died');
    expect((await lock.acquire('run-c')).acquired).toBe(false);
  });

  it('lets only one of two runs take over the same stale lock', async () => {
    let now = new Date('2026-10-05T09:00:00.000Z');
    await createFileRunLock({ directory, now: () => now }).acquire('run-that-died');
    now = new Date('2026-10-05T10:00:00.000Z');

    const results = await Promise.all(
      ['run-b', 'run-c', 'run-d'].map((runId) => createFileRunLock({ directory, now: () => now }).acquire(runId)),
    );

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it('ages a lock it cannot read by when the file was written', async () => {
    const lockPath = path.join(directory, LOCK_FILE_NAME);
    await writeFile(lockPath, '');
    const now = new Date('2026-10-05T09:00:00.000Z');
    const lock = createFileRunLock({ directory, now: () => now });

    await utimes(lockPath, new Date('2026-10-05T08:50:00.000Z'), new Date('2026-10-05T08:50:00.000Z'));
    expect((await lock.acquire('run-b')).acquired).toBe(false);

    await utimes(lockPath, new Date('2026-10-05T08:00:00.000Z'), new Date('2026-10-05T08:00:00.000Z'));
    expect(await lock.acquire('run-b')).toEqual({ acquired: true });
  });

  it('reports an unusable location rather than throwing', async () => {
    const blocked = path.join(directory, 'a-file');
    await writeFile(blocked, 'x');

    const result = await createFileRunLock({ directory: path.join(blocked, 'state') }).acquire('run-a');

    expect(result.acquired).toBe(false);
    expect(result.acquired === false && result.reason).toContain('cannot be used');
  });

  it('keeps the lock and manifests outside the repository', () => {
    const repository = path.resolve('.');

    expect(defaultStateDirectory().startsWith(os.homedir())).toBe(true);
    expect(resolveStateDirectory(null, repository)).toBe(defaultStateDirectory());
    expect(resolveStateDirectory(directory, repository)).toBe(path.resolve(directory));
    expect(() => resolveStateDirectory(path.join(repository, 'tmp', 'state'), repository)).toThrow(/outside the repository/);
    expect(() => resolveStateDirectory(repository, repository)).toThrow(/outside the repository/);
  });

  it('saves each manifest as its own private JSON file', async () => {
    const world = createWorld();
    const deps = { ...world.deps(), lock: createFileRunLock({ directory }), writeManifest: createManifestWriter(directory) };

    const result = await runChallengerAds({ mode: 'apply', confirmed: [...APPLY] }, deps);

    expect(result.ok).toBe(true);
    const files = await readdir(path.join(directory, 'manifests'));
    expect(files).toEqual(['run-1-apply.json']);
    const file = path.join(directory, 'manifests', files[0]!);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved).toMatchObject({ runId: 'run-1', mode: 'apply', outcome: 'completed' });
    expect(saved.campaigns).toHaveLength(4);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expectNoSecrets(await readFile(file, 'utf8'));
    // The run released its lock.
    await expect(stat(path.join(directory, LOCK_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates the state directory when it does not exist yet', async () => {
    const nested = path.join(directory, 'not', 'there', 'yet');
    await mkdir(directory, { recursive: true });

    expect(await createFileRunLock({ directory: nested }).acquire('run-a')).toEqual({ acquired: true });
  });
});

describe('--activate', () => {
  async function appliedWorld(): Promise<World> {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    world.output.length = 0;
    return world;
  }

  it('stops before any write until every check a person makes is confirmed', async () => {
    const world = await appliedWorld();
    const writes = { db: world.db.writes().length, meta: world.meta.writes().length };

    const result = await run(world, 'activate', ['owner-go-ahead', 'claims', 'short-links', 'previews', 'public-hours', 'booking-system']);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('organic-booking');
    expect(world.db.writes()).toHaveLength(writes.db);
    expect(world.meta.writes()).toHaveLength(writes.meta);
  });

  it('switches on all four, reads Meta back, then records it locally', async () => {
    const world = await appliedWorld();
    const before = untouchedFingerprint(world);
    const ids = challengerAdIds(world);

    const result = await run(world, 'activate', ALL);

    expect(result.ok).toBe(true);
    // Only the four challengers were touched: never an original, the rewrite or an ad set.
    expect(world.meta.callsTo('setObjectStatus')).toEqual(ids.map((id) => [id, 'ACTIVE']));
    expect(untouchedFingerprint(world)).toBe(before);
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      expect(world.challengerRows(campaign.key)[0]).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
    }
    expect(world.manifests.at(-1)!.campaigns.map((campaign) => campaign.stage)).toEqual(['S6', 'S6', 'S6', 'S6']);
  });

  it('shows review after activation as pending, never as a pass', async () => {
    const world = await appliedWorld();

    await run(world, 'activate', ALL);

    expect(world.text()).toContain('Review: pending (Meta has not finished review (PENDING_REVIEW))');
    expect(world.text()).toContain('Run --status every 15 minutes for up to 2 hours');
    expect(world.manifests.at(-1)!.campaigns.map((campaign) => campaign.checks.review!.result)).toEqual(
      ['pending', 'pending', 'pending', 'pending'],
    );
  });

  it('switches nothing on when the challengers have not been created', async () => {
    const world = createWorld();

    const result = await run(world, 'activate', ALL);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('run --apply first');
    expectNoWritesAnywhere(world);
  });

  it.each([
    ['one creative has a feature opted in', (world: World) => {
      const creative = Array.from(world.meta.creatives.values()).filter((item) => item.name === CHALLENGER_AD_NAME)[1]!;
      creative.features!.text_generation = { enroll_status: 'OPT_IN' };
    }, 'Lunch B: enhancements is fail'],
    ['one creative\'s opt-out cannot be shown (unverified)', (world: World) => {
      Array.from(world.meta.creatives.values()).filter((item) => item.name === CHALLENGER_AD_NAME)[2]!.features = null;
    }, 'Dinner A: enhancements is unverified'],
    ['one creative points at the campaign-level link', (world: World) => {
      const creative = Array.from(world.meta.creatives.values()).filter((item) => item.name === CHALLENGER_AD_NAME)[0]!;
      creative.link = 'https://l.the-anchor.pub/0ai0j0';
      creative.callToActionLink = 'https://l.the-anchor.pub/0ai0j0';
    }, 'Lunch A: own link is fail'],
    ['one ad has review feedback', (world: World) => {
      const ad = Array.from(world.meta.ads.values()).filter((item) => item.name === CHALLENGER_AD_NAME)[3]!;
      ad.ad_review_feedback = { global: { ALCOHOL: 'Rejected' } };
    }, 'Dinner B: review is fail'],
    ['one ad is still in review', (world: World) => {
      Array.from(world.meta.ads.values()).filter((item) => item.name === CHALLENGER_AD_NAME)[0]!.effective_status = 'PENDING_REVIEW';
    }, 'Lunch A: review is pending'],
    ['the spending limit does not cover what is still to run', (world: World) => {
      world.meta.account.amountSpentMinor = 30_000;
    }, 'the account check is fail'],
    ['the spending limit cannot be read', (world: World) => {
      world.meta.account.spendCapMinor = null;
    }, 'the account check is unverified'],
  ])('switches nothing on when %s', async (_name, arrange, says) => {
    const world = await appliedWorld();
    arrange(world);
    rebaseline(world);

    const result = await run(world, 'activate', ALL);

    expect(result.ok).toBe(false);
    expect(world.text()).toContain(says);
    expect(world.meta.callsTo('setObjectStatus')).toEqual([]);
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      expect(world.challengerRows(campaign.key)[0]).toMatchObject({ status: 'PAUSED', meta_status: 'PAUSED' });
    }
    for (const id of challengerAdIds(world)) expect(world.meta.ads.get(id)!.configured_status).toBe('PAUSED');
  });

  it('reports a switch that Meta made but the local save missed, and the next run follows Meta', async () => {
    const world = await appliedWorld();
    const before = untouchedFingerprint(world);
    world.db.failNext({ table: 'ads', op: 'update', message: 'connection reset', match: (call) => payloadOf(call).status === 'ACTIVE' });
    const [lunchA] = world.challengerRows('lunch_a');

    const first = await run(world, 'activate', ALL);

    expect(first.ok).toBe(false);
    expect(world.text()).toContain(`Mismatch: ad ${String(lunchA!.meta_ad_id)} is live on Meta but the local row still says PAUSED`);
    expect(world.meta.ads.get(String(lunchA!.meta_ad_id))!.configured_status).toBe('ACTIVE');
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'PAUSED' });
    // The other three went through.
    for (const key of ['lunch_b', 'dinner_a', 'dinner_b'] as const) {
      expect(world.challengerRows(key)[0]).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
    }
    const switches = world.meta.callsTo('setObjectStatus').length;
    world.output.length = 0;

    const second = await run(world, 'activate', ALL);

    expect(second.ok).toBe(true);
    expect(world.text()).toContain('Already live on Meta from an earlier run; the local row now says ACTIVE too');
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
    // Reconciled from Meta's state: no ad was switched on a second time.
    expect(world.meta.callsTo('setObjectStatus')).toHaveLength(switches);
    expect(untouchedFingerprint(world)).toBe(before);
  });

  it('records an ad as live when Meta switched it on but did not confirm', async () => {
    const world = await appliedWorld();
    world.meta.fail({ method: 'setObjectStatus', when: 'after' });

    const result = await run(world, 'activate', ALL);

    expect(result.ok).toBe(true);
    expect(world.text()).toContain('Meta did not confirm the switch');
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
  });

  it('leaves the local row alone when Meta did not switch the ad on, and a retry finishes the job', async () => {
    const world = await appliedWorld();
    world.meta.fail({ method: 'setObjectStatus', when: 'before', error: new MetaApiError('Please retry later', 2) });

    const first = await run(world, 'activate', ALL);

    expect(first.ok).toBe(false);
    expect(world.text()).toContain('Not switched on: Meta shows PAUSED. The local row is unchanged.');
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'PAUSED', meta_status: 'PAUSED' });

    const second = await run(world, 'activate', ALL);

    expect(second.ok).toBe(true);
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      const [row] = world.challengerRows(campaign.key);
      expect(row).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
      expect(world.meta.ads.get(String(row!.meta_ad_id))!.configured_status).toBe('ACTIVE');
    }
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });

  it('stops the run when Meta cannot be read after a switch, and the next run follows Meta', async () => {
    const world = await appliedWorld();
    // Each campaign is read once in the checks; the fifth read is the one after the first switch.
    let reads = 0;
    world.meta.fail({ method: 'readAdForLaunch', when: 'before', match: () => (reads += 1) === 5 });

    const first = await run(world, 'activate', ALL);

    expect(first.ok).toBe(false);
    expect(world.text()).toContain('its state is not known');
    expect(world.meta.callsTo('setObjectStatus')).toHaveLength(1);

    const second = await run(world, 'activate', ALL);

    expect(second.ok).toBe(true);
    // Lunch A was already live on Meta, so only the other three were switched on now.
    expect(world.meta.callsTo('setObjectStatus')).toHaveLength(4);
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      expect(world.challengerRows(campaign.key)[0]).toMatchObject({ status: 'ACTIVE', meta_status: 'ACTIVE' });
    }
  });
});

describe('--status', () => {
  it('is read only at every stage and reports stage, local and Meta status, and review', async () => {
    const world = createWorld();

    expect((await run(world, 'status')).ok).toBe(true);
    expectNoWritesAnywhere(world);
    expect(world.text()).toContain('Stage: S0');
    expect(world.text()).toContain('On Meta: no challenger ad');

    await run(world, 'apply', APPLY);
    await run(world, 'activate', ALL);
    const writes = { db: world.db.writes().length, meta: world.meta.writes().length, posts: world.management.posts.length };
    world.output.length = 0;

    const result = await run(world, 'status');

    expect(result.ok).toBe(true);
    expect(world.db.writes()).toHaveLength(writes.db);
    expect(world.meta.writes()).toHaveLength(writes.meta);
    expect(world.management.posts).toHaveLength(writes.posts);
    expect(world.manifests).toHaveLength(2);
    expect(world.text()).toContain('Stage: S6');
    expect(world.text()).toContain('status ACTIVE, Meta status ACTIVE');
    expect(world.text()).toContain('Review: pending');
    expectNoSecrets(world.text());
  });

  it('says "not checked", never "none", when Meta could not be asked', async () => {
    const world = createWorld();
    world.db.tables.meta_ad_account_tokens = [];

    const result = await run(world, 'status');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('On Meta: not checked');
    expect(world.text()).not.toContain('On Meta: no challenger ad');
    expectNoWritesAnywhere(world);
  });

  it('reports review as a pass once Meta shows the ad as active', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    await run(world, 'activate', ALL);
    for (const id of challengerAdIds(world)) world.meta.ads.get(id)!.effective_status = 'ACTIVE';
    world.output.length = 0;

    await run(world, 'status');

    expect(world.text()).not.toContain('Review: pending');
    expect(world.text().match(/Review: pass/g)).toHaveLength(4);
  });

  it('reports a rejected ad and a local and Meta mismatch', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    const [row] = world.challengerRows('dinner_b');
    const ad = world.meta.ads.get(String(row!.meta_ad_id))!;
    ad.configured_status = 'ACTIVE';
    ad.effective_status = 'DISAPPROVED';
    world.output.length = 0;

    await run(world, 'status');

    expect(world.text()).toContain('Review: fail (Meta reports the ad as DISAPPROVED)');
    expect(world.text()).toContain('Mismatch: the local row says PAUSED, Meta says ACTIVE');
  });
});

describe('--pause', () => {
  async function liveWorld(): Promise<World> {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    await run(world, 'activate', ALL);
    world.output.length = 0;
    return world;
  }

  it('pauses every challenger, confirms each by reading Meta back, then updates the local rows', async () => {
    const world = await liveWorld();
    const before = untouchedFingerprint(world);
    const ids = challengerAdIds(world);

    const result = await run(world, 'pause');

    expect(result.ok).toBe(true);
    expect(world.meta.callsTo('setObjectStatus').slice(-4)).toEqual(ids.map((id) => [id, 'PAUSED']));
    for (const id of ids) expect(world.meta.ads.get(id)!.configured_status).toBe('PAUSED');
    for (const campaign of WEEKDAY_CAMPAIGNS) {
      expect(world.challengerRows(campaign.key)[0]).toMatchObject({ status: 'PAUSED', meta_status: 'PAUSED' });
    }
    expect(world.text()).toContain('Challenger ids still active: none.');
    expect(world.manifests.at(-1)!.challengerIdsStillActive).toEqual([]);
    // The originals, the rewrite and the short links are untouched.
    expect(untouchedFingerprint(world)).toBe(before);
    expect(challengerCounts(world)).toEqual(ONE_OF_EACH);
  });

  it('works on campaigns that are no longer ACTIVE, after the flight, with object counts off', async () => {
    const world = await liveWorld();
    for (const campaign of WEEKDAY_CAMPAIGNS) world.campaignRow(campaign.key).status = 'PAUSED';
    world.campaignRow('lunch_a').campaign_kind = 'event';
    world.now = new Date('2026-10-20T09:00:00.000Z');
    world.db.rows('ads').push({ ...structuredClone(world.db.rows('ads')[0]!), id: 'extra-row', name: 'Unexpected', meta_ad_id: '555' });
    world.graphVersion = 'v25.0';
    rebaseline(world);

    const result = await run(world, 'pause');

    expect(result.ok).toBe(true);
    for (const id of challengerAdIds(world)) expect(world.meta.ads.get(id)!.configured_status).toBe('PAUSED');
    expect(world.text()).toContain('Challenger ids still active: none.');
  });

  it('needs no confirmations and makes no status call for an ad that is already paused', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);

    const result = await run(world, 'pause');

    expect(result.ok).toBe(true);
    expect(world.meta.callsTo('setObjectStatus')).toEqual([]);
    expect(world.text()).toContain('already paused on Meta');
  });

  it('finds a challenger by its name when its id was never saved, and saves it', async () => {
    const world = await liveWorld();
    const [row] = world.challengerRows('dinner_a');
    const adId = row!.meta_ad_id;
    Object.assign(row!, { meta_ad_id: null, status: 'DRAFT', meta_status: null });

    const result = await run(world, 'pause');

    expect(result.ok).toBe(true);
    expect(world.meta.ads.get(String(adId))!.configured_status).toBe('PAUSED');
    expect(world.challengerRows('dinner_a')[0]).toMatchObject({ meta_ad_id: adId, status: 'PAUSED', meta_status: 'PAUSED' });
  });

  it('reports a pause Meta made but the local save missed, separately from a failed pause', async () => {
    const world = await liveWorld();
    world.db.failNext({ table: 'ads', op: 'update', message: 'connection reset', match: (call) => payloadOf(call).status === 'PAUSED' });

    const result = await run(world, 'pause');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Mismatch (the ad IS paused on Meta)');
    // Every ad is paused on Meta, so none is listed as still active.
    expect(world.text()).toContain('Challenger ids still active: none.');
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'ACTIVE' });
    for (const id of challengerAdIds(world)) expect(world.meta.ads.get(id)!.configured_status).toBe('PAUSED');

    // The next run puts the local row right.
    expect((await run(world, 'pause')).ok).toBe(true);
    expect(world.challengerRows('lunch_a')[0]).toMatchObject({ status: 'PAUSED', meta_status: 'PAUSED' });
  });

  it('lists the ids still active after a partial failure, and pauses the rest', async () => {
    const world = await liveWorld();
    const ids = challengerAdIds(world);
    world.meta.fail({
      method: 'setObjectStatus',
      when: 'before',
      error: new MetaApiError('Please retry later', 2),
      match: (args) => args[0] === ids[1],
    });

    const result = await run(world, 'pause');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain(`Ad ${ids[1]}: NOT paused. Meta shows ACTIVE`);
    expect(world.text()).toContain(`Challenger ids still active: ${ids[1]}.`);
    expect(world.manifests.at(-1)!.challengerIdsStillActive).toEqual([ids[1]]);
    expect(world.challengerRows('lunch_b')[0]).toMatchObject({ status: 'ACTIVE' });
    for (const id of [ids[0]!, ids[2]!, ids[3]!]) expect(world.meta.ads.get(id)!.configured_status).toBe('PAUSED');
  });

  it('treats an ad whose state cannot be read after the pause as still active', async () => {
    const world = await liveWorld();
    const ids = challengerAdIds(world);
    world.meta.fail({ method: 'readAdForLaunch', when: 'before', match: (args) => args[0] === ids[0] });
    world.meta.fail({ method: 'readAdForLaunch', when: 'before', match: (args) => args[0] === ids[0] });

    const result = await run(world, 'pause');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Treat it as still active');
    expect(world.manifests.at(-1)!.challengerIdsStillActive).toEqual([ids[0]]);
  });

  it('never pauses an original ad, even one that has been given the challenger\'s name', async () => {
    const world = await liveWorld();
    const original = WEEKDAY_CAMPAIGNS[0]!.originalMetaAdIds[0];
    world.meta.ads.get(original)!.name = CHALLENGER_AD_NAME;
    const originalAd = structuredClone(world.meta.ads.get(original)!);

    await run(world, 'pause');


    expect(world.text()).toContain(`Skipped ${original}: it is an original ad, not a challenger`);
    expect(world.meta.ads.get(original)!.configured_status).toBe('ACTIVE');
    expect(world.meta.ads.get(original)).toEqual(originalAd);
    expect(world.meta.callsTo('setObjectStatus').map(([id]) => id)).not.toContain(original);
    // Put the name back so the check after every test compares like with like.
    world.meta.ads.get(original)!.name = `${AD_SET_NAME} | Now serving lunch | Var 1`;
  });

  it('pauses every ad carrying the challenger\'s name when Meta holds more than one', async () => {
    const world = await liveWorld();
    world.meta.ads.set('duplicate-ad', {
      id: 'duplicate-ad',
      name: CHALLENGER_AD_NAME,
      adset_id: WEEKDAY_CAMPAIGNS[0]!.metaAdSetId,
      creative_id: 'c',
      configured_status: 'ACTIVE',
      effective_status: 'ACTIVE',
      ad_review_feedback: null,
    });

    await run(world, 'pause');

    expect(world.meta.ads.get('duplicate-ad')!.configured_status).toBe('PAUSED');
    expect(world.text()).toContain('Challenger ids still active: none.');
  });

  it('says how to pause by hand when the token is not available', async () => {
    const world = await liveWorld();
    world.db.tables.meta_ad_account_tokens = [];
    const metaWrites = world.meta.writes().length;

    const result = await run(world, 'pause');

    expect(result.ok).toBe(false);
    expect(world.text()).toContain('Pause the ads through the CheersAI app or the Graph API instead');
    expect(world.meta.writes()).toHaveLength(metaWrites);
  });
});

describe('tenancy and token handling', () => {
  it('scopes every database call and reads the token only from the encrypted table', async () => {
    const world = createWorld();
    await run(world, 'dry-run');
    await run(world, 'apply', APPLY);
    await run(world, 'activate', ALL);
    await run(world, 'status');
    await run(world, 'pause');

    const campaignIds = WEEKDAY_CAMPAIGNS.map((campaign) => campaign.campaignId);
    const adSetIds = WEEKDAY_CAMPAIGNS.map((campaign) => world.adSetId(campaign.key));
    const has = (call: DbCall, column: string) => call.filters.find(([, name]) => name === column);

    for (const call of world.db.calls.filter((item) => !item.table.startsWith('storage:'))) {
      if (['meta_campaigns', 'meta_ad_accounts', 'meta_ad_account_tokens', 'social_connections', 'management_app_connections', 'media_assets'].includes(call.table)) {
        // Every table that has an account_id column is filtered by it.
        expect(has(call, 'account_id')).toEqual(['eq', 'account_id', WEEKDAY_ACCOUNT_ID]);
      } else if (call.table === 'ad_sets') {
        expect(call.op).toBe('select');
        expect(campaignIds).toContain(has(call, 'campaign_id')![2]);
      } else if (call.table === 'ads' && call.op === 'select') {
        for (const id of has(call, 'adset_id')![2] as string[]) expect(adSetIds).toContain(id);
      } else if (call.table === 'ads' && call.op === 'insert') {
        expect(adSetIds).toContain(payloadOf(call).adset_id);
      } else if (call.table === 'ads' && call.op === 'update') {
        expect(has(call, 'id')).toBeTruthy();
        expect(adSetIds).toContain(has(call, 'adset_id')![2]);
      } else {
        throw new Error(`unexpected database call: ${call.op} on ${call.table}`);
      }
    }

    // The dead plaintext column is never asked for, and nothing is ever deleted or upserted.
    for (const call of world.db.calls.filter((item) => item.table === 'meta_ad_accounts')) {
      expect(call.columns).not.toContain('access_token');
    }
    expect(world.db.calls.filter((call) => call.table === 'meta_ad_account_tokens').every((call) => call.op === 'select')).toBe(true);
    expect(world.db.calls.filter((call) => ['delete', 'upsert', 'rpc'].includes(call.op))).toEqual([]);
    // Only the challenger rows and the four snapshots are ever written.
    const written = new Set(world.db.writes().map((call) => `${call.table}:${call.op}`));
    expect(Array.from(written).sort()).toEqual(['ads:insert', 'ads:update', 'meta_campaigns:update', 'storage:media:createSignedUrl']);
    for (const call of world.db.writes().filter((item) => item.table === 'meta_campaigns')) {
      expect(Object.keys(payloadOf(call))).toEqual(['source_snapshot']);
    }
    expectNoSecrets(world.text());
    for (const manifest of world.manifests) expectNoSecrets(JSON.stringify(manifest));
  });

  it('never writes to an original ad row', async () => {
    const world = createWorld();
    await run(world, 'apply', APPLY);
    await run(world, 'activate', ALL);
    await run(world, 'pause');

    const challengerRowIds = new Set(WEEKDAY_CAMPAIGNS.map((campaign) => world.challengerRows(campaign.key)[0]!.id));
    for (const call of world.db.writes().filter((item) => item.table === 'ads' && item.op === 'update')) {
      expect(challengerRowIds).toContain(call.filters.find(([, name]) => name === 'id')![2]);
    }
    expect(world.db.rows('ad_sets').map((row) => row.name)).toEqual([AD_SET_NAME, AD_SET_NAME, AD_SET_NAME, AD_SET_NAME]);
  });
});

describe('reach', () => {
  it('is imported by nothing in the app: only the ops script can run it', async () => {
    const root = path.resolve(__dirname, '../..');
    const own = new Set(['src/lib/campaigns/challenger-ads.ts', 'src/lib/campaigns/challenger-ads-files.ts']);
    const importers: string[] = [];

    async function scan(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await scan(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const relative = path.relative(root, full).split(path.sep).join('/');
          if (!own.has(relative) && (await readFile(full, 'utf8')).includes('challenger-ads')) importers.push(relative);
        }
      }
    }
    await scan(path.join(root, 'src'));

    expect(importers).toEqual([]);
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseArgs([])).toEqual({ mode: 'dry-run', confirmed: [], stateDir: null, help: false });
    expect(parseArgs(['--dry-run']).mode).toBe('dry-run');
  });

  it('reads each mode', () => {
    expect(parseArgs(['--apply']).mode).toBe('apply');
    expect(parseArgs(['--activate']).mode).toBe('activate');
    expect(parseArgs(['--pause']).mode).toBe('pause');
    expect(parseArgs(['--status']).mode).toBe('status');
  });

  it('reads confirmations, the state directory and help', () => {
    expect(parseArgs(['--apply', '--confirmed', 'owner-go-ahead,claims', '--state-dir', '/somewhere/else', '--confirmed', 'previews'])).toEqual({
      mode: 'apply',
      confirmed: ['owner-go-ahead,claims', 'previews'],
      stateDir: '/somewhere/else',
      help: false,
    });
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('refuses two modes at once, so a slip cannot turn a dry run into a write', () => {
    expect(() => parseArgs(['--dry-run', '--apply'])).toThrow(/Choose one mode only/);
    expect(() => parseArgs(['--apply', '--activate'])).toThrow(/Choose one mode only/);
  });

  it('refuses anything it does not know, and an option without its value', () => {
    expect(() => parseArgs(['--aply'])).toThrow('Unknown argument: --aply');
    expect(() => parseArgs(['constructor'])).toThrow('Unknown argument: constructor');
    expect(() => parseArgs(['--confirmed'])).toThrow('--confirmed needs a value.');
    expect(() => parseArgs(['--confirmed', '--apply'])).toThrow('--confirmed needs a value.');
    expect(() => parseArgs(['--state-dir'])).toThrow('--state-dir needs a value.');
  });
});
