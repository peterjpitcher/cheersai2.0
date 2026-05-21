/**
 * GBP (Google Business Profile) adapter integration tests.
 * Uses MSW to intercept mybusiness.googleapis.com API calls.
 * Tests Standard, Event, and Offer post types.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { server, setupMswLifecycle } from '../../../../tests/msw/server';
import { gbpAuthErrorHandler } from '../../../../tests/msw/handlers';
import { GbpAdapter } from './adapter';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';
import type { ContentPayload } from '@/types/providers';

// Mock ensureFreshGbpToken — returns a mock access token directly
// This avoids needing to mock the full token refresh chain
vi.mock('@/lib/providers/gbp/token-refresh', () => ({
  ensureFreshGbpToken: vi.fn().mockResolvedValue('mock_gbp_token_789'),
}));

// Mock getConnectionMetadata for GBP — returns locationId in GBP resource name format
vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn().mockResolvedValue({
    locationId: 'locations/456',
    localPostParent: 'accounts/123/locations/456',
    locationName: 'Test Venue Location',
  }),
}));

describe('GbpAdapter (integration)', () => {
  setupMswLifecycle();

  let adapter: GbpAdapter;

  beforeEach(() => {
    adapter = new GbpAdapter();
    vi.clearAllMocks();
  });

  const standardPayload: ContentPayload = {
    text: 'Check out our weekend specials!',
    contentType: 'instant_post',
  };

  const eventPayload: ContentPayload = {
    text: 'Live music this Friday night',
    contentType: 'event',
    eventDetails: {
      title: 'Friday Night Live',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    },
  };

  const offerPayload: ContentPayload = {
    text: '20% off all starters',
    contentType: 'promotion',
    offerDetails: {
      couponCode: 'STARTER20',
      redeemUrl: 'https://example.com/offer',
      terms: 'Valid until end of June',
    },
  };

  it('should publish a standard post', async () => {
    const result = await adapter.publishPost('conn_789', standardPayload);

    expect(result).toBeDefined();
    expect(result.platformPostId).toContain('localPosts');
    expect(result.platformPostId).toBe('accounts/123/locations/456/localPosts/789');
  });

  it('should publish an event post', async () => {
    const result = await adapter.publishEvent('conn_789', eventPayload);

    expect(result).toBeDefined();
    expect(result.platformPostId).toContain('localPosts');
  });

  it('should publish an offer post', async () => {
    const result = await adapter.publishOffer('conn_789', offerPayload);

    expect(result).toBeDefined();
    expect(result.platformPostId).toContain('localPosts');
  });

  it('should throw AUTH error on 401 response', async () => {
    server.use(gbpAuthErrorHandler);

    await expect(adapter.publishPost('conn_789', standardPayload)).rejects.toThrow(ProviderError);

    try {
      await adapter.publishPost('conn_789', standardPayload);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).classification).toBe(ErrorClassification.AUTH);
      expect((error as ProviderError).platform).toBe('gbp');
    }
  });
});
