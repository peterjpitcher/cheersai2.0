import { describe, it, expect } from 'vitest';
import { getPlainEnglishError, type PlainEnglishError } from './error-messages';
import { ErrorClassification } from '@/lib/providers/errors';

describe('error-messages', () => {
  describe('getPlainEnglishError', () => {
    it('maps AUTH to reconnect action', () => {
      const result = getPlainEnglishError(ErrorClassification.AUTH);
      expect(result.title).toBe('Connection expired');
      expect(result.cta.action).toBe('reconnect');
    });

    it('maps RATE_LIMIT to wait action', () => {
      const result = getPlainEnglishError(ErrorClassification.RATE_LIMIT);
      expect(result.cta.action).toBe('wait');
    });

    it('maps CONTENT_REJECTED to edit_content action', () => {
      const result = getPlainEnglishError(ErrorClassification.CONTENT_REJECTED);
      expect(result.cta.action).toBe('edit_content');
    });

    it('maps TRANSIENT to wait action', () => {
      const result = getPlainEnglishError(ErrorClassification.TRANSIENT);
      expect(result.cta.action).toBe('wait');
    });

    it('maps UNKNOWN to retry action', () => {
      const result = getPlainEnglishError(ErrorClassification.UNKNOWN);
      expect(result.cta.action).toBe('retry');
    });

    it('every PlainEnglishError has non-empty title, description, and cta.label', () => {
      const allClassifications = [
        ErrorClassification.AUTH,
        ErrorClassification.RATE_LIMIT,
        ErrorClassification.CONTENT_REJECTED,
        ErrorClassification.TRANSIENT,
        ErrorClassification.UNKNOWN,
      ];

      for (const classification of allClassifications) {
        const result: PlainEnglishError = getPlainEnglishError(classification);
        expect(result.title.length).toBeGreaterThan(0);
        expect(result.description.length).toBeGreaterThan(0);
        expect(result.cta.label.length).toBeGreaterThan(0);
      }
    });
  });
});
