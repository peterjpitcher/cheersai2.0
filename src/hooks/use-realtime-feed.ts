'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { FeedEvent, NotificationRow, PublishJobRow } from '@/types/notifications';

const MAX_FEED_ITEMS = 50;

// ---------------------------------------------------------------------------
// Helpers: map Realtime payloads to FeedEvent
// ---------------------------------------------------------------------------

function mapPublishJobToFeedEvent(
  payload: RealtimePostgresChangesPayload<PublishJobRow>,
): FeedEvent | null {
  const row = payload.new as PublishJobRow | undefined;
  if (!row) return null;

  const status = row.status;
  let type: FeedEvent['type'];

  if (status === 'published') {
    type = 'publish_success';
  } else if (status === 'failed') {
    type = 'publish_failure';
  } else {
    // Skip intermediate states like 'queued', 'publishing'
    return null;
  }

  const platformLabel = row.platform
    ? row.platform.charAt(0).toUpperCase() + row.platform.slice(1)
    : 'Unknown';

  const message =
    type === 'publish_success'
      ? `Post published to ${platformLabel}`
      : `Post failed on ${platformLabel}`;

  return {
    id: `pj-${row.id}-${row.updated_at}`,
    type,
    platform: row.platform,
    message,
    timestamp: row.updated_at,
    category: type === 'publish_success' ? 'publish_success' : 'publish_failed',
    metadata: { contentItemId: row.content_item_id, errorMessage: row.error_message },
    resourceId: row.content_item_id,
    readAt: null,
  };
}

function mapNotificationToFeedEvent(
  payload: RealtimePostgresChangesPayload<NotificationRow>,
): FeedEvent | null {
  const row = payload.new as NotificationRow | undefined;
  if (!row) return null;

  return {
    id: row.id,
    type: (row.category as FeedEvent['type']) ?? 'connection_change',
    platform: null,
    message: row.message ?? row.title,
    timestamp: row.created_at,
    category: row.category,
    metadata: row.metadata,
    resourceId: row.resource_id,
    readAt: row.read_at,
  };
}

// ---------------------------------------------------------------------------
// Hook: useRealtimeFeed
// ---------------------------------------------------------------------------

/**
 * Subscribes to Supabase Realtime for publish_jobs and notifications changes
 * scoped to a single account. Prepends new events to the feed, capped at 50.
 */
export function useRealtimeFeed(
  accountId: string,
  initialEvents: FeedEvent[],
): FeedEvent[] {
  const [events, setEvents] = useState<FeedEvent[]>(initialEvents);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`activity-feed:${accountId}`)
      .on<PublishJobRow>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'publish_jobs',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const event = mapPublishJobToFeedEvent(payload);
          if (event) {
            setEvents((prev) => [event, ...prev].slice(0, MAX_FEED_ITEMS));
          }
        },
      )
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const event = mapNotificationToFeedEvent(payload);
          if (event) {
            setEvents((prev) => [event, ...prev].slice(0, MAX_FEED_ITEMS));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return events;
}

// ---------------------------------------------------------------------------
// Hook: useFailedPublishCount
// ---------------------------------------------------------------------------

/**
 * Tracks the count of failed publish jobs in realtime via Supabase Realtime.
 * Increments when a job transitions to 'failed', decrements when it leaves 'failed'.
 */
export function useFailedPublishCount(
  accountId: string,
  initialCount: number,
): number {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`failures:${accountId}`)
      .on<PublishJobRow>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'publish_jobs',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const newRow = payload.new as PublishJobRow | undefined;
          const oldRow = payload.old as Partial<PublishJobRow> | undefined;

          if (newRow?.status === 'failed') {
            setCount((prev) => prev + 1);
          } else if (oldRow?.status === 'failed' && newRow?.status !== 'failed') {
            setCount((prev) => Math.max(0, prev - 1));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return count;
}
