import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { encryptPayload, decryptPayload } from './crypto';
import { getKey } from './key-management';
import { rotate } from './index';
import type { EncryptedPayload } from './types';

/** Generate a random 32-byte test key (AES-256). */
function makeTestKey(): Buffer {
  return crypto.randomBytes(32);
}

describe('token-vault', () => {
  describe('encryptPayload / decryptPayload', () => {
    it('should produce an EncryptedPayload with ciphertext, iv, tag (all base64), and keyVersion', () => {
      const key = makeTestKey();
      const payload = encryptPayload('my-secret-token', key, 1);

      expect(payload).toHaveProperty('ciphertext');
      expect(payload).toHaveProperty('iv');
      expect(payload).toHaveProperty('tag');
      expect(payload).toHaveProperty('keyVersion', 1);

      // Verify all string fields are valid base64
      expect(() => Buffer.from(payload.ciphertext, 'base64')).not.toThrow();
      expect(() => Buffer.from(payload.iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(payload.tag, 'base64')).not.toThrow();
    });

    it('should decrypt(encrypt(plaintext)) returning the original plaintext exactly', () => {
      const key = makeTestKey();
      const original = 'facebook-access-token-abc123xyz';
      const payload = encryptPayload(original, key, 1);
      const decrypted = decryptPayload(payload, key);

      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for the same plaintext (unique IV per call)', () => {
      const key = makeTestKey();
      const plaintext = 'same-secret-for-both';
      const first = encryptPayload(plaintext, key, 1);
      const second = encryptPayload(plaintext, key, 1);

      expect(first.iv).not.toBe(second.iv);
      expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it('should throw when decrypting with a wrong key', () => {
      const keyA = makeTestKey();
      const keyB = makeTestKey();
      const payload = encryptPayload('secret', keyA, 1);

      expect(() => decryptPayload(payload, keyB)).toThrow();
    });

    it('should throw when ciphertext is tampered (GCM authentication)', () => {
      const key = makeTestKey();
      const payload = encryptPayload('secret', key, 1);

      // Tamper with the ciphertext
      const tampered: EncryptedPayload = {
        ...payload,
        ciphertext: Buffer.from('tampered-data').toString('base64'),
      };

      expect(() => decryptPayload(tampered, key)).toThrow();
    });
  });

  describe('key-management', () => {
    const VALID_HEX_KEY = crypto.randomBytes(32).toString('hex');

    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return a 32-byte Buffer from a hex-encoded env var', () => {
      vi.stubEnv('TOKEN_VAULT_KEY', VALID_HEX_KEY);
      const key = getKey();

      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('should throw if TOKEN_VAULT_KEY is not set or not 64 hex chars', () => {
      // Not set
      vi.stubEnv('TOKEN_VAULT_KEY', '');
      expect(() => getKey()).toThrow();

      // Too short
      vi.stubEnv('TOKEN_VAULT_KEY', 'abcdef');
      expect(() => getKey()).toThrow();

      // Invalid hex chars
      vi.stubEnv('TOKEN_VAULT_KEY', 'g'.repeat(64));
      expect(() => getKey()).toThrow();
    });
  });

  describe('rotate', () => {
    it('should decrypt with old key and re-encrypt with new key, updating keyVersion', () => {
      const oldKey = makeTestKey();
      const newKey = makeTestKey();
      const plaintext = 'refresh-token-to-rotate';

      // Encrypt with old key at version 1
      const oldPayload = encryptPayload(plaintext, oldKey, 1);
      expect(oldPayload.keyVersion).toBe(1);

      // Stub env for the new key (version 2)
      vi.stubEnv('TOKEN_VAULT_KEY', newKey.toString('hex'));
      vi.stubEnv('TOKEN_VAULT_KEY_VERSION', '2');

      // Rotate
      const rotated = rotate(oldPayload, oldKey, 1);

      expect(rotated.keyVersion).toBe(2);
      // New payload should decrypt with new key
      const decrypted = decryptPayload(rotated, newKey);
      expect(decrypted).toBe(plaintext);

      // Old payload should NOT decrypt with new key
      expect(() => decryptPayload(oldPayload, newKey)).toThrow();

      vi.unstubAllEnvs();
    });
  });
});
