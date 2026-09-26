import { beforeEach, describe, expect, it } from 'vitest';

import { exportBrandData, offboardBrand, purgeBrand } from '@/lib/admin/offboarding';

import { orPredicate } from '../../helpers/postgrest-or';

type Row = Record<string, unknown>;

const BRAND = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';

let db: Record<string, Row[]>;
let storage: Set<string>;
const deletedUsers: string[] = [];
let failDeleteUser: string | null = null;

// Live NOT NULL columns, so a null write fails here as it does in production.
const NOT_NULL: Record<string, string[]> = {
  meta_ad_accounts: ['access_token', 'setup_complete'],
  management_app_connections: ['api_key', 'enabled'],
  social_connections: ['status'],
};

// ad_sets.adset_media_asset_id points at media_assets with no ON DELETE
// action, and the live accounts cascade reaches media_assets before ad_sets
// (proved on a replica of the live constraint graph), so an ad set still
// pointing at the brand's media fails the accounts delete.
function blockingMediaReference(): string | null {
  const media = new Set(db.media_assets.filter((r) => r.account_id === BRAND).map((r) => r.id));
  return db.ad_sets.some((r) => media.has(r.adset_media_asset_id)) ? 'ad_sets_adset_media_asset_id_fkey' : null;
}

// PostgREST returns at most this many rows unless the caller pages with range().
const ROW_CAP = 1000;

function query(table: string) {
  let op: 'select' | 'update' | 'delete' = 'select';
  let patch: Row = {};
  let head = false;
  let columns: string[] | null = null;
  let orderBy: string | null = null;
  let window: [number, number] | null = null;
  const preds: Array<(r: Row) => boolean> = [];
  const matches = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const run = () => {
    if (op === 'update') {
      const rows = matches();
      for (const column of NOT_NULL[table] ?? []) {
        if (rows.length && column in patch && patch[column] === null) {
          return { data: null, error: { message: `null value in column "${column}" violates not-null constraint` } };
        }
      }
      rows.forEach((r) => Object.assign(r, patch));
      return { data: rows, error: null };
    }
    if (op === 'delete') {
      if (table === 'accounts') {
        const blocked = blockingMediaReference();
        if (blocked) return { data: null, error: { message: `update or delete on table "media_assets" violates foreign key constraint "${blocked}"` } };
      }
      db[table] = (db[table] ?? []).filter((r) => !preds.every((p) => p(r)));
      // Cascade: deleting a brand removes every row that points at it.
      if (table === 'accounts') for (const t of Object.keys(db)) if (t !== 'accounts') db[t] = db[t].filter((r) => r.account_id !== BRAND || t === 'app_admins');
      // ad_sets cascade from meta_campaigns.
      const campaigns = new Set(db.meta_campaigns.map((r) => r.id));
      db.ad_sets = db.ad_sets.filter((r) => campaigns.has(r.campaign_id));
      return { data: null, error: null };
    }
    let rows = matches();
    if (head) return { count: rows.length, error: null };
    if (orderBy) {
      const column = orderBy;
      rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
    }
    rows = window ? rows.slice(window[0], window[1] + 1) : rows.slice(0, ROW_CAP);
    // Honour a plain column list, as PostgREST does.
    const project = columns;
    return { data: project ? rows.map((r) => Object.fromEntries(project.map((c) => [c, r[c]]))) : rows, error: null };
  };
  const q: Record<string, unknown> = {
    select: (c?: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head);
      if (op === 'select' && c && !c.includes('*') && !c.includes('(')) columns = c.split(',').map((x) => x.trim());
      return q;
    },
    update: (p: Row) => {
      op = 'update';
      patch = p;
      return q;
    },
    delete: () => {
      op = 'delete';
      return q;
    },
    eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), q),
    in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
    // Each or() is its own predicate, so two or() calls are ANDed as PostgREST does.
    or: (filter: string) => (preds.push(orPredicate(filter)), q),
    order: (c: string) => ((orderBy = c), q),
    range: (from: number, to: number) => ((window = [from, to]), q),
    maybeSingle: async () => {
      const result = run() as { data: Row[] | null; error: null };
      return { data: result.data?.[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
  };
  return q;
}

function service() {
  return {
    from: (t: string) => query(t),
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { limit: number; offset?: number }) => {
          const children = new Map<string, boolean>();
          for (const path of storage) {
            if (!path.startsWith(`${prefix}/`)) continue;
            const rest = path.slice(prefix.length + 1);
            const [first, ...more] = rest.split('/');
            children.set(first, more.length === 0 || children.get(first) === true);
          }
          const all = [...children].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }));
          const offset = opts.offset ?? 0;
          return { data: all.slice(offset, offset + opts.limit), error: null };
        },
        remove: async (paths: string[]) => {
          paths.forEach((p) => storage.delete(p));
          return { data: [], error: null };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null }),
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) =>
          id === failDeleteUser ? { error: { message: 'Database error deleting user' } } : (deletedUsers.push(id), { error: null }),
      },
    },
  };
}

beforeEach(() => {
  deletedUsers.length = 0;
  failDeleteUser = null;
  db = {
    accounts: [
      { id: BRAND, business_name: 'The New Venue', email: 'o@v.test', timezone: 'Europe/London', created_at: '2026-01-01', offboarded_at: null, purge_after: null, archived_at: null, booking_ingest_secret: 'bce_brand' },
      { id: OTHER, business_name: 'Other', offboarded_at: null, booking_ingest_secret: 'bce_other' },
    ],
    subscriptions: [],
    meta_campaigns: [
      { id: 'c1', account_id: BRAND, status: 'PAUSED', meta_status: 'PAUSED', end_date: '2026-10-16' },
      // Ended months ago but still ACTIVE in the table, as The Anchor's are: cannot spend, must not block.
      { id: 'c-ended', account_id: BRAND, status: 'ACTIVE', meta_status: 'ACTIVE', end_date: '2026-08-14' },
      // Another brand's running campaign is not this brand's business.
      { id: 'c-other', account_id: OTHER, status: 'ACTIVE', meta_status: 'ACTIVE', end_date: null },
    ],
    ad_sets: [{ id: 'as1', campaign_id: 'c1', adset_media_asset_id: 'm1' }],
    campaigns: [{ id: 'cp1', account_id: BRAND, hero_media_id: 'm1' }],
    tournaments: [
      { id: 't1', account_id: BRAND, feed_api_key: 'feed-brand' },
      { id: 'tx', account_id: OTHER, feed_api_key: 'feed-other' },
    ],
    management_app_connections: [
      { account_id: BRAND, api_key: 'mgmt-brand', enabled: true },
      { account_id: OTHER, api_key: 'mgmt-other', enabled: true },
    ],
    content_items: [
      { id: 'post-1', account_id: BRAND, status: 'scheduled' },
      { id: 'post-2', account_id: BRAND, status: 'posted' },
      { id: 'post-x', account_id: OTHER, status: 'scheduled' },
    ],
    publish_jobs: [
      { id: 'j1', account_id: BRAND, status: 'queued' },
      { id: 'j2', account_id: BRAND, status: 'succeeded' },
      { id: 'jx', account_id: OTHER, status: 'queued' },
    ],
    social_connections: [
      { id: 'sc1', account_id: BRAND, status: 'active', access_token: 't' },
      { id: 'scx', account_id: OTHER, status: 'active', access_token: 'keep' },
    ],
    token_vault: [
      { id: 'v1', social_connection_id: 'sc1' },
      { id: 'vx', social_connection_id: 'scx' },
    ],
    meta_ad_accounts: [
      { id: 'ads', account_id: BRAND, setup_complete: true },
      { id: 'ads-x', account_id: OTHER, setup_complete: true },
    ],
    meta_ad_account_tokens: [
      { id: 'tok-1', account_id: BRAND, token_type: 'access' },
      { id: 'tok-2', account_id: BRAND, token_type: 'conversions_api' },
      { id: 'tok-x', account_id: OTHER, token_type: 'access' },
    ],
    media_assets: [
      { id: 'm1', account_id: BRAND, file_name: 'a.jpg', media_type: 'image', storage_path: `${BRAND}/m1/a.jpg`, uploaded_at: null, derived_variants: { story: 'derived/m1/story.jpg' } },
      { id: 'm2', account_id: BRAND, file_name: 't.jpg', media_type: 'image', storage_path: 'tournaments/t1/x/facebook-feed.jpg', uploaded_at: null, derived_variants: null },
    ],
    account_members: [
      { account_id: BRAND, user_id: 'only-here' },
      { account_id: BRAND, user_id: 'also-other' },
      { account_id: OTHER, user_id: 'also-other' },
      { account_id: BRAND, user_id: 'operator' },
    ],
    app_admins: [{ user_id: 'operator' }],
    brand_profile: [],
    posting_defaults: [],
    link_in_bio_profiles: [{ id: 'lp1', account_id: BRAND }],
    link_in_bio_tiles: [],
    link_in_bio_clicks: [
      { id: 'click-1', profile_id: 'lp1', tile_id: null, referrer: 'instagram.com' },
      { id: 'click-x', profile_id: 'lp-other', tile_id: null, referrer: 'instagram.com' },
    ],
    link_in_bio_page_views: [
      { id: 'view-1', profile_id: 'lp1', referrer: 'instagram.com' },
      { id: 'view-x', profile_id: 'lp-other', referrer: 'instagram.com' },
    ],
  };
  storage = new Set([
    `${BRAND}/m1/a.jpg`,
    'derived/m1/story.jpg',
    'tournaments/t1/x/facebook-feed.jpg',
    'banners/post-1/feed.jpg',
    'banners/post-2/story.jpg',
    'banners/post-x/feed.jpg',
    `${OTHER}/m9/b.jpg`,
  ]);
});

const NOW = new Date('2026-10-01T12:00:00Z');

describe('offboardBrand', () => {
  it('refuses while a Stripe subscription is running', async () => {
    db.subscriptions.push({ account_id: BRAND, status: 'active' });
    expect(await offboardBrand(service() as never, BRAND, NOW)).toEqual({ error: "Cancel the brand's Stripe subscription first, then offboard." });
    expect(db.accounts[0].offboarded_at).toBeNull();
  });

  it.each([
    ['ends later', '2026-10-16'],
    ['ends today', '2026-10-01'],
    ['has no end date', null],
  ])('refuses while an ACTIVE campaign that %s can still spend', async (_label, endDate) => {
    Object.assign(db.meta_campaigns[0], { status: 'ACTIVE', meta_status: 'ACTIVE', end_date: endDate });
    expect((await offboardBrand(service() as never, BRAND, NOW) as { error: string }).error).toMatch(/Pause the brand's live Meta ad campaigns/);
    expect(db.accounts[0].offboarded_at).toBeNull();
    expect(db.meta_ad_account_tokens).toHaveLength(3);
  });

  it('refuses when Meta reports a campaign live that the app shows as paused', async () => {
    db.meta_campaigns[0].meta_status = 'ACTIVE';
    expect((await offboardBrand(service() as never, BRAND, NOW) as { error: string }).error).toMatch(/Pause the brand's live Meta ad campaigns/);
    expect(db.accounts[0].offboarded_at).toBeNull();
    expect(db.meta_ad_account_tokens).toHaveLength(3);
  });

  it('is not blocked by an ACTIVE campaign whose end date has passed', async () => {
    Object.assign(db.meta_campaigns[0], { status: 'ACTIVE', meta_status: 'ACTIVE', end_date: '2026-09-30' });
    expect(await offboardBrand(service() as never, BRAND, NOW)).toMatchObject({ postsStopped: 1 });
    expect(db.accounts[0].offboarded_at).toBe(NOW.toISOString());
  });

  it('uses the London date: at 00:30 BST a campaign that ended the day before does not block', async () => {
    // 23:30 UTC on 30 September is 00:30 on 1 October in London.
    const justAfterMidnight = new Date('2026-09-30T23:30:00Z');
    Object.assign(db.meta_campaigns[0], { status: 'ACTIVE', meta_status: 'ACTIVE', end_date: '2026-09-30' });
    expect(await offboardBrand(service() as never, BRAND, justAfterMidnight)).toMatchObject({ postsStopped: 1 });
  });

  it('stops posts, deletes tokens and archives with a 30-day purge date, touching no other brand', async () => {
    const result = await offboardBrand(service() as never, BRAND, NOW);
    expect(result).toEqual({ postsStopped: 1, connectionsRevoked: 1, purgeAfter: '2026-10-31T12:00:00.000Z' });

    expect(db.content_items.find((r) => r.id === 'post-1')?.status).toBe('draft');
    expect(db.content_items.find((r) => r.id === 'post-x')?.status).toBe('scheduled');
    expect(db.publish_jobs.find((r) => r.id === 'j1')).toMatchObject({ status: 'held', hold_reason: 'entitlement' });
    expect(db.publish_jobs.find((r) => r.id === 'jx')?.status).toBe('queued');
    expect(db.token_vault.map((r) => r.id)).toEqual(['vx']);
    expect(db.social_connections.find((r) => r.id === 'sc1')).toMatchObject({ status: 'needs_action', access_token: null });
    expect(db.social_connections.find((r) => r.id === 'scx')?.access_token).toBe('keep');
    expect(db.meta_ad_accounts[0]).toMatchObject({ setup_complete: false });
    // Encrypted tokens go too; another brand's are untouched.
    expect(db.meta_ad_account_tokens.map((r) => r.id)).toEqual(['tok-x']);
    expect(db.meta_ad_accounts[1]).toMatchObject({ setup_complete: true });
    expect(db.tournaments.map((r) => r.feed_api_key)).toEqual([null, 'feed-other']);
    expect(db.management_app_connections).toEqual([
      { account_id: BRAND, api_key: '', enabled: false },
      { account_id: OTHER, api_key: 'mgmt-other', enabled: true },
    ]);
    expect(db.accounts[0]).toMatchObject({ archived_at: NOW.toISOString(), offboarded_at: NOW.toISOString(), booking_ingest_secret: null });
    expect(db.accounts[1].booking_ingest_secret).toBe('bce_other');

    expect(await offboardBrand(service() as never, BRAND, NOW)).toEqual({ error: 'This brand has already been offboarded.' });
  });
});

describe('exportBrandData', () => {
  it('exports the brand without credentials, with signed media links', async () => {
    const data = await exportBrandData(service() as never, BRAND);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/access_token|booking_ingest_secret/);
    expect((data.media as Array<{ downloadUrl: string }>)[0].downloadUrl).toBe(`https://signed/${BRAND}/m1/a.jpg`);
    expect((data.posts as unknown[]).length).toBe(2);
  });
});

describe('purgeBrand', () => {
  it('refuses a brand that was never offboarded, or before the date', async () => {
    expect(await purgeBrand(service() as never, BRAND, NOW)).toEqual({ error: 'Only an offboarded brand can be deleted.' });
    Object.assign(db.accounts[0], { offboarded_at: '2026-10-01T00:00:00Z', purge_after: '2026-10-31T00:00:00Z' });
    expect((await purgeBrand(service() as never, BRAND, NOW) as { error: string }).error).toMatch(/kept until 2026-10-31/);
    expect(storage.size).toBe(7);
  });

  it("deletes the brand's files, rows and sole logins after the date, and nothing else", async () => {
    Object.assign(db.accounts[0], { offboarded_at: '2026-09-01T00:00:00Z', purge_after: '2026-10-01T00:00:00Z' });

    const result = await purgeBrand(service() as never, BRAND, NOW);

    expect(result).toEqual({ filesDeleted: 5, loginsDeleted: 1, loginsNotDeleted: [] });
    // Clicks and page views have no foreign key to the brand; only this brand's go.
    expect(db.link_in_bio_clicks.map((r) => r.id)).toEqual(['click-x']);
    expect(db.link_in_bio_page_views.map((r) => r.id)).toEqual(['view-x']);
    expect(storage).toEqual(new Set(['banners/post-x/feed.jpg', `${OTHER}/m9/b.jpg`]));
    expect(db.accounts.map((r) => r.id)).toEqual([OTHER]);
    expect(db.content_items.map((r) => r.id)).toEqual(['post-x']);
    // Only the login that belonged solely to this brand; not the operator, not someone in another brand.
    expect(deletedUsers).toEqual(['only-here']);
    expect(db.ad_sets).toEqual([]);
    expect(db.campaigns).toEqual([]);
  });

  it('finds every post banner for a brand with more than 1,000 posts', async () => {
    Object.assign(db.accounts[0], { offboarded_at: '2026-09-01T00:00:00Z', purge_after: '2026-10-01T00:00:00Z' });
    for (let i = 0; i < 1500; i++) {
      const id = `bulk-post-${String(i).padStart(4, '0')}`;
      db.content_items.push({ id, account_id: BRAND, status: 'posted' });
      storage.add(`banners/${id}/feed.jpg`);
    }

    const result = await purgeBrand(service() as never, BRAND, NOW);

    expect((result as { filesDeleted: number }).filesDeleted).toBe(1505);
    expect([...storage].filter((p) => p.startsWith('banners/bulk-post-'))).toEqual([]);
    expect(storage.has('banners/post-x/feed.jpg')).toBe(true);
  });

  it('reads every page of the brand folder', async () => {
    Object.assign(db.accounts[0], { offboarded_at: '2026-09-01T00:00:00Z', purge_after: '2026-10-01T00:00:00Z' });
    for (let i = 0; i < 1005; i++) storage.add(`${BRAND}/bulk-${i}/f.jpg`);

    const result = await purgeBrand(service() as never, BRAND, NOW);

    expect((result as { filesDeleted: number }).filesDeleted).toBe(1010);
    expect([...storage].filter((p) => p.startsWith(`${BRAND}/`))).toEqual([]);
  });

  it('finishes the purge and reports a login it could not delete', async () => {
    Object.assign(db.accounts[0], { offboarded_at: '2026-09-01T00:00:00Z', purge_after: '2026-10-01T00:00:00Z' });
    failDeleteUser = 'only-here';

    const result = await purgeBrand(service() as never, BRAND, NOW);

    expect(result).toEqual({
      filesDeleted: 5,
      loginsDeleted: 0,
      loginsNotDeleted: [{ userId: 'only-here', reason: 'Database error deleting user' }],
    });
    expect(db.accounts.map((r) => r.id)).toEqual([OTHER]);
  });
});
