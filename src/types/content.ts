/**
 * Content domain types — maps to content_items table and related enums.
 * Database columns are snake_case; TypeScript properties are camelCase.
 * Always use fromDb<T>() when converting raw DB rows.
 */

export type ContentType = 'instant_post' | 'story' | 'event' | 'promotion' | 'weekly_recurring';

export type ContentStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'queued' | 'publishing' | 'published' | 'failed';

export type Platform = 'facebook' | 'instagram' | 'gbp';

export interface ContentItem {
  id: string;
  accountId: string;
  contentType: ContentType;
  status: ContentStatus;
  title: string | null;
  bodyDraft: Record<string, unknown> | null;
  campaignName: string | null;
  scheduledAt: Date | null;
  eventDate: string | null;       // ISO date string (date only)
  eventEndDate: string | null;    // ISO date string (date only)
  couponCode: string | null;
  recurringDayOfWeek: number | null;
  autoConfirm: boolean;
  aiGenerationParams: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentItemVersion {
  id: string;
  contentItemId: string;
  accountId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  createdAt: Date;
}

/** AI-generated platform-specific copy */
export interface PlatformCopy {
  facebook: { body: string; ctaText?: string; hashtags?: string[] };
  instagram: { body: string; hashtags?: string[]; linkInBioLine?: string };
  gbp: { body: string; ctaAction?: string };
}

/** Draft state persisted in content_items.body_draft (D-03) */
export interface DraftState {
  step: number;
  contentType: ContentType;
  brief: Record<string, unknown>;
  generatedCopy?: PlatformCopy;
  selectedMediaIds?: string[];
  scheduledAt?: string;
}
