export const OWNER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
export const OWNER_EMAIL = "peter@orangejelly.co.uk";
export const OWNER_DISPLAY_NAME = "CheersAI Owner";
export const DEFAULT_TIMEZONE = "Europe/London";
export const DEFAULT_POST_TIME = "12:00";
export const STORY_POST_TIME = "07:00";
/**
 * Maximum number of occurrences a single weekly recurring campaign may schedule.
 * Higher than the generic per-campaign slot cap because a weekly series spans a
 * long run (e.g. a full year at one post per week). Each occurrence still has its
 * copy generated upfront in the wizard, so this also bounds the review burden.
 */
export const WEEKLY_MAX_OCCURRENCES = 52;

export const MEDIA_BUCKET = "media";

/** All content types matching the content_type database enum */
export const CONTENT_TYPES = ['instant_post', 'story', 'event', 'promotion', 'weekly_recurring'] as const;

/** All platforms the app publishes to */
export const PLATFORMS = ['facebook', 'instagram'] as const;

/** All content statuses matching the content_status database enum */
export const CONTENT_STATUSES = ['draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed'] as const;
