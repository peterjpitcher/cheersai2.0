import crypto from 'crypto';
import { logger } from '@/lib/observability/logger';

/**
 * OAuth Token Encryption using AES-256-GCM
 * 
 * Security features:
 * - AES-256-GCM for authenticated encryption
 * - Random IV for each encryption
 * - Auth tag to prevent tampering
 * - Key derivation from environment secret
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Get or generate encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!secret) {
    throw new Error('ENCRYPTION_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  
  // Derive key using PBKDF2
  const salt = crypto.createHash('sha256').update('cheersai-token-encryption').digest();
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt OAuth token or sensitive data
 */
export function encryptToken(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    
    const tag = cipher.getAuthTag();
    
    // Combine iv + tag + encrypted data
    const combined = Buffer.concat([iv, tag, encrypted]);
    
    // Return base64 encoded
    return combined.toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt token');
  }
}

/**
 * Decrypt OAuth token or sensitive data
 */
export function decryptToken(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');
    
    // Extract components
    const iv = combined.slice(0, IV_LENGTH);
    const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // Avoid logging sensitive ciphertext; record a security event
    logger.securityEvent('token_decryption_failed', 'medium', {
      reason: error instanceof Error ? error.message : 'unknown',
      hint: 'ciphertext invalid or wrong key',
    });
    throw new Error('Failed to decrypt token');
  }
}

/**
 * Hash sensitive data for comparison (e.g., API keys)
 */
export function hashSensitiveData(data: string): string {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Mask token for display (show first and last 4 characters)
 */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return '****';
  }
  
  const firstFour = token.slice(0, 4);
  const lastFour = token.slice(-4);
  const masked = '*'.repeat(Math.min(token.length - 8, 20));
  
  return `${firstFour}${masked}${lastFour}`;
}

/**
 * Validate token format
 */
export function isValidTokenFormat(token: string): boolean {
  // Check if it's a properly encrypted token
  try {
    const decoded = Buffer.from(token, 'base64');
    return decoded.length >= IV_LENGTH + TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * Encrypt object as JSON
 */
export function encryptObject(obj: any): string {
  const json = JSON.stringify(obj);
  return encryptToken(json);
}

/**
 * Decrypt JSON object
 */
export function decryptObject<T>(encrypted: string): T {
  const json = decryptToken(encrypted);
  return JSON.parse(json) as T;
}

/**
 * Token rotation helper
 */
export async function rotateToken(
  oldEncryptedToken: string,
  newPlaintextToken: string
): Promise<{ old: string; new: string }> {
  try {
    // Decrypt old token for audit
    const oldToken = decryptToken(oldEncryptedToken);
    
    // Encrypt new token
    const newEncryptedToken = encryptToken(newPlaintextToken);
    
    return {
      old: maskToken(oldToken),
      new: newEncryptedToken,
    };
  } catch (error) {
    throw new Error('Token rotation failed');
  }
}

/**
 * Batch encrypt multiple tokens
 */
export function encryptTokens(tokens: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(tokens)) {
    if (value) {
      encrypted[key] = encryptToken(value);
    }
  }
  
  return encrypted;
}

/**
 * Batch decrypt multiple tokens
 */
export function decryptTokens(encryptedTokens: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(encryptedTokens)) {
    if (value) {
      try {
        decrypted[key] = decryptToken(value);
      } catch (error) {
        console.error(`Failed to decrypt token for ${key}`);
        // Don't expose which token failed
        decrypted[key] = '';
      }
    }
  }
  
  return decrypted;
}
