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

interface Call {
  table: string;
  op: string;
  payload?: Row;
  options?: Row;
  filters: Array<[string, unknown]>;
}

/**
 * A recording fake: every from() call is logged with its operation, payload and
 * filters. Only meta_ad_account_tokens is expected; any other table is a failure,
 * which proves the plaintext columns on meta_ad_accounts are never touched.
 */
function buildFakeSupabase(result: { data?: Row[] | null; error?: { message: string; code?: string } | null } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      if (table !== 'meta_ad_account_tokens') throw new Error(`unexpected table ${table}`);
      const call: Call = { table, op: '', filters: [] };
      calls.push(call);
      const builder = {
        select: () => ((call.op = 'select'), builder),
        delete: () => ((call.op = 'delete'), builder),
        upsert: (payload: Row, options: Row) => ((call.op = 'upsert'), (call.payload = payload), (call.options = options), builder),
        eq: (column: string, value: unknown) => (call.filters.push([column, value]), builder),
        in: (column: string, values: unknown) => (call.filters.push([column, values]), builder),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: result.error ? null : result.data ?? [], error: result.error ?? null }),
      };
      return builder;
    },
  };
  return { client: client as never, calls };
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

beforeEach(() => {
  vi.stubEnv('TOKEN_VAULT_KEY', KEY.toString('hex'));
  vi.stubEnv('TOKEN_VAULT_KEY_VERSION', '1');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getMetaAdAccountTokens', () => {
  it('returns both decrypted tokens, scoped to the brand', async () => {
    const { client, calls } = buildFakeSupabase({
      data: [vaultRow('access', 'vault-access'), vaultRow('conversions_api', ' vault-capi ')],
    });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: 'vault-access',
      conversionsApiToken: 'vault-capi',
    });
    expect(calls).toEqual([{ table: 'meta_ad_account_tokens', op: 'select', filters: [['account_id', ACCOUNT_ID]] }]);
  });

  it('returns null for a token type that is not stored', async () => {
    const { client } = buildFakeSupabase({ data: [vaultRow('access', 'vault-access')] });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: 'vault-access',
      conversionsApiToken: null,
    });
  });

  it('returns nulls for a brand with nothing stored', async () => {
    const { client } = buildFakeSupabase({ data: [] });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).resolves.toEqual({
      accessToken: null,
      conversionsApiToken: null,
    });
  });

  it('throws when a stored token cannot be decrypted', async () => {
    const { client } = buildFakeSupabase({ data: [vaultRow('access', 'vault-access', crypto.randomBytes(32))] });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).rejects.toBeInstanceOf(MetaAdTokenDecryptError);
  });

  it('throws on a read error, including a missing table', async () => {
    const { client } = buildFakeSupabase({ error: { message: 'relation does not exist', code: 'PGRST205' } });

    await expect(getMetaAdAccountTokens(client, ACCOUNT_ID)).rejects.toThrow('Failed to load Meta Ads tokens: relation does not exist');
  });
});

describe('storeMetaAdAccountToken', () => {
  it('stores the token encrypted, replacing any earlier one, and writes nothing else', async () => {
    const { client, calls } = buildFakeSupabase();

    await storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', ' new-access-token ');

    expect(calls).toHaveLength(1);
    const { op, payload, options } = calls[0];
    expect(op).toBe('upsert');
    expect(options).toEqual({ onConflict: 'account_id,token_type' });
    expect(payload).toMatchObject({ account_id: ACCOUNT_ID, token_type: 'access', key_version: 1 });
    expect(JSON.stringify(payload)).not.toContain('new-access-token');
    expect(decryptRow(payload as Row)).toBe('new-access-token');
  });

  it('stores the CAPI token under its own type', async () => {
    const { client, calls } = buildFakeSupabase();

    await storeMetaAdAccountToken(client, ACCOUNT_ID, 'conversions_api', 'capi-token-1234567890');

    expect(calls[0].payload).toMatchObject({ token_type: 'conversions_api' });
    expect(decryptRow(calls[0].payload as Row)).toBe('capi-token-1234567890');
  });

  it('throws when the write fails', async () => {
    const { client } = buildFakeSupabase({ error: { message: 'fk violation' } });

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', 'token')).rejects.toThrow(
      'Failed to store Meta Ads token: fk violation',
    );
  });

  it('refuses an empty token', async () => {
    const { client, calls } = buildFakeSupabase();

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', '   ')).rejects.toThrow('empty');
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the vault key is missing', async () => {
    vi.stubEnv('TOKEN_VAULT_KEY', '');
    const { client, calls } = buildFakeSupabase();

    await expect(storeMetaAdAccountToken(client, ACCOUNT_ID, 'access', 'token')).rejects.toThrow('TOKEN_VAULT_KEY');
    expect(calls).toHaveLength(0);
  });
});

describe('deleteMetaAdAccountTokens', () => {
  it('deletes the given token types for the given brands', async () => {
    const { client, calls } = buildFakeSupabase();

    await deleteMetaAdAccountTokens(client, ['a1', 'a2'], ['access', 'conversions_api']);

    expect(calls).toEqual([
      {
        table: 'meta_ad_account_tokens',
        op: 'delete',
        filters: [['account_id', ['a1', 'a2']], ['token_type', ['access', 'conversions_api']]],
      },
    ]);
  });

  it('does nothing for an empty brand list', async () => {
    const { client, calls } = buildFakeSupabase();

    await deleteMetaAdAccountTokens(client, [], ['access']);

    expect(calls).toHaveLength(0);
  });

  it('throws when the delete fails', async () => {
    const { client } = buildFakeSupabase({ error: { message: 'db down' } });

    await expect(deleteMetaAdAccountTokens(client, ['a1'], ['access'])).rejects.toThrow('Failed to delete Meta Ads tokens: db down');
  });
});
