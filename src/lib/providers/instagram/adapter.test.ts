/**
 * Instagram adapter tests — validates two-step Content Publishing API,
 * carousel support, content validation, and error classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramAdapter } from './adapter';
import { ErrorClassification } from '@/lib/providers/errors';
import type { ContentPayload } from '@/types/providers';

// Mock dependencies
vi.mock('@/lib/providers/token-helpers', () => ({
  getDecryptedToken: vi.fn().mockResolvedValue('mock-access-token'),
}));

vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn().mockResolvedValue({ igBusinessId: 'ig_user_456' }),
}));

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Helper to create sequential mock responses */
function mockFetchSequence(responses: Array<{ id: string }>): void {
  responses.forEach((resp) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(resp),
    });
  });
}

describe('InstagramAdapter', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new InstagramAdapter();
    // Default: two-step flow (container + publish)
    mockFetchSequence([{ id: 'container_1' }, { id: 'post_789' }]);
  });

  describe('platform', () => {
    it('should equal instagram', () => {
      expect(adapter.platform).toBe('instagram');
    });
  });

  describe('supports', () => {
    it('should return true for instant_post', () => {
      expect(adapter.supports('instant_post')).toBe(true);
    });

    it('should return true for story', () => {
      expect(adapter.supports('story')).toBe(true);
    });

    it('should return true for carousel', () => {
      expect(adapter.supports('carousel')).toBe(true);
    });

    it('should return false for event', () => {
      expect(adapter.supports('event')).toBe(false);
    });

    it('should return false for promotion', () => {
      expect(adapter.supports('promotion')).toBe(false);
    });

    it('should return false for unknown content types', () => {
      expect(adapter.supports('reel')).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return error for post without mediaUrls', () => {
      const content: ContentPayload = { text: 'Hello', contentType: 'instant_post' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_POST_NO_MEDIA' }),
      );
    });

    it('should return valid for post with mediaUrls', () => {
      const content: ContentPayload = {
        text: 'Hello',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/img.jpg'],
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(true);
    });

    it('should return error for caption exceeding 2200 chars', () => {
      const content: ContentPayload = {
        text: 'a'.repeat(2201),
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/img.jpg'],
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_CAPTION_TOO_LONG' }),
      );
    });

    it('should return error for more than 30 hashtags', () => {
      const hashtags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
      const content: ContentPayload = {
        text: hashtags,
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/img.jpg'],
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_TOO_MANY_HASHTAGS' }),
      );
    });

    it('should return error for story without media', () => {
      const content: ContentPayload = { text: 'Story', contentType: 'story' };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_STORY_NO_MEDIA' }),
      );
    });

    it('should return error for carousel with fewer than 2 images', () => {
      const content: ContentPayload = {
        text: 'Carousel',
        contentType: 'carousel',
        mediaUrls: ['https://example.com/img1.jpg'],
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_CAROUSEL_TOO_FEW' }),
      );
    });

    it('should return error for carousel with more than 10 images', () => {
      const mediaUrls = Array.from({ length: 11 }, (_, i) => `https://example.com/img${i}.jpg`);
      const content: ContentPayload = {
        text: 'Carousel',
        contentType: 'carousel',
        mediaUrls,
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'IG_CAROUSEL_TOO_MANY' }),
      );
    });

    it('should return valid for carousel with 2-10 images', () => {
      const mediaUrls = ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'];
      const content: ContentPayload = {
        text: 'Carousel',
        contentType: 'carousel',
        mediaUrls,
      };
      const result = adapter.validate(content);
      expect(result.valid).toBe(true);
    });
  });

  describe('publishPost', () => {
    it('should make two fetch calls for single-image post (container then publish)', async () => {
      const content: ContentPayload = {
        text: 'Post caption',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/photo.jpg'],
      };
      await adapter.publishPost('conn-1', content);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call: create media container
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://graph.facebook.com/v24.0/ig_user_456/media',
        expect.objectContaining({ method: 'POST' }),
      );

      // Second call: publish container
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://graph.facebook.com/v24.0/ig_user_456/media_publish',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return platformPostId from publish response', async () => {
      const content: ContentPayload = {
        text: 'Caption',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/photo.jpg'],
      };
      const result = await adapter.publishPost('conn-1', content);
      expect(result.platformPostId).toBe('post_789');
    });

    it('should create N child containers + 1 carousel container + 1 publish call for carousel', async () => {
      const mediaUrls = [
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
        'https://example.com/img3.jpg',
      ];
      // 3 child containers + 1 carousel container + 1 publish = 5 fetch calls
      mockFetch.mockReset();
      mockFetchSequence([
        { id: 'child_1' },
        { id: 'child_2' },
        { id: 'child_3' },
        { id: 'carousel_container' },
        { id: 'published_post' },
      ]);

      const content: ContentPayload = {
        text: 'Carousel caption',
        contentType: 'carousel',
        mediaUrls,
      };
      const result = await adapter.publishPost('conn-1', content);

      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(result.platformPostId).toBe('published_post');
    });

    it('should include media_type=CAROUSEL and children array in carousel container request', async () => {
      mockFetch.mockReset();
      mockFetchSequence([
        { id: 'child_1' },
        { id: 'child_2' },
        { id: 'carousel_container' },
        { id: 'published_post' },
      ]);

      const content: ContentPayload = {
        text: 'Carousel',
        contentType: 'carousel',
        mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      };
      await adapter.publishPost('conn-1', content);

      // The 3rd call (index 2) is the carousel container creation
      const carouselCallBody = JSON.parse(mockFetch.mock.calls[2][1].body as string);
      expect(carouselCallBody.media_type).toBe('CAROUSEL');
      expect(carouselCallBody.children).toEqual(['child_1', 'child_2']);
    });

    it('should set is_carousel_item=true for child containers', async () => {
      mockFetch.mockReset();
      mockFetchSequence([
        { id: 'child_1' },
        { id: 'child_2' },
        { id: 'carousel_container' },
        { id: 'published_post' },
      ]);

      const content: ContentPayload = {
        text: 'Carousel',
        contentType: 'carousel',
        mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      };
      await adapter.publishPost('conn-1', content);

      // First two calls are child container creations
      const child1Body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(child1Body.is_carousel_item).toBe(true);
      const child2Body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(child2Body.is_carousel_item).toBe(true);
    });
  });

  describe('publishStory', () => {
    it('should include media_type=STORIES in container creation', async () => {
      const content: ContentPayload = {
        text: '',
        contentType: 'story',
        mediaUrls: ['https://example.com/story.jpg'],
      };
      await adapter.publishStory!('conn-1', content);

      // First call: container with STORIES media type
      const containerBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(containerBody.media_type).toBe('STORIES');
    });

    it('should make two fetch calls (container then publish)', async () => {
      const content: ContentPayload = {
        text: '',
        contentType: 'story',
        mediaUrls: ['https://example.com/story.jpg'],
      };
      await adapter.publishStory!('conn-1', content);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://graph.facebook.com/v24.0/ig_user_456/media_publish',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return platformPostId from publish response', async () => {
      const content: ContentPayload = {
        text: '',
        contentType: 'story',
        mediaUrls: ['https://example.com/story.jpg'],
      };
      const result = await adapter.publishStory!('conn-1', content);
      expect(result.platformPostId).toBe('post_789');
    });
  });

  describe('error classification', () => {
    it('should throw ProviderError with RATE_LIMIT on 429 response', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      });

      const content: ContentPayload = {
        text: 'Test',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/img.jpg'],
      };
      await expect(adapter.publishPost('conn-1', content)).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.RATE_LIMIT,
      });
    });

    it('should throw ProviderError with AUTH on 401 response', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
      });

      const content: ContentPayload = {
        text: 'Test',
        contentType: 'instant_post',
        mediaUrls: ['https://example.com/img.jpg'],
      };
      await expect(adapter.publishPost('conn-1', content)).rejects.toMatchObject({
        name: 'ProviderError',
        classification: ErrorClassification.AUTH,
      });
    });
  });
});
