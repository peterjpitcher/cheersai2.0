import { beforeEach, describe, expect, it } from 'vitest';

import { exportBrandData, offboardBrand, purgeBrand } from '@/lib/admin/offboarding';

type Row = Record<string, unknown>;

const BRAND = 'b0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';

let db: Record<string, Row[]>;
let storage: Set<string>;
const deletedUsers: string[] = [];

function query(table: string) {
  let op: 'select' | 'update' | 'delete' = 'select';
  let patch: Row = {};
  let head = false;
  const preds: Array<(r: Row) => boolean> = [];
  const matches = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const run = () => {
    if (op === 'update') {
      const rows = matches();
      rows.forEach((r) => Object.assign(r, patch));
      return { data: rows, error: null };
    }
    if (op === 'delete') {
      db[table] = (db[table] ?? []).filter((r) => !preds.every((p) => p(r)));
      // Cascade: deleting a brand removes every row that points at it.
      if (table === 'accounts') for (const t of Object.keys(db)) if (t !== 'accounts') db[t] = db[t].filter((r) => r.account_id !== BRAND || t === 'app_admins');
      return { data: null, error: null };
    }
    const rows = matches();
    return head ? { count: rows.length, error: null } : { data: rows, error: null };
  };
  const q: Record<string, unknown> = {
    select: (_c?: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head);
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
        list: async (prefix: string) => {
          const children = new Map<string, boolean>();
          for (const path of storage) {
            if (!path.startsWith(`${prefix}/`)) continue;
            const rest = path.slice(prefix.length + 1);
            const [first, ...more] = rest.split('/');
            children.set(first, more.length === 0 || children.get(first) === true);
          }
          return { data: [...children].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })), error: null };
        },
        remove: async (paths: string[]) => {
          paths.forEach((p) => storage.delete(p));
          return { data: [], error: null };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null }),
      }),
    },
    auth: { admin: { deleteUser: async (id: string) => (deletedUsers.push(id), { error: null }) } },
  };
}

beforeEach(() => {
  deletedUsers.length = 0;
  db = {
    accounts: [
      { id: BRAND, business_name: 'The New Venue', email: 'o@v.test', timezone: 'Europe/London', created_at: '2026-01-01', offboarded_at: null, purge_after: null, archived_at: null },
      { id: OTHER, business_name: 'Other', offboarded_at: null },
    ],
    subscriptions: [],
    meta_campaigns: [{ id: 'c1', account_id: BRAND, status: 'PAUSED' }],
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
    link_in_bio_profiles: [],
    link_in_bio_tiles: [],
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

  it('refuses while a paid campaign is live', async () => {
    db.meta_campaigns[0].status = 'ACTIVE';
    expect((await offboardBrand(service() as never, BRAND, NOW) as { error: string }).error).toMatch(/Pause the brand's live Meta ad campaigns/);
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
    expect(db.accounts[0]).toMatchObject({ archived_at: NOW.toISOString(), offboarded_at: NOW.toISOString() });

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

    expect(result).toEqual({ filesDeleted: 5, loginsDeleted: 1 });
    expect(storage).toEqual(new Set(['banners/post-x/feed.jpg', `${OTHER}/m9/b.jpg`]));
    expect(db.accounts.map((r) => r.id)).toEqual([OTHER]);
    expect(db.content_items.map((r) => r.id)).toEqual(['post-x']);
    // Only the login that belonged solely to this brand; not the operator, not someone in another brand.
    expect(deletedUsers).toEqual(['only-here']);
  });
});
