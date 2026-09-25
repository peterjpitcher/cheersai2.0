/**
 * Encrypted storage for the paid-ads Meta tokens (tasks/SPEC-encrypt-meta-ad-tokens.md).
 *
 * Every reader and writer of a brand's Meta Ads access token or Conversions API
 * token goes through this module. Tokens live encrypted (token-vault, AES-256-GCM)
 * in `meta_ad_account_tokens`, one row per brand and token type.
 *
 * Phase 1 transition: `meta_ad_accounts.access_token` and
 * `conversions_api_access_token` may still hold plaintext for brands connected
 * before this change. Reads prefer the encrypted row and fall back to the
 * plaintext column, copying it into the vault on the way (lazy migration).
 * Writes store the encrypted row and then blank the plaintext column. Phase 2
 * clears the columns in a migration and deletes the fallback below.
 *
 * All queries use the caller's service-role client and are scoped by account_id.
 */
import { createLogger } from '@/lib/logging';
import type { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isSchemaMissingError } from '@/lib/supabase/errors';
import { decrypt, encrypt } from '@/lib/token-vault';

type SupabaseClientLike = ReturnType<typeof createServiceSupabaseClient>;

export type MetaAdTokenType = 'access' | 'conversions_api';

export interface MetaAdAccountTokens {
  accessToken: string | null;
  conversionsApiToken: string | null;
}

interface TokenRow {
  token_type: MetaAdTokenType;
  ciphertext: string;
  iv: string;
  tag: string;
  key_version: number;
}

interface PlaintextRow {
  access_token: string | null;
  conversions_api_access_token: string | null;
}

const TOKEN_TABLE = 'meta_ad_account_tokens';

/** Phase 1 only: the legacy plaintext column for each token type, and its blank value. */
const PLAINTEXT_COLUMN = {
  access: { column: 'access_token', cleared: '' },
  conversions_api: { column: 'conversions_api_access_token', cleared: null },
} as const satisfies Record<MetaAdTokenType, { column: keyof PlaintextRow; cleared: string | null }>;

const logger = createLogger('meta-ad-tokens');

export class MetaAdTokenDecryptError extends Error {
  constructor(tokenType: MetaAdTokenType) {
    super(`The stored Meta Ads ${tokenType === 'access' ? 'access' : 'Conversions API'} token could not be decrypted. Reconnect Meta Ads in Connections.`);
    this.name = 'MetaAdTokenDecryptError';
  }
}

/**
 * Load and decrypt both Meta tokens for a brand. A token that is not stored comes
 * back as null. Throws on a database error or a token that cannot be decrypted,
 * so callers fail visibly rather than acting as if the brand were disconnected.
 *
 * `copyPlaintext: false` turns off the lazy migration. Local ops scripts must pass
 * it: a local TOKEN_VAULT_KEY that differs from production's would otherwise write
 * a row production cannot decrypt.
 */
export async function getMetaAdAccountTokens(
  supabase: SupabaseClientLike,
  accountId: string,
  options: { copyPlaintext?: boolean } = {},
): Promise<MetaAdAccountTokens> {
  const copyPlaintext = options.copyPlaintext ?? true;
  const vault = await readVaultTokens(supabase, accountId);
  let accessToken = vault.get('access') ?? null;
  let conversionsApiToken = vault.get('conversions_api') ?? null;

  if (accessToken === null || conversionsApiToken === null) {
    const plaintext = await readPlaintextTokens(supabase, accountId);
    if (accessToken === null && plaintext.access) {
      accessToken = plaintext.access;
      if (copyPlaintext) await copyPlaintextToVault(supabase, accountId, 'access', plaintext.access);
    }
    if (conversionsApiToken === null && plaintext.conversions_api) {
      conversionsApiToken = plaintext.conversions_api;
      if (copyPlaintext) await copyPlaintextToVault(supabase, accountId, 'conversions_api', plaintext.conversions_api);
    }
  }

  return { accessToken, conversionsApiToken };
}

/**
 * Encrypt and store a token for a brand, replacing any earlier one, then blank the
 * legacy plaintext column. The `meta_ad_accounts` row must already exist (the
 * token row references it). Throws if the encrypted write fails.
 */
export async function storeMetaAdAccountToken(
  supabase: SupabaseClientLike,
  accountId: string,
  tokenType: MetaAdTokenType,
  plaintext: string,
): Promise<void> {
  const token = plaintext.trim();
  if (!token) throw new Error('Refusing to store an empty Meta Ads token.');

  const { error } = await supabase
    .from(TOKEN_TABLE)
    .upsert(buildTokenRow(accountId, tokenType, token), { onConflict: 'account_id,token_type' });
  if (error) throw new Error(`Failed to store Meta Ads token: ${error.message}`);

  // The encrypted row now wins on every read, so a failed blank only leaves a
  // stale copy behind (phase 2 clears it); log it rather than fail the write.
  const { column, cleared } = PLAINTEXT_COLUMN[tokenType];
  const { error: clearError } = await supabase
    .from('meta_ad_accounts')
    .update({ [column]: cleared })
    .eq('account_id', accountId);
  if (clearError) {
    logger.warn('could not blank plaintext Meta Ads token column', { accountId, tokenType, reason: clearError.message });
  }
}

async function readVaultTokens(
  supabase: SupabaseClientLike,
  accountId: string,
): Promise<Map<MetaAdTokenType, string>> {
  const tokens = new Map<MetaAdTokenType, string>();
  const { data, error } = await supabase
    .from(TOKEN_TABLE)
    .select('token_type, ciphertext, iv, tag, key_version')
    .eq('account_id', accountId);

  if (error) {
    // Code deployed ahead of the migration: fall back to the plaintext columns.
    if (isSchemaMissingError(error)) {
      logger.error('meta_ad_account_tokens table is missing; reading plaintext tokens', undefined, { accountId });
      return tokens;
    }
    throw new Error(`Failed to load Meta Ads tokens: ${error.message}`);
  }

  for (const row of (data ?? []) as TokenRow[]) {
    let value: string;
    try {
      value = decrypt({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version });
    } catch (decryptError) {
      logger.error(
        'Meta Ads token could not be decrypted',
        decryptError instanceof Error ? decryptError : undefined,
        { accountId, tokenType: row.token_type, keyVersion: row.key_version },
      );
      throw new MetaAdTokenDecryptError(row.token_type);
    }
    const trimmed = value.trim();
    if (trimmed) tokens.set(row.token_type, trimmed);
  }
  return tokens;
}

// Phase 1 only: remove with the plaintext columns in phase 2.
async function readPlaintextTokens(
  supabase: SupabaseClientLike,
  accountId: string,
): Promise<Record<MetaAdTokenType, string | null>> {
  const { data, error } = await supabase
    .from('meta_ad_accounts')
    .select('access_token, conversions_api_access_token')
    .eq('account_id', accountId)
    .maybeSingle<PlaintextRow>();

  if (error) throw new Error(`Failed to load Meta Ads account: ${error.message}`);

  return {
    access: data?.access_token?.trim() || null,
    conversions_api: data?.conversions_api_access_token?.trim() || null,
  };
}

// Phase 1 only. Insert-if-absent, so a concurrent reconnect that has just stored
// a newer token is never overwritten by the stale plaintext read here. Failure is
// logged, not thrown: the caller already has a working token.
async function copyPlaintextToVault(
  supabase: SupabaseClientLike,
  accountId: string,
  tokenType: MetaAdTokenType,
  plaintext: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from(TOKEN_TABLE)
      .upsert(buildTokenRow(accountId, tokenType, plaintext), {
        onConflict: 'account_id,token_type',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
    logger.info('copied plaintext Meta Ads token into the vault', { accountId, tokenType });
  } catch (copyError) {
    logger.warn('could not copy plaintext Meta Ads token into the vault', {
      accountId,
      tokenType,
      reason: copyError instanceof Error ? copyError.message : String(copyError),
    });
  }
}

function buildTokenRow(accountId: string, tokenType: MetaAdTokenType, plaintext: string) {
  const encrypted = encrypt(plaintext);
  return {
    account_id: accountId,
    token_type: tokenType,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    key_version: encrypted.keyVersion,
  };
}
