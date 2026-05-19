/**
 * Provider domain types — shared across all platform adapters.
 * Used by publishing pipeline, connection health, and OAuth flows.
 */

export type ProviderPlatform = 'facebook' | 'instagram' | 'gbp';

export interface PublishResult {
  platformPostId: string;
  url?: string;
}

export interface ContentPayload {
  text: string;
  mediaUrls?: string[];
  contentType: 'instant_post' | 'story' | 'event' | 'promotion' | 'carousel';
  eventDetails?: { title: string; startDate: string; endDate: string };
  offerDetails?: { couponCode: string; redeemUrl?: string; terms?: string };
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string; code: string }[];
}

export type ConnectionHealth = 'green' | 'amber' | 'red';

export interface ConnectionHealthSummary {
  provider: ProviderPlatform;
  health: ConnectionHealth;
  accountName: string | null;
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  connectionId: string;
}
