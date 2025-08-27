/**
 * Tests for encryption utilities
 */

import { encrypt, decrypt, encryptOAuthToken, decryptOAuthToken, generateEncryptionKey, hashSensitiveData, safeCompare } from '@/lib/security/encryption';

// Mock the environment variable for testing
const MOCK_ENCRYPTION_KEY = generateEncryptionKey();
const originalEnv = process.env;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = MOCK_ENCRYPTION_KEY;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Encryption Utilities', () => {
  describe('Basic encryption/decryption', () => {
    it('should encrypt and decrypt data correctly', () => {
      const plaintext = 'sensitive data';
      const encrypted = encrypt(plaintext);
      
      expect(encrypted).toHaveProperty('encryptedData');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate different encrypted data for same plaintext', () => {
      const plaintext = 'test data';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      
      // Same plaintext should produce different encrypted data due to random IV
      expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      
      // But both should decrypt to the same plaintext
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = '🔐 Test with émojis and spéciál characters! 测试';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should fail decryption with tampered data', () => {
      const plaintext = 'secret data';
      const encrypted = encrypt(plaintext);
      
      // Tamper with encrypted data
      const tamperedEncrypted = {
        ...encrypted,
        encryptedData: encrypted.encryptedData.slice(0, -1) + 'X',
      };
      
      expect(() => decrypt(tamperedEncrypted)).toThrow('Failed to decrypt data');
    });

    it('should fail decryption with tampered authentication tag', () => {
      const plaintext = 'secret data';
      const encrypted = encrypt(plaintext);
      
      // Tamper with auth tag
      const tamperedEncrypted = {
        ...encrypted,
        tag: encrypted.tag.slice(0, -1) + 'X',
      };
      
      expect(() => decrypt(tamperedEncrypted)).toThrow('Failed to decrypt data');
    });
  });

  describe('OAuth token encryption', () => {
    it('should encrypt and decrypt OAuth tokens', () => {
      const token = 'oauth_token_12345';
      const encryptedToken = encryptOAuthToken(token);
      
      expect(encryptedToken).toBeTruthy();
      expect(encryptedToken).not.toBe(token);
      
      const decryptedToken = decryptOAuthToken(encryptedToken);
      expect(decryptedToken).toBe(token);
    });

    it('should handle long OAuth tokens', () => {
      const longToken = 'a'.repeat(1000);
      const encryptedToken = encryptOAuthToken(longToken);
      const decryptedToken = decryptOAuthToken(encryptedToken);
      
      expect(decryptedToken).toBe(longToken);
    });

    it('should fail to decrypt invalid OAuth token format', () => {
      expect(() => decryptOAuthToken('invalid_format')).toThrow('Failed to decrypt OAuth token');
    });
  });

  describe('Utility functions', () => {
    it('should generate valid encryption keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      
      expect(key1).toBeTruthy();
      expect(key2).toBeTruthy();
      expect(key1).not.toBe(key2);
      
      // Key should be base64 encoded and 32 bytes when decoded
      const keyBuffer = Buffer.from(key1, 'base64');
      expect(keyBuffer.length).toBe(32);
    });

    it('should hash sensitive data consistently', () => {
      const data = 'sensitive information';
      const hash1 = hashSensitiveData(data);
      const hash2 = hashSensitiveData(data);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64-char hex string
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different data', () => {
      const data1 = 'data1';
      const data2 = 'data2';
      
      const hash1 = hashSensitiveData(data1);
      const hash2 = hashSensitiveData(data2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should safely compare strings', () => {
      const str1 = 'secret123';
      const str2 = 'secret123';
      const str3 = 'secret124';
      
      expect(safeCompare(str1, str2)).toBe(true);
      expect(safeCompare(str1, str3)).toBe(false);
    });

    it('should return false for different length strings in safe compare', () => {
      const str1 = 'short';
      const str2 = 'longer string';
      
      expect(safeCompare(str1, str2)).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should throw error when encryption key is missing', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is required');
      
      process.env.ENCRYPTION_KEY = originalKey;
    });

    it('should throw error when encryption key is invalid length', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'too_short_key';
      
      expect(() => encrypt('test')).toThrow('Encryption key must be 32 bytes');
      
      process.env.ENCRYPTION_KEY = originalKey;
    });

    it('should throw error when encryption key is not base64', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '!@#$%^&*()_+{}|:<>?[]\\;\'",./`~'; // Invalid base64
      
      expect(() => encrypt('test')).toThrow('Invalid ENCRYPTION_KEY format');
      
      process.env.ENCRYPTION_KEY = originalKey;
    });
  });
});