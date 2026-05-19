import { describe, expect, it } from 'vitest';

import { validateSecret } from './signing';

describe('validateSecret', () => {
  it('should return true when provided matches expected', () => {
    expect(validateSecret('my-cron-secret', 'my-cron-secret')).toBe(true);
  });

  it('should return false when provided does not match expected', () => {
    expect(validateSecret('wrong-secret', 'my-cron-secret')).toBe(false);
  });

  it('should return false when provided is null or empty string', () => {
    expect(validateSecret(null, 'my-cron-secret')).toBe(false);
    expect(validateSecret('', 'my-cron-secret')).toBe(false);
  });

  it('should return false when lengths differ (prevents timing attack on length)', () => {
    expect(validateSecret('short', 'much-longer-secret')).toBe(false);
    expect(validateSecret('a-very-very-long-secret', 'short')).toBe(false);
  });
});
