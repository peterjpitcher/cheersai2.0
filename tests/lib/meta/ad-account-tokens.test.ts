import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteMetaAdAccountTokens,
  getMetaAdAccountTokens,
  MetaAdTokenDecryptError,
  storeMetaAdAccountToken,
} from '@/lib/meta/ad-account-tokens';
import { decryptPayload, encryptPayload } from '@/lib/token-vault';

const ACCOUNT_ID = 'account-1';
const KEY = crypto.randomBytes(32);

type Row = Record<string, unknown>;

interface FakeState {
  vaultRows: Row[];
  vaultError: { message: string; code?: string } | null;
  plaintext: { access_token: string | null; conversions_api_access_token: string | null } | null;
  upsertError: { message: string } | null;
  upserts: Array<{ row: Row; options: Row }>;
  updates: Array<{ payload: Row; column: string; value: unknown }>;
  vaultFilters: Array<[string, unknown]>;
  plaintextReads: number;
}

function buildFakeSupabase(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    vaultRows: [],
    vaultError: null,
    plaintext: null,
    upsertError: null,
    upserts: [],
    updates: [],
    vaultFilters: [],
    plaintextReads: 0,
    ...overrides,
  };

  const client = {
    from(table: string) {
      if (table === 'meta_ad_account_tokens') {
        return {
          select: () => ({
            eq: async (column: string, value: unknown) => {
              state.vaultFilters.push([column, value]);
              return { data: state.vaultError ? null : state.vaultRows, error: state.vaultError };
            },
          }),
          upsert: async (row: Row, options: Row) => {
            state.upserts.push({ row, options });
            return { error: state.upsertError };
          },
        };
      }
      if (table === 'meta_ad_accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                state.plaintextReads += 1;
                return { data: state.plaintext, error: null };
              },
            }),
          }),
          update: (payload: Row) => ({
            eq: async (column: string, value: unknown) => {
              state.updates.push({ payload, column, value });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client: client as never, state };
}

function vaultRow(tokenType: 'access' | 'conversions_api', plaintext: string, key: Buffer = KEY): Row {
  const encrypted = encryptPayload(plaintext, key, 1);
  return {
    token_type: tokenType,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    key_version: encrypted.keyVersion,
  };
}

function decryptRow(row: Row): string {
  return decryptPayload(
    { ciphertext: row.ciphertext as string, iv: row.iv as string, tag: row.tag as string, keyVersion: row.key_version as number },
    KEY,
  );
}

describe('getMetaAdAccountTokens', () => {
  beforeEach(() => {
    vi.stubEnv('TOKEN_VAULT_KEY', KEY.toString('hex'));
    vi.stubEnv('TOKEN_VAULT_KEY_VERSION', '1');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns decrypted tokens from the vault, scoped to the brand, without touching plaintext', async () => {
    const { client, state } = buildFakeSupabase({
      vaultRows: [vaultRow('access', 'vault-access'), vaultRow('conversions_api', 'vault-capi')],
      plaintext: { access_token: 'old-plain', conversions_api_access_token: 'old-capi' },
    });

    const tokens = await getMetaAdAccountTokens(client, ACCOUNT_ID);

    expect(tokens).toEqual({ accessToken: 'vault-access', conversionsApiToken: 'vault-capi' });
    expect(state.vaultFilters).toEqual([['account_id', ACCOUNT_ID]]);
    expect(state.plaintextReads).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });

  it('falls back to plaintext and copies it into the vault encrypted, never overwriting', async () => {
    const { client, state } = buildFakeSupabase({
      plaintext: { access_token: ' plain-access ', conversions_api_access_token: 'plain-capi' },
    });

    const tokens = await getMetaAdAccountTokens(client, ACCOUNT_ID);

    expect(tokens).toEqual({ accessToken: 'plain-access', conversionsApiToken: 'plain-capi' });
    expect(state.upserts).toHaveLength(2);
    for (const { row, options } of state.upserts) {
      expect(row.account_id).toBe(ACCOUNT_ID);
      expect(JSON.stringify(row)).not.toContain('plain-');
      expect(options).toEqual({ onConflict: 'account_id,token_type', ignoreDuplicates: true });
    }
    expect(decryptRow(state.upserts[0].row)).toBe('plain-access');
    expect(state.upserts[0].row.token_type).toBe('access');
    expect(decryptRow(state.upserts[1].row)).toBe('plain-capi');
    expect(state.upserts[1].row.token_type).toBe('conversions_api');
    // Reads never blank the plaintext column; phase 2 does that once the vault is verified.
    expect(state.updates).toHaveLength(0);
  });

  it('mixes sources per token type during the transition', async () => {
    const { client, state } = buildFakeSupabase({
      vaultRows: [vaultRow('access', 'vault-access')],
      plaintext: { access_token: 'stale-plain-access', conversions_api_access_token: 'plain-capi' },
    });

    const tokens = await getMetaAdAccountTokens(client, ACCOUNT_ID);

    expect(tokens).toEqual({ accessToken: 'vault-access', conversionsApiToken: 'plain-capi' });
    expect(state.upserts.map((u) => u.row.token_type)).toEqual(['conversions_api']);
  });

  it('does not copy plaintext when copyPlaintext is false (local ops scripts)', async () => {
    const { client, state } = buildFakeSupabase({
      plaintext: { access_token: 'plain-access', conversions_api_access_token: null },
    });

    const tokens = await getMetaAdAccountTokens(client, ACCOUNT_ID, { copyPlaintext: false });

    expect(tokens).toEqual({ accessToken: 'plain-access', conversionsApiToken: null });
    expect(state.upserts).toHaveLength(0);
  });

  it('still returns the plaintext token when the lazy copy fails', async () => {
    const { client } = buildFakeSupabase({
      plaintext: { access_token: 'plain-access', conversions_api_access_token: null },
      upsertError: { message: 'insert failed' },
    });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: 'plain-access',
      conversionsApiToken: null,
    });
  });

  it('returns nulls for a brand with no tokens anywhere, including blank plaintext', async () => {
    const { client } = buildFakeSupabase({
      plaintext: { access_token: '', conversions_api_access_token: '   ' },
    });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: null,
      conversionsApiToken: null,
    });
  });

  it('throws when a vault token cannot be decrypted, and does not fall back to plaintext', async () => {
    const { client, state } = buildFakeSupabase({
      vaultRows: [vaultRow('access', 'vault-access', crypto.randomBytes(32))],
      plaintext: { access_token: 'plain-access', conversions_api_access_token: null },
    });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).rejects.toBeInstanceOf(MetaAdTokenDecryptError);
    expect(state.plaintextReads).toBe(0);
  });

  it('throws on a vault read error', async () => {
    const { client } = buildFakeSupabase({ vaultError: { message: 'connection reset' } });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).rejects.toThrow('Failed to load Meta Ads tokens: connection reset');
  });

  it('reads plaintext when the vault table does not exist yet (code ahead of migration)', async () => {
    const { client } = buildFakeSupabase({
      vaultError: { message: 'relation does not exist', code: 'PGRST205' },
      plaintext: { access_token: 'plain-access', conversions_api_access_token: null },
    });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: 'plain-access',
      conversionsApiToken: null,
    });
  });
});

describe('storeMetaAdAccountToken', () => {
  beforeEach(() => {
    vi.stubEnv('TOKEN_VAULT_KEY', KEY.toString('hex'));
    vi.stubEnv('TOKEN_VAULT_KEY_VERSION', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stores the access token encrypted, replacing any earlier one, then blanks the plaintext column', async () => {
    const { client, state } = buildFakeSupabase();

    await storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', ' new-access-token ');

    expect(state.upserts).toHaveLength(1);
    const { row, options } = state.upserts[0];
    expect(options).toEqual({ onConflict: 'account_id,token_type' });
    expect(row).toMatchObject({ account_id: ACCOUNT_ID, token_type: 'access', key_version: 1 });
    expect(JSON.stringify(row)).not.toContain('new-access-token');
    expect(decryptRow(row)).toBe('new-access-token');
    expect(state.updates).toEqual([{ payload: { access_token: '' }, column: 'account_id', value: ACCOUNT_ID }]);
  });

  it('blanks the CAPI plaintext column to null', async () => {
    const { client, state } = buildFakeSupabase();

    await storeMetaAdAccountToken(client, ACCOUNT_ID, 'conversions_api', 'capi-token-1234567890');

    expect(decryptRow(state.upserts[0].row)).toBe('capi-token-1234567890');
    expect(state.updates).toEqual([
      { payload: { conversions_api_access_token: null }, column: 'account_id', value: ACCOUNT_ID },
    ]);
  });

  it('throws and leaves the plaintext column alone when the encrypted write fails', async () => {
    const { client, state } = buildFakeSupabase({ upsertError: { message: 'fk violation' } });

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', 'token')).rejects.toThrow(
      'Failed to store Meta Ads token: fk violation',
    );
    expect(state.updates).toHaveLength(0);
  });

  it('refuses an empty token', async () => {
    const { client, state } = buildFakeSupabase();

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', '   ')).rejects.toThrow('empty');
    expect(state.upserts).toHaveLength(0);
  });

  it('fails closed when the vault key is missing', async () => {
    vi.stubEnv('TOKEN_VAULT_KEY', '');
    const { client, state } = buildFakeSupabase();

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', 'token')).rejects.toThrow('TOKEN_VAULT_KEY');
    expect(state.upserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe('deleteMetaAdAccountTokens', () => {
  function buildDeleteFake(errors: { delete?: { message: string; code?: string }; update?: { message: string } } = {}) {
    const calls: Array<{ table: string; op: string; payload?: Row; filters: Array<[string, unknown]> }> = [];
    const client = {
      from(table: string) {
        const call: { table: string; op: string; payload?: Row; filters: Array<[string, unknown]> } = { table, op: '', filters: [] };
        calls.push(call);
        const builder = {
          delete: () => ((call.op = 'delete'), builder),
          update: (payload: Row) => ((call.op = 'update'), (call.payload = payload), builder),
          in: (column: string, values: unknown) => (call.filters.push([column, values]), builder),
          then: (resolve: (value: unknown) => unknown) =>
            resolve({ error: call.op === 'delete' ? errors.delete ?? null : errors.update ?? null }),
        };
        return builder;
      },
    };
    return { client: client as never, calls };
  }

  it('deletes the encrypted rows for the given brands and types, then blanks the plaintext', async () => {
    const { client, calls } = buildDeleteFake();

    await deleteMetaAdAccountTokens(client, ['a1', 'a2'], ['access', 'conversions_api']);

    expect(calls).toEqual([
      {
        table: 'meta_ad_account_tokens',
        op: 'delete',
        filters: [['account_id', ['a1', 'a2']], ['token_type', ['access', 'conversions_api']]],
      },
      {
        table: 'meta_ad_accounts',
        op: 'update',
        payload: { access_token: '', conversions_api_access_token: null },
        filters: [['account_id', ['a1', 'a2']]],
      },
    ]);
  });

  it('does nothing for an empty brand list', async () => {
    const { client, calls } = buildDeleteFake();

    await deleteMetaAdAccountTokens(client, [], ['access']);

    expect(calls).toHaveLength(0);
  });

  it('throws when the encrypted rows cannot be deleted, before touching plaintext', async () => {
    const { client, calls } = buildDeleteFake({ delete: { message: 'db down' } });

    await expect(deleteMetaAdAccountTokens(client, ['a1'], ['access'])).rejects.toThrow('Failed to delete Meta Ads tokens: db down');
    expect(calls).toHaveLength(1);
  });

  it('throws when the plaintext cannot be cleared', async () => {
    const { client } = buildDeleteFake({ update: { message: 'db down' } });

    await expect(deleteMetaAdAccountTokens(client, ['a1'], ['access'])).rejects.toThrow('Failed to clear plaintext Meta Ads tokens: db down');
  });
});
