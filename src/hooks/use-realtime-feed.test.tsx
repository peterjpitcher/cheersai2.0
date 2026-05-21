// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedEvent } from '@/types/notifications';

const {
  mockChannel,
  mockOn,
  mockRemoveChannel,
  mockSubscribe,
} = vi.hoisted(() => {
  const mockSubscribe = vi.fn();
  const channel = {
    on: vi.fn(() => channel),
    subscribe: mockSubscribe,
  };
  return {
    mockChannel: vi.fn(() => channel),
    mockOn: channel.on,
    mockRemoveChannel: vi.fn(() => Promise.resolve('ok')),
    mockSubscribe,
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: vi.fn(() => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  })),
}));

import { useFailedPublishCount, useRealtimeFeed } from './use-realtime-feed';

describe('realtime feed hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue({
      on: mockOn,
      subscribe: mockSubscribe,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the initial failed count when websocket subscription is unavailable', () => {
    mockSubscribe.mockImplementationOnce(() => {
      throw new Error('WebSocket not available');
    });

    const { result, unmount } = renderHook(() => useFailedPublishCount('acc-1', 3));

    expect(result.current).toBe(3);
    expect(mockChannel).toHaveBeenCalledWith('failures:acc-1');

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledOnce();
  });

  it('keeps initial activity events when websocket subscription is unavailable', () => {
    mockSubscribe.mockImplementationOnce(() => {
      throw new Error('WebSocket not available');
    });
    const initialEvents: FeedEvent[] = [{
      id: 'evt-1',
      type: 'publish_failure',
      platform: 'facebook',
      message: 'Failed',
      timestamp: '2026-05-21T12:00:00.000Z',
      category: 'publish_failed',
      metadata: null,
      resourceId: null,
      readAt: null,
    }];

    const { result } = renderHook(() => useRealtimeFeed('acc-1', initialEvents));

    expect(result.current).toEqual(initialEvents);
    expect(mockChannel).toHaveBeenCalledWith('activity-feed:acc-1');
  });
});
