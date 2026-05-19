/**
 * Facebook adapter integration tests.
 * Uses MSW to intercept Graph API calls so we test the full adapter
 * code path (token retrieval -> API call -> response parsing -> error classification).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { server, setupMswLifecycle } from '../../../../tests/msw/server';
import { metaAuthErrorHandler, metaRateLimitHandler } from '../../../../tests/msw/handlers';
import { FacebookAdapter } from './adapter';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';
import type { ContentPayload } from '@/types/providers';

// Mock token helpers and connection metadata — adapters call these before API requests
vi.mock('@/lib/providers/token-helpers', () => ({
  getDecryptedToken: vi.fn().mockResolvedValue('mock_fb_token_123'),
}));

vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn().mockResolvedValue({
    pageId: 'test_page_123',
    pageName: 'Test Page',
  }),
}));

// Mock getMetaGraphApiBase to return a fixed version (no env dependency)
vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

describe('FacebookAdapter (integration)', () => {
  setupMswLifecycle();

  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
    vi.clearAllMocks();
  });

  const textPayload: ContentPayload = {
    text: 'Test post from integration tests',
    contentType: 'instant_post',
  };

  const photoPayload: ContentPayload = {
    text: 'Photo post test',
    mediaUrls: ['https://example.com/photo.jpg'],
    contentType: 'instant_post',
  };

  const storyPayload: ContentPayload = {
    text: '',
    mediaUrls: ['https://example.com/story.jpg'],
    contentType: 'story',
  };

  it('should publish a text-only feed post successfully', async () => {
    const result = await adapter.publishPost('conn_123', textPayload);

    expect(result).toBeDefined();
    expect(result.platformPostId).toBe('12345_67890');
  });

  it('should publish a photo post successfully', async () => {
    const result = await adapter.publishPost('conn_123', photoPayload);

    expect(result).toBeDefined();
    // Photo endpoint returns photo_123
    expect(result.platformPostId).toBe('photo_123');
  });

  it('should throw AUTH error on expired token', async () => {
    server.use(metaAuthErrorHandler);

    await expect(adapter.publishPost('conn_123', textPayload)).rejects.toThrow(ProviderError);

    try {
      await adapter.publishPost('conn_123', textPayload);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).classification).toBe(ErrorClassification.AUTH);
      expect((error as ProviderError).platform).toBe('facebook');
    }
  });

  it('should throw RATE_LIMIT error on 429 response', async () => {
    server.use(metaRateLimitHandler);

    await expect(adapter.publishPost('conn_123', textPayload)).rejects.toThrow(ProviderError);

    try {
      await adapter.publishPost('conn_123', textPayload);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).classification).toBe(ErrorClassification.RATE_LIMIT);
      expect((error as ProviderError).retryable).toBe(true);
    }
  });

  it('should publish a story successfully', async () => {
    const result = await adapter.publishStory('conn_123', storyPayload);

    expect(result).toBeDefined();
    expect(result.platformPostId).toBe('story_123');
  });
});
