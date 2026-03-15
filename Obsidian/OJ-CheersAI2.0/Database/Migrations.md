---
title: Migrations
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/database
related:
  - "[[Schema]]"
---

← [[_Index]] / [[_Database MOC]]

# Migrations

All migrations live in `supabase/migrations/`. Apply with `npx supabase db push`.

| Migration | Date | Purpose |
|-----------|------|---------|
| `20250203120000_initial.sql` | 2025-02-03 | Core schema: accounts, brand_profile, posting_defaults, social_connections, media_assets, campaigns, content_items, content_variants, publish_jobs, notifications |
| `20250203121500_add_metadata_to_social_connections.sql` | 2025-02-03 | Added `metadata` JSONB column to `social_connections` |
| `20250204100000_add_connection_metadata.sql` | 2025-02-04 | Extended connection metadata |
| `20250204103000_add_media_processing_columns.sql` | 2025-02-04 | Added `derived_variants` JSONB to `media_assets` |
| `20250205150000_create_oauth_states.sql` | 2025-02-05 | Created `oauth_states` table for secure OAuth flow |
| `20250210123000_allow_skipped_media_status.sql` | 2025-02-10 | Extended `media_assets` status enum |
| `20250212150000_enable_rls.sql` | 2025-02-12 | Enabled RLS on all tables |
| `20250213104500_allow_account_insert.sql` | 2025-02-13 | RLS policy: allow authenticated users to insert their own account row |
| `20250213113000_media_storage_policy.sql` | 2025-02-13 | Supabase Storage bucket RLS for `media-assets` |
| `20250213120000_add_content_variant_unique.sql` | 2025-02-13 | Added unique constraint on `content_variants` |
| `20250214110000_add_link_in_bio_entities.sql` | 2025-02-14 | Created `link_in_bio_profiles` and `link_in_bio_tiles` tables |
| `20250214115000_add_directions_url_to_link_in_bio_profiles.sql` | 2025-02-14 | Added `directions_url` to `link_in_bio_profiles` |
| `20250216160000_security_hardening.sql` | 2025-02-16 | Security hardening: `user_auth_snapshots` table, RLS tightening |
| `20250216170000_user_auth_snapshot_rls_fix.sql` | 2025-02-16 | RLS fix for `user_auth_snapshots` |
| `20250218090000_add_story_placement.sql` | 2025-02-18 | Added `placement` column to `content_items` (feed/story) |
| `20250218100000_add_variant_id_to_publish_jobs.sql` | 2025-02-18 | Added `variant_id` FK to `publish_jobs` |
| `20250302090000_add_content_deleted_at.sql` | 2025-03-02 | Soft-delete: added `deleted_at` to `content_items` |
| `20250314090000_add_media_assets_hidden_at.sql` | 2025-03-14 | Added `hidden_at` to `media_assets` for library hiding |
| `20250315120000_publish_pipeline_hardening.sql` | 2025-03-15 | Publish pipeline improvements |
| `20251021143000_update_campaign_type_check.sql` | 2025-10-21 | Extended `campaign_type` check constraint |

> [!NOTE]
> The initial migration (`20250203120000_initial.sql`) is the source of truth for the core schema. All subsequent migrations add columns, tables, or policies incrementally. The full schema can be constructed by applying all migrations in sequence.
