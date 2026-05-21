# V2 Schema Objects

Complete inventory of every object created by the 10 v2 migrations (`00000000000000` through `00000000000009`).

---

## Types / Enums

| Type | Values | Source |
|------|--------|--------|
| `content_status` | `'draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed'` | 000 |
| `content_type` | `'instant_post', 'story', 'event', 'promotion', 'weekly_recurring'` | 000 |
| `platform` | `'facebook', 'instagram', 'gbp'` | 000 |
| `connection_status` | `'active', 'expiring', 'expired', 'disconnected'` | 000 |
| `notification_urgency` | `'urgent', 'standard'` | 003 |

---

## Tables

### accounts (migration 000)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| auth_user_id | uuid | UNIQUE NOT NULL, FK auth.users(id) ON DELETE CASCADE |
| business_name | text | |
| timezone | text | NOT NULL DEFAULT 'Europe/London' |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

### profiles (migration 000)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| display_name | text | |
| avatar_url | text | |
| brand_voice_tone | text | |
| brand_voice_style | text | |
| default_cta | text | |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

### social_connections (migration 000, altered in 007)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| platform | platform (enum) | NOT NULL |
| platform_account_id | text | NOT NULL |
| platform_account_name | text | |
| status | connection_status (enum) | NOT NULL DEFAULT 'active' |
| scopes | text[] | |
| token_expires_at | timestamptz | |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |
| metadata | jsonb | DEFAULT '{}' (added in 007) |
| display_name | text | (added in 007) |
| last_synced_at | timestamptz | (added in 007) |

### token_vault (migration 000)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| social_connection_id | uuid | NOT NULL, FK social_connections(id) ON DELETE CASCADE |
| token_type | text | NOT NULL, CHECK IN ('access', 'refresh') |
| ciphertext | text | NOT NULL |
| iv | text | NOT NULL |
| tag | text | NOT NULL |
| key_version | integer | NOT NULL DEFAULT 1 |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

### content_items (migration 001)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| content_type | content_type (enum) | NOT NULL |
| status | content_status (enum) | NOT NULL DEFAULT 'draft' |
| title | text | |
| body_draft | jsonb | |
| campaign_name | text | |
| scheduled_at | timestamptz | |
| event_date | date | |
| event_end_date | date | |
| coupon_code | text | |
| recurring_day_of_week | integer | CHECK BETWEEN 0 AND 6 |
| auto_confirm | boolean | NOT NULL DEFAULT false |
| ai_generation_params | jsonb | |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

### content_item_versions (migration 001)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| content_item_id | uuid | NOT NULL, FK content_items(id) ON DELETE CASCADE |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| version_number | integer | NOT NULL |
| snapshot | jsonb | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### media_library (migration 001)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| file_name | text | NOT NULL |
| file_url | text | NOT NULL |
| file_type | text | NOT NULL |
| file_size_bytes | integer | |
| width | integer | |
| height | integer | |
| tags | text[] | DEFAULT '{}' |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### content_media_attachments (migration 001)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| content_item_id | uuid | NOT NULL, FK content_items(id) ON DELETE CASCADE |
| media_id | uuid | NOT NULL, FK media_library(id) ON DELETE CASCADE |
| position | integer | NOT NULL DEFAULT 0 |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### publish_jobs (migration 002)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| content_item_id | uuid | NOT NULL, FK content_items(id) ON DELETE CASCADE |
| platform | platform (enum) | NOT NULL |
| idempotency_key | text | NOT NULL UNIQUE |
| status | content_status (enum) | NOT NULL DEFAULT 'queued' |
| scheduled_at | timestamptz | NOT NULL |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error_message | text | |
| error_code | text | |
| retry_count | integer | NOT NULL DEFAULT 0 |
| max_retries | integer | NOT NULL DEFAULT 4 |
| platform_post_id | text | |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

**Exclusion constraint**: `EXCLUDE USING gist (content_item_id WITH =, platform WITH =) WHERE (status IN ('queued', 'publishing'))` -- requires `btree_gist` extension.

### publish_attempts (migration 002)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| publish_job_id | uuid | NOT NULL, FK publish_jobs(id) ON DELETE CASCADE |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| attempt_number | integer | NOT NULL |
| status | text | NOT NULL, CHECK IN ('started', 'succeeded', 'failed') |
| started_at | timestamptz | NOT NULL DEFAULT now() |
| completed_at | timestamptz | |
| error_details | jsonb | |
| platform_response | jsonb | |

### audit_log (migration 002)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| user_id | uuid | FK auth.users(id) |
| operation_type | text | NOT NULL |
| resource_type | text | NOT NULL |
| resource_id | uuid | |
| operation_status | text | NOT NULL DEFAULT 'success' |
| details | jsonb | |
| correlation_id | text | |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### notifications (migration 003, altered in 008)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| urgency | notification_urgency (enum) | NOT NULL DEFAULT 'standard' |
| title | text | NOT NULL |
| body | text | |
| category | text | |
| resource_type | text | |
| resource_id | uuid | |
| read_at | timestamptz | |
| dismissed_at | timestamptz | |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| message | text | (added in 008) |
| metadata | jsonb | DEFAULT '{}' (added in 008) |

### analytics_snapshots (migration 004)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| publish_job_id | uuid | FK publish_jobs(id) ON DELETE SET NULL |
| platform | platform (enum) | NOT NULL |
| impressions | integer | |
| reach | integer | |
| engagement_count | integer | |
| engagement_rate | numeric(5,4) | |
| clicks | integer | |
| shares | integer | |
| comments | integer | |
| snapshot_date | date | NOT NULL |
| raw_data | jsonb | |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### gbp_daily_metrics (migration 004)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| social_connection_id | uuid | FK social_connections(id) ON DELETE SET NULL |
| metric_date | date | NOT NULL |
| search_views | integer | |
| map_views | integer | |
| website_clicks | integer | |
| direction_requests | integer | |
| phone_calls | integer | |
| raw_data | jsonb | |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### link_in_bio_profiles (migration 005, altered in 009)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL UNIQUE, FK accounts(id) ON DELETE CASCADE |
| slug | text | NOT NULL UNIQUE |
| bio | text | |
| logo_url | text | |
| hero_image_url | text | |
| brand_color_primary | text | |
| brand_color_secondary | text | |
| contact_email | text | |
| contact_phone | text | |
| contact_website | text | |
| is_published | boolean | NOT NULL DEFAULT false |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |
| display_name | text | (added in 009) |
| hero_media_id | uuid | (added in 009) |
| theme | jsonb | NOT NULL DEFAULT '{}' (added in 009) |
| phone_number | text | (added in 009) |
| whatsapp_number | text | (added in 009) |
| booking_url | text | (added in 009) |
| menu_url | text | (added in 009) |
| parking_url | text | (added in 009) |
| directions_url | text | (added in 009) |
| facebook_url | text | (added in 009) |
| instagram_url | text | (added in 009) |
| website_url | text | (added in 009) |
| template | text | NOT NULL DEFAULT 'classic' (added in 009) |
| font_family | text | NOT NULL DEFAULT 'inter' (added in 009) |

### link_in_bio_tiles (migration 005, altered in 009)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| profile_id | uuid | NOT NULL, FK link_in_bio_profiles(id) ON DELETE CASCADE |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| title | text | NOT NULL |
| url | text | |
| image_url | text | |
| position | integer | NOT NULL DEFAULT 0, CHECK BETWEEN 0 AND 11 |
| is_visible | boolean | NOT NULL DEFAULT true |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |
| subtitle | text | (added in 009) |
| cta_label | text | NOT NULL DEFAULT 'Visit' (added in 009) |
| cta_url | text | (added in 009) |
| media_asset_id | uuid | (added in 009) |
| enabled | boolean | NOT NULL DEFAULT true (added in 009) |
| tile_type | text | NOT NULL DEFAULT 'link' (added in 009) |
| embed_data | jsonb | (added in 009) |

### oauth_states (migration 007)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| created_by | uuid | NOT NULL DEFAULT auth.uid() |
| state | text | UNIQUE NOT NULL |
| provider | platform (enum) | NOT NULL |
| redirect_to | text | |
| used_at | timestamptz | |
| expires_at | timestamptz | NOT NULL DEFAULT (now() + interval '10 minutes') |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### provider_rate_limits (migration 007)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| account_id | uuid | NOT NULL, FK accounts(id) ON DELETE CASCADE |
| provider | platform (enum) | NOT NULL |
| endpoint | text | NOT NULL |
| window_start | timestamptz | NOT NULL |
| request_count | integer | NOT NULL DEFAULT 0 |
| limit_ceiling | integer | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

### link_in_bio_clicks (migration 009)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| profile_id | uuid | NOT NULL, FK link_in_bio_profiles(id) ON DELETE CASCADE |
| tile_id | uuid | FK link_in_bio_tiles(id) ON DELETE SET NULL |
| click_type | text | NOT NULL DEFAULT 'tile' |
| referrer | text | |
| created_at | timestamptz | NOT NULL DEFAULT now() |

### link_in_bio_page_views (migration 009)
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| profile_id | uuid | NOT NULL, FK link_in_bio_profiles(id) ON DELETE CASCADE |
| referrer | text | |
| created_at | timestamptz | NOT NULL DEFAULT now() |

---

## Functions

| Function | Source | Description |
|----------|--------|-------------|
| `set_updated_at()` | 000 | Trigger function: sets `updated_at = now()` on UPDATE |
| `increment_rate_limit(p_account_id uuid, p_provider platform, p_endpoint text, p_window_start timestamptz, p_limit_ceiling integer)` | 007 | Upsert rate limit counter with atomic increment |

---

## Indexes

| Index | Table | Columns | Source |
|-------|-------|---------|--------|
| `idx_accounts_auth_user_id` | accounts | (auth_user_id) | 000 |
| `idx_profiles_account_id` | profiles | (account_id) | 000 |
| `idx_social_connections_account_id` | social_connections | (account_id) | 000 |
| `idx_token_vault_connection_id` | token_vault | (social_connection_id) | 000 |
| `idx_content_items_account_status` | content_items | (account_id, status) | 001 |
| `idx_content_items_account_scheduled` | content_items | (account_id, scheduled_at) | 001 |
| `idx_content_item_versions_account` | content_item_versions | (account_id) | 001 |
| `idx_media_library_account` | media_library | (account_id) | 001 |
| `idx_publish_jobs_account_status` | publish_jobs | (account_id, status) | 002 |
| `idx_publish_jobs_scheduled_queued` | publish_jobs | (scheduled_at) WHERE status = 'queued' | 002 |
| `idx_publish_attempts_account` | publish_attempts | (account_id) | 002 |
| `idx_audit_log_account_created` | audit_log | (account_id, created_at DESC) | 002 |
| `idx_notifications_account_unread` | notifications | (account_id, read_at) | 003 |
| `idx_analytics_snapshots_account` | analytics_snapshots | (account_id) | 004 |
| `idx_gbp_daily_metrics_account` | gbp_daily_metrics | (account_id) | 004 |
| `idx_link_in_bio_tiles_account` | link_in_bio_tiles | (account_id) | 005 |
| `idx_oauth_states_state` | oauth_states | (state) | 007 |
| `idx_oauth_states_expires` | oauth_states | (expires_at) | 007 |
| `idx_oauth_states_cleanup` | oauth_states | (expires_at) | 007 |
| `idx_rate_limits_provider` | provider_rate_limits | (account_id, provider) | 007 |
| `idx_publish_jobs_failed` | publish_jobs | (account_id) WHERE status = 'failed' | 008 |
| `idx_link_in_bio_clicks_profile` | link_in_bio_clicks | (profile_id) | 009 |
| `idx_link_in_bio_clicks_created` | link_in_bio_clicks | (created_at) | 009 |
| `idx_link_in_bio_page_views_profile` | link_in_bio_page_views | (profile_id) | 009 |

---

## Triggers

| Trigger | Table | Event | Function | Source |
|---------|-------|-------|----------|--------|
| `trg_accounts_updated_at` | accounts | BEFORE UPDATE | set_updated_at | 000 |
| `trg_profiles_updated_at` | profiles | BEFORE UPDATE | set_updated_at | 000 |
| `trg_social_connections_updated_at` | social_connections | BEFORE UPDATE | set_updated_at | 000 |
| `trg_token_vault_updated_at` | token_vault | BEFORE UPDATE | set_updated_at | 000 |
| `trg_content_items_updated_at` | content_items | BEFORE UPDATE | set_updated_at | 001 |
| `trg_publish_jobs_updated_at` | publish_jobs | BEFORE UPDATE | set_updated_at | 002 |
| `trg_link_in_bio_profiles_updated_at` | link_in_bio_profiles | BEFORE UPDATE | set_updated_at | 005 |
| `trg_link_in_bio_tiles_updated_at` | link_in_bio_tiles | BEFORE UPDATE | set_updated_at | 005 |
| `trg_provider_rate_limits_updated_at` | provider_rate_limits | BEFORE UPDATE | set_updated_at | 007 |

---

## RLS (Row Level Security)

RLS is enabled on **all 18 tables**:

| Table | Source |
|-------|--------|
| accounts | 000 |
| profiles | 000 |
| social_connections | 000 |
| token_vault | 000 |
| content_items | 001 |
| content_item_versions | 001 |
| media_library | 001 |
| content_media_attachments | 001 |
| publish_jobs | 002 |
| publish_attempts | 002 |
| audit_log | 002 |
| notifications | 003 |
| analytics_snapshots | 004 |
| gbp_daily_metrics | 004 |
| link_in_bio_profiles | 005 |
| link_in_bio_tiles | 005 |
| link_in_bio_clicks | 009 |
| link_in_bio_page_views | 009 |

---

## RLS Policies

### Account-scoped CRUD (SELECT/INSERT/UPDATE/DELETE via `auth_user_id = auth.uid()`)

| Table | Policies | Source |
|-------|----------|--------|
| accounts | accounts_select, accounts_insert, accounts_update, accounts_delete | 000 |
| profiles | profiles_select, profiles_insert, profiles_update, profiles_delete | 000 |
| social_connections | social_connections_select, social_connections_insert, social_connections_update, social_connections_delete | 000 |
| token_vault | token_vault_select, token_vault_insert, token_vault_update, token_vault_delete | 000 |
| content_items | content_items_select, content_items_insert, content_items_update, content_items_delete | 001 |
| content_item_versions | content_item_versions_select, content_item_versions_insert, content_item_versions_update, content_item_versions_delete | 001 |
| media_library | media_library_select, media_library_insert, media_library_update, media_library_delete | 001 |
| content_media_attachments | content_media_attachments_select, content_media_attachments_insert, content_media_attachments_update, content_media_attachments_delete | 001 |
| publish_jobs | publish_jobs_select, publish_jobs_insert, publish_jobs_update, publish_jobs_delete | 002 |
| publish_attempts | publish_attempts_select, publish_attempts_insert, publish_attempts_update, publish_attempts_delete | 002 |
| audit_log | audit_log_select, audit_log_insert (SELECT + INSERT only) | 002 |
| notifications | notifications_select, notifications_insert, notifications_update, notifications_delete | 003 |
| analytics_snapshots | analytics_snapshots_select, analytics_snapshots_insert, analytics_snapshots_update, analytics_snapshots_delete | 004 |
| gbp_daily_metrics | gbp_daily_metrics_select, gbp_daily_metrics_insert, gbp_daily_metrics_update, gbp_daily_metrics_delete | 004 |
| link_in_bio_profiles | link_in_bio_profiles_select, link_in_bio_profiles_insert, link_in_bio_profiles_update, link_in_bio_profiles_delete | 005 |
| link_in_bio_tiles | link_in_bio_tiles_select, link_in_bio_tiles_insert, link_in_bio_tiles_update, link_in_bio_tiles_delete | 005 |

### Special policies (service-role / owner patterns)

| Table | Policy | Type | Source |
|-------|--------|------|--------|
| link_in_bio_clicks | link_in_bio_clicks_service_insert | INSERT WITH CHECK (true) -- service-role | 009 |
| link_in_bio_clicks | link_in_bio_clicks_owner_select | SELECT via profile->account join | 009 |
| link_in_bio_page_views | link_in_bio_page_views_service_insert | INSERT WITH CHECK (true) -- service-role | 009 |
| link_in_bio_page_views | link_in_bio_page_views_owner_select | SELECT via profile->account join | 009 |
| oauth_states | oauth_states_select, oauth_states_insert, oauth_states_update | SELECT/INSERT/UPDATE (no DELETE) | 007 |
| provider_rate_limits | rate_limits_select, rate_limits_insert, rate_limits_update | SELECT/INSERT/UPDATE (no DELETE) | 007 |

---

## Storage Policies (migration 006)

Bucket: `media` (must be created manually via Supabase Dashboard)

| Policy | Operation | Condition |
|--------|-----------|-----------|
| `media_insert` | INSERT | bucket_id = 'media' AND folder = account_id |
| `media_select` | SELECT | bucket_id = 'media' AND folder = account_id |
| `media_update` | UPDATE | bucket_id = 'media' AND folder = account_id |
| `media_delete` | DELETE | bucket_id = 'media' AND folder = account_id |

All storage policies scope access to `(storage.foldername(name))[1] = account_id`.

---

## Realtime Publication (migration 008)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

Both tables also have `REPLICA IDENTITY FULL` set for UPDATE event old-row detection.

---

## Exclusion Constraint (migration 002)

`publish_jobs` has a GiST exclusion constraint preventing duplicate queued/publishing jobs per content_item + platform. This **requires the `btree_gist` extension**.

---

## Summary Counts

| Object Type | Count |
|-------------|-------|
| Enums/Types | 5 |
| Tables | 18 |
| Functions | 2 |
| Indexes | 24 |
| Triggers | 9 |
| RLS-enabled tables | 18 |
| RLS Policies | 72 |
| Storage Policies | 4 |
| Realtime Publications | 2 |
| Exclusion Constraints | 1 |
