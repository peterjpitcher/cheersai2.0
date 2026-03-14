import { describe, expect, it } from 'vitest';

import {
  getGbpLocationIdValidationError,
  isCanonicalGbpLocationId,
  isLikelyGbpPlaceId,
  normalizeCanonicalGbpLocationId,
} from '@/lib/gbp/location-id';

describe('GBP location ID helpers', () => {
  it('normalizes canonical numeric resource names', () => {
    expect(normalizeCanonicalGbpLocationId('locations/123456789')).toBe('locations/123456789');
    expect(normalizeCanonicalGbpLocationId('accounts/555/locations/123456789')).toBe('locations/123456789');
    expect(isCanonicalGbpLocationId('locations/123456789')).toBe(true);
    expect(isCanonicalGbpLocationId('accounts/555/locations/123456789')).toBe(false);
  });

  it('rejects place IDs as non-canonical', () => {
    expect(normalizeCanonicalGbpLocationId('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg')).toBeNull();
    expect(normalizeCanonicalGbpLocationId('ChIJDcbcERJxdkgReaFjdQ7fzfg')).toBeNull();
    expect(isLikelyGbpPlaceId('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg')).toBe(true);
    expect(isLikelyGbpPlaceId('ChIJDcbcERJxdkgReaFjdQ7fzfg')).toBe(true);
  });

  it('returns helpful validation errors for bad GBP IDs', () => {
    expect(getGbpLocationIdValidationError('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg')).toMatch(/not a Google Place ID/i);
    expect(getGbpLocationIdValidationError('abc123')).toMatch(/format `locations\/1234567890`/i);
    expect(getGbpLocationIdValidationError('accounts/555/locations/123456789')).toBeNull();
  });
});
