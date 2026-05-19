/**
 * Notification domain types — used by realtime feed, activity feed, and notification badge.
 * Database columns are snake_case; these interfaces reflect the raw DB shape for Realtime payloads.
 */

export type NotificationUrgency = 'urgent' | 'standard';

export type FeedEventType =
  | 'publish_success'
  | 'publish_failure'
  | 'publish_retry'
  | 'token_expiry'
  | 'connection_change'
  | 'weekly_materialised'
  | 'media_derivative_skipped'
  | 'media_derivative_failed';

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  platform: string | null;
  message: string;
  timestamp: string;
  category: string | null;
  metadata: Record<string, unknown> | null;
  resourceId: string | null;
  readAt: string | null;
}

export interface NotificationRow {
  id: string;
  account_id: string;
  urgency: NotificationUrgency;
  title: string;
  body: string | null;
  message: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  resource_type: string | null;
  resource_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface PublishJobRow {
  id: string;
  account_id: string;
  content_item_id: string;
  platform: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
