---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# Data Model

Tables referenced in application code. Column details are inferred from usage patterns in server actions, queries, and type definitions. For definitive schema, query `information_schema.columns` against the live database.

## Core Tables

### accounts

Central tenant table. Every authenticated user belongs to an account.

- Referenced by: settings actions, posting defaults, all `requireAuthContext()` calls
- Key columns (inferred): `id`, `account_id`

### brand_profile

Brand voice, tone, and identity settings per account.

- Referenced by: `updateBrandProfile` in settings actions
- Key columns (inferred): `account_id`, brand voice fields

### posting_defaults

Default scheduling preferences (time slots, platforms, frequency).

- Referenced by: `updatePostingDefaults` in settings actions
- Key columns (inferred): `account_id`, default time/platform preferences

## Content Tables

### content_items

Primary content entity. Represents a single piece of content across its lifecycle (draft -> scheduled -> published -> trashed).

- Referenced by: planner actions, create actions, content actions
- Key columns (inferred): `id`, `account_id`, `status`, `scheduled_at`, `body`, `media_url`, `trashed_at`, `created_at`
- High usage: most-referenced table across server actions

### content_variants

Platform-specific adaptations of a content item (e.g., Facebook version, Instagram version, GBP version).

- Referenced by: planner actions (approve, restore, update)
- Key columns (inferred): `id`, `content_item_id`, `platform`, `body`

### content_templates

Reusable content templates for quick creation.

- Referenced by: template-actions (list, save, delete, increment use count)
- Key columns (inferred): `id`, `account_id`, `name`, `body`, `use_count`

### publish_jobs

Tracks the publishing lifecycle of content items via the QStash pipeline.

- Referenced by: planner actions, content actions, publish retry
- Key columns (inferred): `id`, `content_item_id`, `status`, `scheduled_at`, `published_at`, `error`

### notifications

In-app notifications for content events (approvals, failures, etc.).

- Referenced by: planner actions (dismiss, create on approve/delete)
- Key columns (inferred): `id`, `account_id`, `type`, `content_item_id`, `read`

## Media Tables

### media_assets

Uploaded images, videos, and other media files stored in Supabase Storage.

- Referenced by: library actions, media actions, planner content media, tournament picker
- Key columns (inferred): `id`, `account_id`, `path`, `filename`, `mime_type`, `tags`, `hidden`, `created_at`
- Storage bucket used for file storage with signed URLs

## Social & Integration Tables

### social_connections

OAuth connections to social platforms (Facebook, Instagram, GBP).

- Referenced by: connections actions (initiate, complete, disconnect, update metadata)
- Key columns (inferred): `id`, `account_id`, `provider`, `access_token`, `refresh_token`, `expires_at`, `metadata`

### oauth_states

Temporary OAuth state storage for CSRF protection during OAuth flows.

- Referenced by: connections actions (initiateOAuthConnect)
- Key columns (inferred): `id`, `state`, `provider`, `account_id`, `created_at`

### meta_ad_accounts

Facebook/Instagram ad account configuration for campaign management.

- Referenced by: connections-ads actions (fetch, select, status)
- Key columns (inferred): `id`, `account_id`, `meta_account_id`, `name`, `status`

### campaigns

Meta advertising campaigns with performance tracking.

- Referenced by: campaigns actions (generate, save, publish, pause, sync, optimise, delete)
- Key columns (inferred): `id`, `account_id`, `name`, `status`, `objective`, `budget`, `performance_data`

### management_app_connections

Connections to external venue management systems.

- Referenced by: `updateManagementConnectionSettings` in settings actions
- Key columns (inferred): `id`, `account_id`, `provider`, `settings`

## Link-in-Bio Tables

### link_in_bio_profiles

Public landing page configuration per account.

- Referenced by: link-in-bio actions (save, publish, unpublish, slug check)
- Key columns (inferred): `id`, `account_id`, `slug`, `title`, `published`

### link_in_bio_tiles

Individual tiles/links on a link-in-bio page.

- Referenced by: link-in-bio actions (save, delete, reorder)
- Key columns (inferred): `id`, `profile_id`, `title`, `url`, `position`, `type`

## Environment Variables

### Database Access

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Anon key (respects RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Service role (bypasses RLS) |

### Encryption

| Variable | Scope | Purpose |
|----------|-------|---------|
| `TOKEN_VAULT_KEY` | Server | AES-256-GCM key for OAuth token encryption |
| `TOKEN_VAULT_KEY_VERSION` | Server | Key version for rotation support |
