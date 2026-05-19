/**
 * Centralised notification urgency classification and email routing logic.
 * Per D-05, D-06, D-09: urgent categories get email + in-app,
 * standard categories get in-app only.
 */

export type NotificationCategory =
  | 'publish_failed'
  | 'publish_success'
  | 'publish_retry'
  | 'story_publish_failed'
  | 'story_publish_succeeded'
  | 'story_publish_retry'
  | 'connection_expiring'
  | 'connection_expired'
  | 'connection_disconnected'
  | 'connection_reconnected'
  | 'connection_needs_action'
  | 'connection_metadata_updated'
  | 'media_derivative_failed'
  | 'media_derivative_skipped'
  | 'weekly_materialised';

type Urgency = 'urgent' | 'standard';

const URGENT_CATEGORIES: ReadonlySet<string> = new Set([
  'publish_failed',
  'story_publish_failed',
  'connection_expired',
  'connection_disconnected',
  'connection_needs_action',
]);

const EMAIL_CATEGORIES: ReadonlySet<string> = new Set([
  'publish_failed',
  'story_publish_failed',
  'connection_expired',
  'connection_disconnected',
  'connection_expiring', // email when <= 4 days per NOTIF-04
]);

/**
 * Classify the urgency of a notification by its category.
 * Urgent notifications are surfaced prominently in the UI and may trigger email.
 */
export function classifyUrgency(category: string): Urgency {
  return URGENT_CATEGORIES.has(category) ? 'urgent' : 'standard';
}

/**
 * Determine whether a notification category should also trigger an email.
 */
export function shouldSendEmail(category: string): boolean {
  return EMAIL_CATEGORIES.has(category);
}

/**
 * Check posting_defaults.notifications preferences to see if email is enabled.
 * Key mapping:
 *   publish failures -> emailFailures
 *   connection events -> emailConnections
 * Defaults to true if preference not set.
 */
export function isEmailEnabledForCategory(
  category: string,
  preferences: Record<string, unknown> | null | undefined,
): boolean {
  if (!preferences) return true; // default: send emails

  if (category.startsWith('publish_') || category.startsWith('story_publish_')) {
    return preferences.emailFailures !== false;
  }
  if (category.startsWith('connection_')) {
    return preferences.emailConnections !== false;
  }
  return true;
}
