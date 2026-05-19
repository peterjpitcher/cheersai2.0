import { describe, it, expect } from 'vitest';
import { isGbpAdapter } from './types';
import type { PublishingAdapter } from './types';
import type { ContentPayload, PublishResult, ValidationResult } from '@/types/providers';

function makeMockAdapter(platform: 'facebook' | 'instagram' | 'gbp', extras?: Record<string, unknown>): PublishingAdapter {
  const base: PublishingAdapter = {
    platform,
    supports: () => true,
    validate: (): ValidationResult => ({ valid: true, errors: [] }),
    publishPost: async (): Promise<PublishResult> => ({ platformPostId: '123' }),
  };
  return { ...base, ...extras } as PublishingAdapter;
}

describe('isGbpAdapter', () => {
  it('should return true for adapter with gbp platform and publishEvent/publishOffer', () => {
    const adapter = makeMockAdapter('gbp', {
      publishEvent: async (): Promise<PublishResult> => ({ platformPostId: 'e1' }),
      publishOffer: async (): Promise<PublishResult> => ({ platformPostId: 'o1' }),
    });
    expect(isGbpAdapter(adapter)).toBe(true);
  });

  it('should return false for adapter without publishEvent/publishOffer', () => {
    const adapter = makeMockAdapter('facebook');
    expect(isGbpAdapter(adapter)).toBe(false);
  });

  it('should return false for gbp adapter missing publishOffer', () => {
    const adapter = makeMockAdapter('gbp', {
      publishEvent: async (): Promise<PublishResult> => ({ platformPostId: 'e1' }),
    });
    expect(isGbpAdapter(adapter)).toBe(false);
  });
});
