/**
 * Facebook adapter tests — validates Graph API publishing,
 * content validation, and error classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookAdapter } from './adapter';
import { ErrorClassification } from '@/lib/providers/errors';
import type { ContentPayload } from '@/types/providers';

// Mock dependencies
vi.mock('@/lib/providers/token-helpers', () => ({
  getDecryptedToken: vi.fn().mockResolvedValue('mock-access-token'),
}));

vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn().mockResolvedValue({ pageId: '123456789' }),
}));

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('FacebookAdapter', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new FacebookAdapter();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'post_123' }),
    });
  });

  describe('platform', () => {
    it('should equal facebook', () => {
      expect(adapter.platform).toBe('facebook');
    });
  });

  describe('supports', () => {
    it('should return true for instant_post', () => {
      expect(adapter.supports('instant_post')).toBe(true);
    });

    it('should return true for story', () => {
      expect(adapter.supports('story')).toBe(true);
    });

    it('should return true for event', () => {
      expect(adapter.supports('event')).toBe(true);
    });

    it('should return true for promotion', () => {
      expect(adapter.supports('promotion')).toBe(true);
    });

    it('should return false for carousel', () => {
      expect(adapter.supports('carousel')).toBe(false);
    });

    it('should return false for unknown content types', () => {
      expect(adapter.supports('reel')).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return valid for a normal text post', () => {
      const content: ContentPayload = { text: 'Hello world', contentType: 'instant_post' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for text exceeding 63206 chars', () => {
      const content: ContentPayload = { text: 'a'.repeat(63207), contentType: 'instant_post' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'FB_TEXT_TOO_LONG' }),
      );
    });

    it('should return error for story without mediaUrls', () => {
      const content: ContentPayload = { text: 'Story text', contentType: 'story' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'FB_STORY_NO_MEDIA' }),
      );
    });

    it('should accept story with mediaUrls', () => {
      const content: ContentPayload = {
        text: 'Story',
        contentType: 'story',
        mediaUrls: ['https://example.com/image.jpg'],
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(true);
    });

    it('should return error for event without title', () => {
      const content: ContentPayload = {
        text: 'Event',
        contentType: 'event',
        eventDetails: { title: '', startDate: '2026-06-01', endDate: '2026-06-02' },
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'FB_EVENT_MISSING_TITLE' }),
      );
    });

    it('should return error for event without eventDetails', () => {
      const content: ContentPayload = { text: 'Event', contentType: 'event' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'FB_EVENT_MISSING_TITLE' }),
      );
    });

    it('should return error for promotion without couponCode', () => {
      const content: ContentPayload = {
        text: 'Promo',
        contentType: 'promotion',
        offerDetails: { couponCode: '' },
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'FB_PROMO_NO_COUPON' }),
      );
    });
  });

  describe('publishPost', () => {
    it('should call Graph API /{page-id}/feed for text-only posts', async () => {
      const content: ContentPayload = { text: 'Hello world', contentType: 'instant_post' };
      const result = await adapter.publishPost('conn-1', content);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v24.0/123456789/feed',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
      expect(result.platformPostId).toBe('post_123');
    });

    it('should call Graph API /{page-id}/photos for posts with media', async () => {
      const content: ContentPayload = {
        text: 'Photo post',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/photo.jpg'],
      };
      await adapter.publishPost('conn-1', content);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v24.0/123456789/photos',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return platformPostId from API response', async () => {
      const content: ContentPayload = { text: 'Test', contentType: 'instant_post' };
      const result = await adapter.publishPost('conn-1', content);
      expect(result.platformPostId).toBe('post_123');
    });
  });

  describe('publishStory', () => {
    it('should call Graph API /{page-id}/photo_stories', async () => {
      const content: ContentPayload = {
        text: '',
        contentType: 'story',
        mediaUrls: ['https://example.com/story.jpg'],
      };
      await adapter.publishStory!('conn-1', content);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v24.0/123456789/photo_stories',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return platformPostId from API response', async () => {
      const content: ContentPayload = {
        text: '',
        contentType: 'story',
        mediaUrls: ['https://example.com/story.jpg'],
      };
      const result = await adapter.publishStory!('conn-1', content);
      expect(result.platformPostId).toBe('post_123');
    });
  });

  describe('error classification', () => {
    it('should throw ProviderError with RATE_LIMIT on 429 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      });

      const content: ContentPayload = { text: 'Test', contentType: 'instant_post' };
      await expect(adapter.publishPost('conn-1', content)).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.RATE_LIMIT,
      });
    });

    it('should throw ProviderError with AUTH on 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
      });

      const content: ContentPayload = { text: 'Test', contentType: 'instant_post' };
      await expect(adapter.publishPost('conn-1', content)).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.AUTH,
      });
    });
  });
});
