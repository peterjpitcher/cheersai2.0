---
title: Database Schema
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/database
related:
  - "[[RLS Policies]]"
  - "[[Migrations]]"
---

← [[_Index]] / [[_Database MOC]]

# Database Schema

All tables in the `public` schema. RLS is enabled on all tables.

```mermaid
erDiagram
  accounts {
    uuid id PK
    text email UK
    text display_name
    text timezone
    timestamptz created_at
    timestamptz updated_at
  }
  brand_profile {
    uuid account_id PK FK
    numeric tone_formal
    numeric tone_playful
    text[] key_phrases
    text[] banned_topics
    text[] banned_phrases
    text[] default_hashtags
    text[] default_emojis
    text instagram_signature
    text facebook_signature
    text gbp_cta
    timestamptz updated_at
  }
  posting_defaults {
    uuid account_id PK FK
    text facebook_location_id
    text instagram_location_id
    text gbp_location_id
    jsonb notifications
    text gbp_cta_standard
    text gbp_cta_event
    text gbp_cta_offer
  }
  social_connections {
    uuid id PK
    uuid account_id FK
    text provider
    text status
    text access_token
    text refresh_token
    timestamptz expires_at
    text display_name
    jsonb metadata
    timestamptz last_synced_at
  }
  media_assets {
    uuid id PK
    uuid account_id FK
    text storage_path
    text file_name
    text media_type
    text mime_type
    bigint size_bytes
    text[] tags
    jsonb derived_variants
    timestamptz hidden_at
    timestamptz uploaded_at
  }
  campaigns {
    uuid id PK
    uuid account_id FK
    text name
    text campaign_type
    timestamptz start_at
    timestamptz end_at
    uuid hero_media_id FK
    boolean auto_confirm
    text status
    jsonb metadata
  }
  content_items {
    uuid id PK
    uuid campaign_id FK
    uuid account_id FK
    text platform
    text placement
    timestamptz scheduled_for
    text status
    jsonb prompt_context
    boolean auto_generated
    timestamptz deleted_at
  }
  content_variants {
    uuid id PK
    uuid content_item_id FK
    text body
    uuid[] media_ids
    jsonb preview_data
    jsonb validation
    timestamptz updated_at
  }
  publish_jobs {
    uuid id PK
    uuid content_item_id FK
    uuid variant_id FK
    integer attempt
    text status
    text last_error
    jsonb provider_response
    text placement
    timestamptz next_attempt_at
  }
  notifications {
    uuid id PK
    uuid account_id FK
    text category
    text message
    timestamptz read_at
    jsonb metadata
  }
  oauth_states {
    uuid state PK
    text provider
    text auth_code
    text error
    text redirect_to
    timestamptz used_at
    timestamptz created_at
  }

  accounts ||--o| brand_profile : "1-1"
  accounts ||--o| posting_defaults : "1-1"
  accounts ||--o{ social_connections : "1-many"
  accounts ||--o{ media_assets : "1-many"
  accounts ||--o{ campaigns : "1-many"
  accounts ||--o{ content_items : "1-many"
  accounts ||--o{ notifications : "1-many"
  campaigns ||--o{ content_items : "1-many"
  content_items ||--o{ content_variants : "1-many"
  content_items ||--o{ publish_jobs : "1-many"
```

## Table Details

### `accounts`
Central identity table. One row per user account. Created/upserted on every authenticated request by `ensureAccountRecord()`. The `id` matches the Supabase Auth `user.id` or a pre-provisioned `account_id` from `app_metadata`.

### `brand_profile`
One-to-one with `accounts`. Stores the AI content generation settings: tone sliders (0–1 numeric range), key phrases to include, banned topics/phrases, default hashtags/emojis, per-platform signatures, and GBP CTA type. Has a `banned_phrases` column (added via later migration) — note initial migration is missing this column.

### `posting_defaults`
One-to-one with `accounts`. Stores location IDs for tagging posts, notification preferences (JSONB), and GBP CTA defaults per post type. Auto-inserted with defaults on account creation.

### `social_connections`
Unique per `(account_id, provider)`. Stores OAuth tokens (`access_token`, `refresh_token`, `expires_at`). `metadata` JSONB stores provider-specific identifiers:
- Facebook: `{ pageId }`
- Instagram: `{ pageId, igBusinessId, instagramUsername }`
- GBP: `{ locationId }` — must be canonical form `locations/{numericId}`

Status values: `active`, `expiring`, `needs_action`.

### `media_assets`
Uploaded images and videos. `storage_path` references a file in the `media-assets` Supabase Storage bucket. `derived_variants` JSONB holds paths to processed variants (story crop, thumbnails). `hidden_at` allows soft-hiding of assets from the library without deletion.

### `campaigns`
A campaign groups related content items. Types: `event`, `promotion`, `weekly`, `instant`, `story_series`. `metadata` holds campaign-type-specific data (e.g. event start time, promotion dates).

### `content_items`
A single post for one platform on one date. `placement` is `feed` or `story`. `prompt_context` stores the generation context (event details, slot, phase) for re-generation. `deleted_at` enables soft-delete (trash).

### `content_variants`
The actual copy for a content item. `body` is the generated/edited text. `media_ids` is a UUID array referencing `media_assets`. There is typically one variant per content item but the schema supports multiple.

### `publish_jobs`
Tracks the publishing attempt. `variant_id` references the specific variant to publish. Processed by the `publish-queue` Supabase Edge Function. Status values: `queued`, `in_progress`, `succeeded`, `failed`. `provider_response` stores the raw API response on success or failure.

### `notifications`
Activity log entries. `category` drives the display level in the UI (see `mapCategoryToLevel()` in `src/lib/planner/data.ts`). Categories include: `publish_failed`, `publish_retry`, `connection_needs_action`, `connection_metadata_updated`, `connection_reconnected`.

### `oauth_states`
CSRF-safe state tokens for OAuth flows. Unused states expire after 30 minutes; used states after 24 hours. Cleaned up on each new OAuth initiation.

### Additional Tables (added via migrations)

| Table | Added | Purpose |
|-------|-------|---------|
| `link_in_bio_profiles` | 20250214 | Public link-in-bio page profile |
| `link_in_bio_tiles` | 20250214 | Individual link tiles on the profile |
| `gbp_reviews` | (implicit) | Google reviews synced via cron |
| `user_auth_snapshots` | 20250216 | Security hardening |
