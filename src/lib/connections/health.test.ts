import { describe, it, expect } from 'vitest';

import { deriveConnectionHealth } from './health';

// ---------------------------------------------------------------------------
// deriveConnectionHealth — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('deriveConnectionHealth', () => {
  it('should return green when status is active and token_expires_at is more than 7 days away', () => {
    const future30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveConnectionHealth('active', future30Days, 'instagram')).toBe('green');
  });

  it('should return amber when status is active and token_expires_at is within 7 days', () => {
    const future3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveConnectionHealth('active', future3Days, 'instagram')).toBe('amber');
  });

  it('should return red when token_expires_at is in the past', () => {
    const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveConnectionHealth('active', pastDate, 'instagram')).toBe('red');
  });

  it('should return red when status is revoked', () => {
    // Even though DB enum uses "disconnected", test both possible values
    expect(deriveConnectionHealth('disconnected', null, 'facebook')).toBe('red');
  });

  it('should return red when status is expired', () => {
    expect(deriveConnectionHealth('expired', null, 'gbp')).toBe('red');
  });

  it('should return red when status needs action', () => {
    expect(deriveConnectionHealth('needs_action', null, 'facebook')).toBe('red');
  });

  it('should return green for Facebook page tokens where token_expires_at is null and status is active (page tokens do not expire)', () => {
    expect(deriveConnectionHealth('active', null, 'facebook')).toBe('green');
  });

  it('should return amber when token_expires_at is null and status is active for GBP (unknown expiry)', () => {
    expect(deriveConnectionHealth('active', null, 'gbp')).toBe('amber');
  });

  it('should return amber when token_expires_at is null and status is active for Instagram (unknown expiry)', () => {
    expect(deriveConnectionHealth('active', null, 'instagram')).toBe('amber');
  });

  it('should return amber at exactly 7 days boundary', () => {
    const exactly7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // At exactly 7 days, the difference equals EXPIRY_WARNING_MS, so <= means amber
    expect(deriveConnectionHealth('active', exactly7Days, 'instagram')).toBe('amber');
  });

  it('should return green just past 7 days', () => {
    const justPast7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60000).toISOString();
    expect(deriveConnectionHealth('active', justPast7Days, 'instagram')).toBe('green');
  });
});
