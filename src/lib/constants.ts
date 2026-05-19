export const OWNER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
export const OWNER_EMAIL = "peter@orangejelly.co.uk";
export const OWNER_DISPLAY_NAME = "CheersAI Owner";
export const DEFAULT_TIMEZONE = "Europe/London";
export const DEFAULT_POST_TIME = "12:00";
export const STORY_POST_TIME = "07:00";

export const MEDIA_BUCKET = "media";

/** All content types matching the content_type database enum */
export const CONTENT_TYPES = ['instant_post', 'story', 'event', 'promotion', 'weekly_recurring'] as const;

/** All platforms matching the platform database enum */
export const PLATFORMS = ['facebook', 'instagram', 'gbp'] as const;

/** All content statuses matching the content_status database enum */
export const CONTENT_STATUSES = ['draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed'] as const;
