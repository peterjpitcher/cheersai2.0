/**
 * Instagram adapter integration tests.
 * Uses MSW to intercept Graph API calls for the two-step publish flow:
 * 1. Create container (POST /media)
 * 2. Publish container (POST /media_publish)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { server, setupMswLifecycle } from '../../../../tests/msw/server';
import { metaIgAuthErrorHandler } from '../../../../tests/msw/handlers';
import { InstagramAdapter } from './adapter';
import { ProviderError, ErrorClassification } from '@/lib/providers/errors';
import type { ContentPayload } from '@/types/providers';

// Mock token helpers and connection metadata
vi.mock('@/lib/providers/token-helpers', () => ({
  getDecryptedToken: vi.fn().mockResolvedValue('mock_ig_token_456'),
}));

vi.mock('@/lib/providers/shared', () => ({
  getConnectionMetadata: vi.fn().mockResolvedValue({
    igBusinessId: 'test_ig_123',
    igUsername: 'test_venue',
  }),
}));

// Mock getMetaGraphApiBase to return a fixed version
vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

describe('InstagramAdapter (integration)', () => {
  setupMswLifecycle();

  let adapter: InstagramAdapter;

  beforeEach(() => {
    adapter = new InstagramAdapter();
    vi.clearAllMocks();
  });

  const postPayload: ContentPayload = {
    text: 'Test Instagram post',
    mediaUrls: ['https://example.com/image.jpg'],
    contentType: 'instant_post',
  };

  const storyPayload: ContentPayload = {
    text: '',
    mediaUrls: ['https://example.com/story.jpg'],
    contentType: 'story',
  };

  it('should publish a post via two-step container+publish', async () => {
    const result = await adapter.publishPost('conn_456', postPayload);

    expect(result).toBeDefined();
    // MSW returns 'ig_post_456' from the media_publish endpoint
    expect(result.platformPostId).toBe('ig_post_456');
  });

  it('should throw AUTH error on container creation failure', async () => {
    server.use(metaIgAuthErrorHandler);

    await expect(adapter.publishPost('conn_456', postPayload)).rejects.toThrow(ProviderError);

    try {
      await adapter.publishPost('conn_456', postPayload);
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).classification).toBe(ErrorClassification.AUTH);
      expect((error as ProviderError).platform).toBe('instagram');
    }
  });

  it('should publish a story successfully', async () => {
    // Story uses media_type=STORIES in container creation, then standard publish
    const result = await adapter.publishStory('conn_456', storyPayload);

    expect(result).toBeDefined();
    // Story also goes through media_publish, which returns 'ig_post_456'
    expect(result.platformPostId).toBe('ig_post_456');
  });
});
