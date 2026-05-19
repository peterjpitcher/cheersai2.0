/**
 * Token vault key management.
 *
 * Keys are read from environment variables as hex-encoded strings.
 * Supports versioned keys for lazy re-encryption rotation strategy:
 *   - TOKEN_VAULT_KEY        = current key
 *   - TOKEN_VAULT_KEY_VERSION = current version number (default: 1)
 *   - TOKEN_VAULT_KEY_V{N}   = old key versions for decryption during rotation
 */

const HEX_KEY_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Read and validate an encryption key from an environment variable.
 * The key must be exactly 64 hex characters (32 bytes for AES-256).
 */
export function getKey(envVar: string = 'TOKEN_VAULT_KEY'): Buffer {
  const hexString = process.env[envVar];

  if (!hexString) {
    throw new Error(
      `Missing encryption key: ${envVar} environment variable is not set`,
    );
  }

  if (!HEX_KEY_PATTERN.test(hexString)) {
    throw new Error(
      `Invalid encryption key: ${envVar} must be exactly 64 hex characters (32 bytes)`,
    );
  }

  return Buffer.from(hexString, 'hex');
}

/**
 * Get the current key version number from TOKEN_VAULT_KEY_VERSION.
 * Defaults to 1 if not set.
 */
export function getCurrentKeyVersion(): number {
  const raw = process.env.TOKEN_VAULT_KEY_VERSION;
  if (!raw) return 1;

  const version = parseInt(raw, 10);
  if (isNaN(version) || version < 1) return 1;

  return version;
}
