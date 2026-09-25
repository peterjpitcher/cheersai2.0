/**
 * Encrypted storage for the paid-ads Meta tokens (tasks/SPEC-encrypt-meta-ad-tokens.md).
 *
 * Every reader and writer of a brand's Meta Ads access token or Conversions API
 * token goes through this module. Tokens live encrypted (token-vault, AES-256-GCM)
 * in `meta_ad_account_tokens`, one row per brand and token type.
 *
 * The legacy plaintext columns on `meta_ad_accounts` (`access_token`,
 * `conversions_api_access_token`) are cleared and held empty by CHECK
 * constraints (migration 20260926070000); nothing reads or writes them.
 *
 * All queries use the caller's service-role client and are scoped by account_id.
 */
import { createLogger } from '@/lib/logging';
import type { createServiceSupabaseClient } from '@/lib/supabase/service';
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

const TOKEN_TABLE = 'meta_ad_account_tokens';

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
 */
export async function getMetaAdAccountTokens(
  supabase: SupabaseClientLike,
  accountId: string,
): Promise<MetaAdAccountTokens> {
  const { data, error } = await supabase
    .from(TOKEN_TABLE)
    .select('token_type, ciphertext, iv, tag, key_version')
    .eq('account_id', accountId);

  if (error) throw new Error(`Failed to load Meta Ads tokens: ${error.message}`);

  const tokens = new Map<MetaAdTokenType, string>();
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

  return {
    accessToken: tokens.get('access') ?? null,
    conversionsApiToken: tokens.get('conversions_api') ?? null,
  };
}

/**
 * Encrypt and store a token for a brand, replacing any earlier one. The
 * `meta_ad_accounts` row must already exist (the token row references it).
 * Throws if the write fails.
 */
export async function storeMetaAdAccountToken(
  supabase: SupabaseClientLike,
  accountId: string,
  tokenType: MetaAdTokenType,
  plaintext: string,
): Promise<void> {
  const token = plaintext.trim();
  if (!token) throw new Error('Refusing to store an empty Meta Ads token.');

  const encrypted = encrypt(token);
  const { error } = await supabase.from(TOKEN_TABLE).upsert(
    {
      account_id: accountId,
      token_type: tokenType,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      key_version: encrypted.keyVersion,
    },
    { onConflict: 'account_id,token_type' },
  );
  if (error) throw new Error(`Failed to store Meta Ads token: ${error.message}`);
}

/**
 * Delete stored tokens for the given brands (revocation: Meta deauthorise or data
 * deletion, brand offboarding). Throws on failure so a revocation never
 * half-succeeds silently.
 */
export async function deleteMetaAdAccountTokens(
  supabase: SupabaseClientLike,
  accountIds: string[],
  tokenTypes: MetaAdTokenType[],
): Promise<void> {
  if (!accountIds.length || !tokenTypes.length) return;

  const { error } = await supabase
    .from(TOKEN_TABLE)
    .delete()
    .in('account_id', accountIds)
    .in('token_type', tokenTypes);
  if (error) throw new Error(`Failed to delete Meta Ads tokens: ${error.message}`);
}
