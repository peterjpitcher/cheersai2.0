import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorClassification, ProviderError } from '@/lib/providers/errors';
import { isGbpAdapter } from '@/lib/providers/types';

// Mock dependencies
vi.mock('@/lib/providers/gbp/token-refresh', () => ({
  ensureFreshGbpToken: vi.fn(),
}));

vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GbpAdapter } from './adapter';
import { ensureFreshGbpToken } from '@/lib/providers/gbp/token-refresh';
import { getConnectionMetadata } from '@/lib/providers/shared';

describe('GbpAdapter', () => {
  let adapter: GbpAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GbpAdapter();
    vi.mocked(ensureFreshGbpToken).mockResolvedValue('test-access-token');
    vi.mocked(getConnectionMetadata).mockResolvedValue({ locationId: 'locations/123456789' });
  });

  describe('platform', () => {
    it('should have platform equal to gbp', () => {
      expect(adapter.platform).toBe('gbp');
    });
  });

  describe('supports', () => {
    it('should support instant_post', () => {
      expect(adapter.supports('instant_post')).toBe(true);
    });

    it('should support event', () => {
      expect(adapter.supports('event')).toBe(true);
    });

    it('should support promotion', () => {
      expect(adapter.supports('promotion')).toBe(true);
    });

    it('should not support story', () => {
      expect(adapter.supports('story')).toBe(false);
    });

    it('should not support carousel', () => {
      expect(adapter.supports('carousel')).toBe(false);
    });
  });

  describe('isGbpAdapter', () => {
    it('should return true for GbpAdapter instances', () => {
      expect(isGbpAdapter(adapter)).toBe(true);
    });
  });

  describe('publishPost', () => {
    it('should call ensureFreshGbpToken before publishing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'locations/123456789/localPosts/post-1' }),
      });

      await adapter.publishPost('conn-1', {
        text: 'Visit our pub tonight!',
        contentType: 'instant_post',
      });

      expect(ensureFreshGbpToken).toHaveBeenCalledWith('conn-1');
    });

    it('should send correct GBP API URL with topicType STANDARD', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'locations/123456789/localPosts/post-1' }),
      });

      const result = await adapter.publishPost('conn-1', {
        text: 'Great food and drinks!',
        contentType: 'instant_post',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://mybusiness.googleapis.com/v4/locations/123456789/localPosts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token',
          }),
        }),
      );

      // Verify the body contains STANDARD topicType
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.topicType).toBe('STANDARD');
      expect(callBody.summary).toBe('Great food and drinks!');
      expect(result.platformPostId).toBe('locations/123456789/localPosts/post-1');
    });

    it('should include media when mediaUrls provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'locations/123456789/localPosts/post-2' }),
      });

      await adapter.publishPost('conn-1', {
        text: 'Check out our new menu!',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/photo.jpg'],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.media).toEqual([
        { mediaFormat: 'PHOTO', sourceUrl: 'https://example.com/photo.jpg' },
      ]);
    });
  });

  describe('publishEvent', () => {
    it('should include event details with parsed GBP date format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'locations/123456789/localPosts/event-1' }),
      });

      const result = await adapter.publishEvent('conn-1', {
        text: 'Join us for quiz night!',
        contentType: 'event',
        eventDetails: {
          title: 'Quiz Night',
          startDate: '2026-01-20',
          endDate: '2026-01-20',
        },
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.topicType).toBe('EVENT');
      expect(callBody.event.title).toBe('Quiz Night');
      expect(callBody.event.schedule.startDate).toEqual({ year: 2026, month: 1, day: 20 });
      expect(callBody.event.schedule.endDate).toEqual({ year: 2026, month: 1, day: 20 });
      expect(result.platformPostId).toBe('locations/123456789/localPosts/event-1');
    });
  });

  describe('publishOffer', () => {
    it('should include offer details with couponCode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'locations/123456789/localPosts/offer-1' }),
      });

      const result = await adapter.publishOffer('conn-1', {
        text: '20% off all drinks this weekend!',
        contentType: 'promotion',
        offerDetails: {
          couponCode: 'DRINKS20',
          redeemUrl: 'https://example.com/redeem',
          terms: 'Valid this weekend only',
        },
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.topicType).toBe('OFFER');
      expect(callBody.offer.couponCode).toBe('DRINKS20');
      expect(callBody.offer.redeemOnlineUrl).toBe('https://example.com/redeem');
      expect(callBody.offer.termsConditions).toBe('Valid this weekend only');
      expect(result.platformPostId).toBe('locations/123456789/localPosts/offer-1');
    });
  });

  describe('error handling', () => {
    it('should throw ProviderError with TRANSIENT on 500 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: { message: 'Server error' } }),
      });

      await expect(
        adapter.publishPost('conn-1', {
          text: 'Hello!',
          contentType: 'instant_post',
        }),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.TRANSIENT,
        retryable: true,
      });
    });

    it('should throw ProviderError with AUTH on 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ error: { message: 'Invalid token' } }),
      });

      await expect(
        adapter.publishPost('conn-1', {
          text: 'Hello!',
          contentType: 'instant_post',
        }),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.AUTH,
      });
    });

    it('should throw ProviderError with RATE_LIMIT on 429 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({ error: { message: 'Rate limited' } }),
      });

      await expect(
        adapter.publishPost('conn-1', {
          text: 'Hello!',
          contentType: 'instant_post',
        }),
      ).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.RATE_LIMIT,
        retryable: true,
        retryAfterMs: 60_000,
      });
    });
  });
});
