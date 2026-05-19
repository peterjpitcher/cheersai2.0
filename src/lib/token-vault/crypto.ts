/**
 * AES-256-GCM encryption/decryption for OAuth token storage.
 *
 * Each encryption call generates a fresh 12-byte IV to ensure
 * unique ciphertext even for identical plaintext inputs.
 * The GCM auth tag provides authenticated encryption -- tampering
 * with ciphertext, IV, or tag causes decryption to fail.
 */
import crypto from 'node:crypto';

import type { EncryptedPayload } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Generates a fresh random IV for each call.
 */
export function encryptPayload(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion,
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 * Auth tag MUST be set before update() per Node.js crypto docs.
 */
export function decryptPayload(
  payload: EncryptedPayload,
  key: Buffer,
): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64'),
    { authTagLength: TAG_LENGTH },
  );

  // Set auth tag BEFORE update (Pitfall 6 in RESEARCH.md)
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
