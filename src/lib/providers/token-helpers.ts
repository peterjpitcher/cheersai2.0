/**
 * Shared token vault helpers for provider adapters.
 * Wraps the token-vault encrypt/decrypt API with Supabase queries
 * to read/write from the token_vault table.
 */

import { encrypt, decrypt } from '@/lib/token-vault';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Retrieve and decrypt a token from the token vault.
 * Uses service-role client (bypasses RLS) — system operation.
 */
export async function getDecryptedToken(connectionId: string, tokenType: 'access' | 'refresh'): Promise<string> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('token_vault')
    .select('ciphertext, iv, tag, key_version')
    .eq('social_connection_id', connectionId)
    .eq('token_type', tokenType)
    .single();

  if (error || !data) throw new Error(`Token not found: ${tokenType} for connection ${connectionId}`);

  return decrypt({ ciphertext: data.ciphertext, iv: data.iv, tag: data.tag, keyVersion: data.key_version });
}

/**
 * Encrypt and store a token in the token vault.
 * Upserts on (social_connection_id, token_type) to handle token refresh.
 * Uses service-role client (bypasses RLS) — system operation.
 */
export async function storeEncryptedToken(
  connectionId: string,
  tokenType: 'access' | 'refresh',
  plaintext: string,
): Promise<void> {
  const encrypted = encrypt(plaintext);
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from('token_vault').upsert(
    {
      social_connection_id: connectionId,
      token_type: tokenType,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      key_version: encrypted.keyVersion,
    },
    { onConflict: 'social_connection_id,token_type' },
  );

  if (error) throw new Error(`Failed to store token: ${error.message}`);
}
