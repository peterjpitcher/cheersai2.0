/**
 * Token Vault -- public API for encrypting social OAuth tokens at rest.
 *
 * Uses AES-256-GCM with versioned keys for rotation support.
 * Resolves critical issue C-1 (plaintext token storage).
 *
 * @example
 * ```ts
 * import { encrypt, decrypt, rotate } from '@/lib/token-vault';
 *
 * // Encrypt a token for storage
 * const encrypted = encrypt(accessToken);
 * // Store encrypted in database...
 *
 * // Decrypt when needed
 * const plainToken = decrypt(encrypted);
 *
 * // Rotate to a new key version (lazy re-encrypt)
 * const rotated = rotate(encrypted, oldKey, oldKeyVersion);
 * ```
 */
export { type EncryptedPayload, type VaultConfig } from './types';
export { encryptPayload, decryptPayload } from './crypto';
export { getKey, getCurrentKeyVersion } from './key-management';

import { encryptPayload, decryptPayload } from './crypto';
import { getKey, getCurrentKeyVersion } from './key-management';
import type { EncryptedPayload } from './types';

/**
 * Encrypt a plaintext string using the current vault key.
 * Reads TOKEN_VAULT_KEY and TOKEN_VAULT_KEY_VERSION from env.
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const keyVersion = getCurrentKeyVersion();
  return encryptPayload(plaintext, key, keyVersion);
}

/**
 * Decrypt an encrypted payload using the current vault key.
 * If payload.keyVersion does not match current version, caller
 * should call rotate() for lazy re-encryption.
 */
export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  return decryptPayload(payload, key);
}

/**
 * Rotate a payload from an old key to the current key.
 * Decrypts with the old key, then re-encrypts with the current key.
 * Returns a new EncryptedPayload with updated keyVersion.
 */
export function rotate(
  payload: EncryptedPayload,
  oldKey: Buffer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _oldKeyVersion: number,
): EncryptedPayload {
  const plaintext = decryptPayload(payload, oldKey);
  const currentKey = getKey();
  const currentVersion = getCurrentKeyVersion();
  return encryptPayload(plaintext, currentKey, currentVersion);
}
