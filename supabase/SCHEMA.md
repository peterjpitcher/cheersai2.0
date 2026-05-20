# CheersAI 2.0 Database Schema

Tables: 20 | Enums: 5

## `accounts`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `auth_user_id` | `uuid` | NO |  |
| `business_name` | `text` | YES |  |
| `timezone` | `text` | NO | 'Europe/London' |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `analytics_snapshots`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `publish_job_id` | `uuid` | YES |  |
| `platform` | `text` | NO |  |
| `impressions` | `integer` | YES |  |
| `reach` | `integer` | YES |  |
| `engagement_count` | `integer` | YES |  |
| `engagement_rate` | `numeric(5,4)` | YES |  |
| `clicks` | `integer` | YES |  |
| `shares` | `integer` | YES |  |
| `comments` | `integer` | YES |  |
| `snapshot_date` | `date` | NO |  |
| `raw_data` | `jsonb` | YES |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`, `publish_job_id` -> `publish_jobs(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `audit_log`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `user_id` | `uuid` | YES |  |
| `operation_type` | `text` | NO |  |
| `resource_type` | `text` | NO |  |
| `resource_id` | `uuid` | YES |  |
| `operation_status` | `text` | NO | 'success' |
| `details` | `jsonb` | YES |  |
| `correlation_id` | `text` | YES |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (4 policies)  
**Audit:** created_at

## `content_item_versions`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `content_item_id` | `uuid` | NO |  |
| `account_id` | `uuid` | NO |  |
| `version_number` | `integer` | NO |  |
| `snapshot` | `jsonb` | NO |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `content_item_id` -> `content_items(id)`, `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `content_items`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `content_type` | `public.content_type` | NO |  |
| `status` | `public.content_status` | NO | 'draft' |
| `title` | `text` | YES |  |
| `body_draft` | `jsonb` | YES |  |
| `campaign_name` | `text` | YES |  |
| `scheduled_at` | `timestamptz` | YES |  |
| `event_date` | `date` | YES |  |
| `event_end_date` | `date` | YES |  |
| `coupon_code` | `text` | YES |  |
| `recurring_day_of_week` | `integer` | YES | CHECK (0..6) |
| `auto_confirm` | `boolean` | NO | false |
| `ai_generation_params` | `jsonb` | YES |  |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `content_media_attachments`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `content_item_id` | `uuid` | NO |  |
| `media_id` | `uuid` | NO |  |
| `position` | `integer` | NO | 0 |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `content_item_id` -> `content_items(id)`, `media_id` -> `media_library(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `gbp_daily_metrics`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `social_connection_id` | `uuid` | YES |  |
| `metric_date` | `date` | NO |  |
| `search_views` | `integer` | YES |  |
| `map_views` | `integer` | YES |  |
| `website_clicks` | `integer` | YES |  |
| `direction_requests` | `integer` | YES |  |
| `phone_calls` | `integer` | YES |  |
| `raw_data` | `jsonb` | YES |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`, `social_connection_id` -> `social_connections(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `link_in_bio_clicks`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `profile_id` | `uuid` | NO |  |
| `tile_id` | `uuid` | YES |  |
| `click_type` | `text` | NO | 'tile' |
| `referrer` | `text` | YES |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `profile_id` -> `link_in_bio_profiles(id)`  
**RLS:** Enabled (4 policies)  
**Audit:** created_at

## `link_in_bio_page_views`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `profile_id` | `uuid` | NO |  |
| `referrer` | `text` | YES |  |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `profile_id` -> `link_in_bio_profiles(id)`  
**RLS:** Enabled (4 policies)  
**Audit:** created_at

## `link_in_bio_profiles`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `slug` | `text` | NO |  |
| `bio` | `text` | YES |  |
| `logo_url` | `text` | YES |  |
| `hero_image_url` | `text` | YES |  |
| `brand_color_primary` | `text` | YES |  |
| `brand_color_secondary` | `text` | YES |  |
| `contact_email` | `text` | YES |  |
| `contact_phone` | `text` | YES |  |
| `contact_website` | `text` | YES |  |
| `is_published` | `boolean` | NO | false |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |
| `display_name` | `text` | YES |  |
| `hero_media_id` | `uuid` | YES |  |
| `theme` | `jsonb` | NO | '{}' |
| `phone_number` | `text` | YES |  |
| `whatsapp_number` | `text` | YES |  |
| `booking_url` | `text` | YES |  |
| `menu_url` | `text` | YES |  |
| `parking_url` | `text` | YES |  |
| `directions_url` | `text` | YES |  |
| `facebook_url` | `text` | YES |  |
| `instagram_url` | `text` | YES |  |
| `website_url` | `text` | YES |  |
| `template` | `text` | NO | 'classic' |
| `font_family` | `text` | NO | 'inter' |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `link_in_bio_tiles`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `profile_id` | `uuid` | NO |  |
| `account_id` | `uuid` | NO |  |
| `title` | `text` | NO |  |
| `url` | `text` | YES |  |
| `image_url` | `text` | YES |  |
| `position` | `integer` | NO | 0 |
| `is_visible` | `boolean` | NO | true |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |
| `subtitle` | `text` | YES |  |
| `cta_label` | `text` | NO | 'Visit' |
| `cta_url` | `text` | YES |  |
| `media_asset_id` | `uuid` | YES |  |
| `enabled` | `boolean` | NO | true |
| `tile_type` | `text` | NO | 'link' |
| `embed_data` | `jsonb` | YES |  |

**FK:** `profile_id` -> `link_in_bio_profiles(id)`, `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `media_library`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `file_name` | `text` | NO |  |
| `file_url` | `text` | NO |  |
| `file_type` | `text` | NO |  |
| `file_size_bytes` | `integer` | YES |  |
| `width` | `integer` | YES |  |
| `height` | `integer` | YES |  |
| `tags` | `text[]` | YES | '{}' |
| `created_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `notifications`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `urgency` | `public.notification_urgency` | NO | 'standard' |
| `title` | `text` | NO |  |
| `body` | `text` | YES |  |
| `category` | `text` | YES |  |
| `resource_type` | `text` | YES |  |
| `resource_id` | `uuid` | YES |  |
| `read_at` | `timestamptz` | YES |  |
| `dismissed_at` | `timestamptz` | YES |  |
| `created_at` | `timestamptz` | NO | now() |
| `message` | `text` | YES |  |
| `metadata` | `jsonb` | YES | '{}' |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at

## `oauth_states`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `created_by` | `uuid` | NO | auth.uid() |
| `state` | `text` | NO |  |
| `provider` | `public.platform` | NO |  |
| `redirect_to` | `text` | YES |  |
| `used_at` | `timestamptz` | YES |  |
| `expires_at` | `timestamptz` | NO | (now() + interval '10 minutes') |
| `created_at` | `timestamptz` | NO | now() |

**RLS:** Enabled (6 policies)  
**Audit:** created_by, created_at

## `profiles`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `display_name` | `text` | YES |  |
| `avatar_url` | `text` | YES |  |
| `brand_voice_tone` | `text` | YES |  |
| `brand_voice_style` | `text` | YES |  |
| `default_cta` | `text` | YES |  |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `provider_rate_limits`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `provider` | `text` | NO |  |
| `endpoint` | `text` | NO |  |
| `window_start` | `timestamptz` | NO |  |
| `request_count` | `integer` | NO | 0 |
| `limit_ceiling` | `integer` | NO |  |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (6 policies)  
**Audit:** created_at, updated_at

## `publish_attempts`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `publish_job_id` | `uuid` | NO |  |
| `account_id` | `uuid` | NO |  |
| `attempt_number` | `integer` | NO |  |
| `status` | `text` | NO |  |
| `started_at` | `timestamptz` | NO | now() |
| `completed_at` | `timestamptz` | YES |  |
| `error_details` | `jsonb` | YES |  |
| `platform_response` | `jsonb` | YES |  |

**FK:** `publish_job_id` -> `publish_jobs(id)`, `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)

## `publish_jobs`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `content_item_id` | `uuid` | NO |  |
| `platform` | `public.platform` | NO |  |
| `idempotency_key` | `text` | NO |  |
| `status` | `public.content_status` | NO | 'queued' |
| `scheduled_at` | `timestamptz` | NO |  |
| `started_at` | `timestamptz` | YES |  |
| `completed_at` | `timestamptz` | YES |  |
| `error_message` | `text` | YES |  |
| `error_code` | `text` | YES |  |
| `retry_count` | `integer` | NO | 0 |
| `max_retries` | `integer` | NO | 4 |
| `platform_post_id` | `text` | YES |  |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**FK:** `account_id` -> `accounts(id)`, `content_item_id` -> `content_items(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `social_connections`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `account_id` | `uuid` | NO |  |
| `platform` | `public.platform` | NO |  |
| `platform_account_id` | `text` | NO |  |
| `platform_account_name` | `text` | YES |  |
| `status` | `public.connection_status` | NO | 'active' |
| `scopes` | `text[]` | YES |  |
| `token_expires_at` | `timestamptz` | YES |  |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |
| `metadata` | `jsonb` | YES | '{}' |
| `display_name` | `text` | YES |  |
| `last_synced_at` | `timestamptz` | YES |  |

**FK:** `account_id` -> `accounts(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## `token_vault`

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| `id` | `uuid` | YES | gen_random_uuid() |
| `social_connection_id` | `uuid` | NO |  |
| `token_type` | `text` | NO |  |
| `ciphertext` | `text` | NO |  |
| `iv` | `text` | NO |  |
| `tag` | `text` | NO |  |
| `key_version` | `integer` | NO | 1 |
| `created_at` | `timestamptz` | NO | now() |
| `updated_at` | `timestamptz` | NO | now() |

**FK:** `social_connection_id` -> `social_connections(id)`  
**RLS:** Enabled (8 policies)  
**Audit:** created_at, updated_at

## Enum Types

- **`content_status`**: `draft`, `review`, `approved`, `scheduled`, `queued`, `publishing`, `published`, `failed`
- **`content_type`**: `instant_post`, `story`, `event`, `promotion`, `weekly_recurring`
- **`platform`**: `facebook`, `instagram`, `gbp`
- **`connection_status`**: `active`, `expiring`, `expired`, `disconnected`
- **`notification_urgency`**: `urgent`, `standard`