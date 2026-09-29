import { describe, expect, it } from 'vitest';

import { LEAD_WINDOW_MINUTES, readPublishQueueRequest } from '../supabase/functions/publish-queue/request-options';

/**
 * publish-queue's lead window is fixed: a caller holding only the public anon
 * key (which passes verify_jwt) must not be able to widen it and have
 * scheduled posts published early.
 */
describe('readPublishQueueRequest', () => {
  it('uses the five-minute window both callers send', () => {
    expect(LEAD_WINDOW_MINUTES).toBe(5);
    expect(readPublishQueueRequest({ leadWindowMinutes: 5, source: 'publish-scheduler' })).toEqual({
      leadWindowMinutes: 5,
      source: 'publish-scheduler',
      ignoredLeadWindow: undefined,
    });
  });

  it('ignores a wider, negative or non-numeric window from the caller and reports it', () => {
    for (const requested of [525600, 60, -60, '100000', null, 0]) {
      const result = readPublishQueueRequest({ leadWindowMinutes: requested, source: 'x' });
      expect(result.leadWindowMinutes, String(requested)).toBe(5);
      expect(result.ignoredLeadWindow, String(requested)).toBe(requested);
    }
  });

  it('falls back to the fixed window and an "unknown" source for an empty or malformed body', () => {
    for (const payload of [undefined, null, 'text', 42, [], {}]) {
      expect(readPublishQueueRequest(payload), JSON.stringify(payload)).toEqual({
        leadWindowMinutes: 5,
        source: 'unknown',
        ignoredLeadWindow: undefined,
      });
    }
  });

  it('keeps the source label short and trimmed', () => {
    expect(readPublishQueueRequest({ source: '  tournament  ' }).source).toBe('tournament');
    expect(readPublishQueueRequest({ source: 'x'.repeat(500) }).source).toHaveLength(64);
    expect(readPublishQueueRequest({ source: 123 }).source).toBe('unknown');
  });
});
