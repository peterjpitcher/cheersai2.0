/**
 * Content domain types — maps to content_items table and related enums.
 * Database columns are snake_case; TypeScript properties are camelCase.
 * Always use fromDb<T>() when converting raw DB rows.
 */

export type ContentType = 'instant_post' | 'story' | 'event' | 'promotion' | 'weekly_recurring';

export type ContentStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'queued' | 'publishing' | 'published' | 'posted' | 'failed';

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
  thumbnailUrl: string | null;
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

/** A single time slot selected by the user in the multi-date schedule step */
export interface ScheduleSlot {
  key: string;
  date: string;           // YYYY-MM-DD in Europe/London
  time: string;           // HH:mm in Europe/London
  label?: string;
  source: 'suggestion' | 'manual' | 'migrated';
  suggestionId?: string;
}

/** AI-generated copy for a single schedule slot (one per slot in the wizard) */
export interface SlotGeneratedCopy {
  slotKey: string;
  scheduledAt: string | null;  // ISO timestamp, null only for "post now"
  label?: string;
  copy: PlatformCopy | null;
  warnings?: string[];
  error?: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  /** Whether the user has reviewed and approved this slot for scheduling */
  approved?: boolean;
  /** Media attached to this slot (defaults to the wizard-level selection) */
  mediaIds?: string[];
}

/** Context snapshot used to detect stale generation when slots or media change */
export interface GenerationBatchContext {
  mediaIds: string[];
  slots: Array<{ key: string; date: string; time: string; label?: string }>;
}

/** Draft state persisted in content_items.body_draft (D-03) */
export interface DraftState {
  step: number;
  contentType: ContentType;
  brief: Record<string, unknown>;
  selectedMediaIds?: string[];
  // Multi-slot (canonical)
  selectedSlots?: ScheduleSlot[];
  generatedSlotCopies?: SlotGeneratedCopy[];
  lastGenerationContext?: GenerationBatchContext;
  // Legacy single-slot (kept for backwards compat on draft resume)
  scheduledAt?: string;
  generatedCopy?: PlatformCopy;
}
