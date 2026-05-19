/**
 * Token Vault type definitions.
 *
 * All string fields in EncryptedPayload are base64-encoded.
 */

/** Encrypted token payload stored in the database. */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded 12-byte initialisation vector */
  iv: string;
  /** Base64-encoded 16-byte GCM authentication tag */
  tag: string;
  /** Version of the encryption key used */
  keyVersion: number;
}

/** Token vault configuration options. */
export interface VaultConfig {
  /** Environment variable name for the encryption key (default: TOKEN_VAULT_KEY) */
  keyEnvVar: string;
}
