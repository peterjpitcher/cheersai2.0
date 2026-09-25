import crypto from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Meta data-deletion and deauthorise callbacks (spec §4.8, M2) against an
 * in-memory database: verification, matching by app-scoped user id, token
 * deletion, the recorded outcome, and an honest status page.
 */

const APP_SECRET = 'test-app-secret';

vi.mock('@/env', () => ({
  env: {
    server: { FACEBOOK_APP_SECRET: APP_SECRET, OPERATOR_ALERT_EMAIL: 'ops@test.example' },
    client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk' },
  },
}));
const mockSendEmail = vi.fn();
vi.mock('@/lib/email/resend', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }));
vi.mock('@/lib/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

// ---- in-memory tables -------------------------------------------------------
type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let failTable: string | null = null;

function query(table: string) {
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  let patch: Row = {};
  const preds: Array<(row: Row) => boolean> = [];
  let order: { column: string; ascending: boolean } | null = null;
  let limitN: number | null = null;

  const matches = () => (db[table] ?? []).filter((row) => preds.every((p) => p(row)));
  const run = () => {
    if (failTable === table) return { data: null, error: { message: `${table} down` } };
    if (op === 'update') {
      const rows = matches();
      rows.forEach((row) => Object.assign(row, patch));
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    if (op === 'delete') {
      const keep = (db[table] ?? []).filter((row) => !preds.every((p) => p(row)));
      db[table] = keep;
      return { data: null, error: null };
    }
    let rows = matches();
    if (order) {
      const { column, ascending } = order;
      rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (limitN !== null) rows = rows.slice(0, limitN);
    return { data: rows, error: null };
  };

  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Row) => {
      op = 'update';
      patch = p;
      return q;
    },
    delete: () => {
      op = 'delete';
      return q;
    },
    insert: async (row: Row) => {
      if (failTable === table) return { error: { message: `${table} down` } };
      (db[table] ??= []).push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row });
      return { error: null };
    },
    eq: (c: string, v: unknown) => {
      preds.push((row) => row[c] === v);
      return q;
    },
    in: (c: string, vs: unknown[]) => {
      preds.push((row) => vs.includes(row[c]));
      return q;
    },
    lte: (c: string, v: string) => {
      preds.push((row) => typeof row[c] === 'string' && (row[c] as string) <= v);
      return q;
    },
    order: (column: string, opts: { ascending: boolean }) => {
      order = { column, ascending: opts.ascending };
      return q;
    },
    limit: (n: number) => {
      limitN = n;
      return q;
    },
    maybeSingle: async () => {
      const result = run();
      return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
    },
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({ from: (t: string) => query(t) }) }));

const deletion = await import('@/app/api/social/delete-data/route');
const deauthorise = await import('@/app/api/social/deauthorize/route');

// ---- helpers ----------------------------------------------------------------
function signedRequest(payload: Record<string, unknown>, secret = APP_SECRET): string {
  const encoded = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${signature}.${encoded}`;
}

function post(route: { POST: (r: Request) => Promise<Response> }, signed: string) {
  const body = new URLSearchParams({ signed_request: signed });
  return route.POST(
    new Request('https://cheers.orangejelly.co.uk/api/social/x', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
}

const PERSON = 'meta-person-1';
const ISSUED = Math.floor(new Date('2026-09-25T12:00:00Z').getTime() / 1000);

beforeEach(() => {
  failTable = null;
  mockSendEmail.mockReset().mockResolvedValue(undefined);
  db = {
    social_connections: [
      { id: 'conn-fb', account_id: 'brand-1', meta_user_id: PERSON, status: 'active', access_token: 'plain', refresh_token: null, token_expires_at: '2026-12-01T00:00:00Z', last_synced_at: '2026-09-01T00:00:00Z' },
      { id: 'conn-ig', account_id: 'brand-1', meta_user_id: PERSON, status: 'active', access_token: null, refresh_token: null, token_expires_at: null, last_synced_at: '2026-09-26T00:00:00Z' },
      { id: 'conn-other', account_id: 'brand-2', meta_user_id: 'someone-else', status: 'active', access_token: 'keep', last_synced_at: '2026-09-01T00:00:00Z' },
    ],
    token_vault: [
      { id: 'v1', social_connection_id: 'conn-fb' },
      { id: 'v2', social_connection_id: 'conn-ig' },
      { id: 'v3', social_connection_id: 'conn-other' },
    ],
    meta_ad_accounts: [
      { id: 'ads-1', account_id: 'brand-1', meta_user_id: PERSON, access_token: 'ads-plain', conversions_api_access_token: 'capi', setup_complete: true },
      { id: 'ads-2', account_id: 'brand-2', meta_user_id: 'someone-else', access_token: 'keep', setup_complete: true },
    ],
    meta_ad_account_tokens: [
      { id: 'tok-access', account_id: 'brand-1', token_type: 'access' },
      { id: 'tok-capi', account_id: 'brand-1', token_type: 'conversions_api' },
      { id: 'tok-other', account_id: 'brand-2', token_type: 'access' },
    ],
    meta_data_requests: [],
  };
});

describe('data deletion callback', () => {
  it('rejects a forged request', async () => {
    const response = await post(deletion, signedRequest({ user_id: PERSON }, 'wrong-secret'));
    expect(response.status).toBe(400);
    expect(db.meta_data_requests).toHaveLength(0);
  });

  it("deletes the person's tokens everywhere, records it, and reports it honestly", async () => {
    const response = await post(deletion, signedRequest({ user_id: PERSON, issued_at: ISSUED }));
    const body = (await response.json()) as { url: string; confirmation_code: string };

    expect(response.status).toBe(200);
    expect(body.url).toBe(`https://cheers.orangejelly.co.uk/api/social/delete-data?code=${body.confirmation_code}`);

    // Both of this person's connections revoked (deletion ignores timing); the other brand's untouched.
    for (const id of ['conn-fb', 'conn-ig']) {
      const row = db.social_connections.find((r) => r.id === id)!;
      expect(row).toMatchObject({ status: 'needs_action', access_token: null, meta_user_id: null });
    }
    expect(db.social_connections.find((r) => r.id === 'conn-other')).toMatchObject({ status: 'active', access_token: 'keep' });
    expect(db.token_vault.map((r) => r.id)).toEqual(['v3']);
    expect(db.meta_ad_accounts[0]).toMatchObject({ access_token: '', setup_complete: false, meta_user_id: null });
    // The person's encrypted ads token is deleted; the brand's CAPI token and other brands' tokens stay.
    expect(db.meta_ad_account_tokens.map((r) => r.id)).toEqual(['tok-capi', 'tok-other']);
    expect(db.meta_ad_accounts[0].conversions_api_access_token).toBe('capi');
    expect(db.meta_ad_accounts[1]).toMatchObject({ access_token: 'keep', setup_complete: true });
    expect(db.meta_data_requests[0]).toMatchObject({ kind: 'deletion', status: 'completed', connections_revoked: 2, ad_accounts_revoked: 1 });
    // The Meta user id is never stored in the request log.
    expect(JSON.stringify(db.meta_data_requests)).not.toContain(PERSON);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@test.example' }));

    const status = await deletion.GET(new Request(body.url));
    const statusBody = (await status.json()) as { status: string; completed: boolean; detail: string };
    expect(status.status).toBe(200);
    expect(statusBody).toMatchObject({ status: 'completed', completed: true });
    expect(statusBody.detail).toMatch(/tokens we held for it have been deleted/);
  });

  it('records no_match when nothing is linked to the person, and says so', async () => {
    const response = await post(deletion, signedRequest({ user_id: 'unknown-person' }));
    const { url } = (await response.json()) as { url: string };
    expect(db.meta_data_requests[0]).toMatchObject({ status: 'no_match', connections_revoked: 0 });
    const statusBody = (await (await deletion.GET(new Request(url))).json()) as { status: string; detail: string };
    expect(statusBody.status).toBe('no_match');
    expect(statusBody.detail).toMatch(/found no connection/);
  });

  it('fails visibly (500, recorded, operator emailed) when revoking fails', async () => {
    failTable = 'token_vault';
    const response = await post(deletion, signedRequest({ user_id: PERSON }));
    expect(response.status).toBe(500);
    expect(db.meta_data_requests[0]).toMatchObject({ status: 'failed' });
    expect(mockSendEmail.mock.calls[0][0].subject).toMatch(/FAILED/);
  });

  it('never claims completion for an unknown code', async () => {
    const status = await deletion.GET(new Request('https://cheers.orangejelly.co.uk/api/social/delete-data?code=made-up'));
    expect(status.status).toBe(404);
    expect(((await status.json()) as { status: string }).status).toBe('not_found');
  });
});

describe('deauthorise callback', () => {
  it('revokes connections made before the request but leaves a newer reconnection alone', async () => {
    const response = await post(deauthorise, signedRequest({ user_id: PERSON, issued_at: ISSUED }));
    expect(response.status).toBe(200);

    expect(db.social_connections.find((r) => r.id === 'conn-fb')).toMatchObject({ status: 'needs_action', access_token: null });
    // conn-ig was (re)connected after Meta issued the request: untouched.
    expect(db.social_connections.find((r) => r.id === 'conn-ig')).toMatchObject({ status: 'active', meta_user_id: PERSON });
    expect(db.token_vault.map((r) => r.id).sort()).toEqual(['v2', 'v3']);
    expect(db.meta_data_requests[0]).toMatchObject({ kind: 'deauthorise', status: 'completed', connections_revoked: 1 });
  });

  it('rejects a forged request', async () => {
    const response = await post(deauthorise, signedRequest({ user_id: PERSON }, 'wrong-secret'));
    expect(response.status).toBe(400);
    expect(db.social_connections.find((r) => r.id === 'conn-fb')).toMatchObject({ status: 'active' });
  });
});
