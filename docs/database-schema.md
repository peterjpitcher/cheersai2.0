# CheersAI 2.0 -- Live Database Schema

> Auto-generated from Supabase project `nbkjciurhvkfpcpatbnt` (cheersai2.0). All tables have RLS enabled.

## accounts

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | -- |
| email | text | NO | -- |
| display_name | text | YES | -- |
| timezone | text | NO | `'Europe/London'` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**RLS:** 3 policies (SELECT/INSERT/UPDATE by owner or service_role)

---

## ad_sets

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| campaign_id | uuid | NO | -- |
| meta_adset_id | text | YES | -- |
| name | text | NO | -- |
| targeting | jsonb | NO | `'{}'` |
| placements | jsonb | NO | `'"AUTO"'` |
| budget_amount | numeric | YES | -- |
| optimisation_goal | text | NO | -- |
| bid_strategy | text | NO | `'LOWEST_COST_WITHOUT_CAP'` |
| status | text | NO | `'DRAFT'` |
| created_at | timestamptz | NO | `now()` |
| phase_start | date | YES | -- |
| phase_end | date | YES | -- |
| adset_media_asset_id | uuid | YES | -- |
| adset_image_url | text | YES | -- |
| ads_stop_time | time | YES | -- |

**FK:** campaign_id -> meta_campaigns(id) CASCADE, adset_media_asset_id -> media_assets(id)
**RLS:** 1 policy (ALL via parent campaigns join)

---

## ads

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| adset_id | uuid | NO | -- |
| meta_ad_id | text | YES | -- |
| meta_creative_id | text | YES | -- |
| name | text | NO | -- |
| headline | text | NO | -- |
| primary_text | text | NO | -- |
| description | text | NO | -- |
| cta | text | NO | `'LEARN_MORE'` |
| media_asset_id | uuid | YES | -- |
| creative_brief | text | YES | -- |
| preview_url | text | YES | -- |
| status | text | NO | `'DRAFT'` |
| created_at | timestamptz | NO | `now()` |
| angle | text | YES | -- |

**FK:** adset_id -> ad_sets(id) CASCADE
**RLS:** 1 policy (ALL via ad_sets -> campaigns join)

---

## auth_rate_limits

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| key | text | NO | -- |
| count | integer | NO | `0` |
| reset_at | timestamptz | NO | -- |
| updated_at | timestamptz | NO | `now()` |

**RLS:** 1 policy (service_role only)

---

## brand_profile

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO | -- |
| tone_formal | numeric | NO | `0.50` |
| tone_playful | numeric | NO | `0.50` |
| key_phrases | text[] | YES | `'{}'` |
| banned_topics | text[] | YES | `'{}'` |
| default_hashtags | text[] | YES | `'{}'` |
| default_emojis | text[] | YES | `'{}'` |
| instagram_signature | text | YES | -- |
| facebook_signature | text | YES | -- |
| gbp_cta | text | YES | -- |
| updated_at | timestamptz | NO | `now()` |
| banned_phrases | text[] | NO | `'{}'` |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## campaigns

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| name | text | NO | -- |
| campaign_type | text | NO | -- |
| start_at | timestamptz | YES | -- |
| end_at | timestamptz | YES | -- |
| hero_media_id | uuid | YES | -- |
| auto_confirm | boolean | NO | `false` |
| status | text | NO | `'draft'` |
| metadata | jsonb | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| link_in_bio_url | text | YES | -- |

**FK:** account_id -> accounts(id) CASCADE, hero_media_id -> media_assets(id)
**RLS:** 2 policies (ALL by account or service_role; ALL by account)

---

## content_items

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| campaign_id | uuid | YES | -- |
| account_id | uuid | NO | -- |
| platform | text | NO | -- |
| scheduled_for | timestamptz | YES | -- |
| status | text | NO | `'draft'` |
| prompt_context | jsonb | YES | -- |
| auto_generated | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| placement | text | NO | `'feed'` |
| deleted_at | timestamptz | YES | -- |
| hook_strategy | text | YES | -- |
| content_pillar | text | YES | -- |

**FK:** campaign_id -> campaigns(id) SET NULL, account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## content_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| name | text | NO | -- |
| prompt | text | NO | -- |
| platforms | text[] | NO | `'{}'` |
| tone_adjust | text | NO | `'default'` |
| cta_url | text | YES | -- |
| notes | text | YES | -- |
| use_count | integer | NO | `0` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## content_variants

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| content_item_id | uuid | NO | -- |
| body | text | YES | -- |
| media_ids | uuid[] | YES | `'{}'` |
| preview_data | jsonb | YES | -- |
| validation | jsonb | YES | -- |
| updated_at | timestamptz | NO | `now()` |

**FK:** content_item_id -> content_items(id) CASCADE
**RLS:** 1 policy (ALL via parent content_items join)

---

## gbp_reviews

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| business_profile_id | uuid | NO | -- |
| google_review_id | text | NO | -- |
| reviewer_name | text | NO | `''` |
| star_rating | integer | NO | -- |
| comment | text | YES | -- |
| create_time | timestamptz | NO | -- |
| update_time | timestamptz | NO | -- |
| reply_comment | text | YES | -- |
| reply_update_time | timestamptz | YES | -- |
| ai_draft | text | YES | -- |
| status | text | NO | `'pending'` |
| synced_at | timestamptz | NO | `now()` |

**FK:** business_profile_id -> accounts(id) CASCADE
**RLS:** 2 policies (SELECT + UPDATE by account or service_role)

---

## link_in_bio_profiles

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO | -- |
| slug | text | NO | -- |
| display_name | text | YES | -- |
| bio | text | YES | -- |
| hero_media_id | uuid | YES | -- |
| theme | jsonb | NO | `'{}'` |
| phone_number | text | YES | -- |
| whatsapp_number | text | YES | -- |
| booking_url | text | YES | -- |
| menu_url | text | YES | -- |
| parking_url | text | YES | -- |
| facebook_url | text | YES | -- |
| instagram_url | text | YES | -- |
| website_url | text | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| directions_url | text | YES | -- |

**FK:** account_id -> accounts(id) CASCADE, hero_media_id -> media_assets(id) SET NULL
**RLS:** 1 policy (ALL by account or service_role)

---

## link_in_bio_tiles

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| title | text | NO | -- |
| subtitle | text | YES | -- |
| cta_label | text | NO | -- |
| cta_url | text | NO | -- |
| media_asset_id | uuid | YES | -- |
| position | integer | NO | `0` |
| enabled | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**FK:** account_id -> accounts(id) CASCADE, media_asset_id -> media_assets(id) SET NULL
**RLS:** 1 policy (ALL by account or service_role)

---

## management_app_connections

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO | -- |
| base_url | text | NO | -- |
| api_key | text | NO | -- |
| enabled | boolean | NO | `true` |
| last_tested_at | timestamptz | YES | -- |
| last_test_status | text | YES | -- |
| last_test_message | text | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (service_role only)

---

## media_assets

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| storage_path | text | NO | -- |
| file_name | text | NO | -- |
| media_type | text | NO | -- |
| mime_type | text | YES | -- |
| size_bytes | bigint | YES | -- |
| tags | text[] | YES | `'{}'` |
| uploaded_at | timestamptz | NO | `now()` |
| processed_status | text | NO | `'pending'` |
| processed_at | timestamptz | YES | -- |
| derived_variants | jsonb | YES | `'{}'` |
| hidden_at | timestamptz | YES | -- |
| aspect_class | text | NO | `'square'` |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## meta_ad_accounts

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| meta_account_id | text | NO | `''` |
| currency | text | NO | `'GBP'` |
| timezone | text | NO | `'Europe/London'` |
| access_token | text | NO | `''` |
| token_expires_at | timestamptz | YES | -- |
| setup_complete | boolean | NO | `false` |
| created_at | timestamptz | NO | `now()` |

**FK:** account_id -> auth.users(id) CASCADE
**RLS:** 1 policy (ALL by account)

---

## meta_campaigns

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| meta_campaign_id | text | YES | -- |
| name | text | NO | -- |
| objective | text | NO | -- |
| problem_brief | text | NO | -- |
| ai_rationale | text | YES | -- |
| budget_type | text | NO | `'DAILY'` |
| budget_amount | numeric | NO | -- |
| start_date | date | NO | -- |
| end_date | date | YES | -- |
| status | text | NO | `'DRAFT'` |
| meta_status | text | YES | -- |
| special_ad_category | text | NO | `'NONE'` |
| last_synced_at | timestamptz | YES | -- |
| created_at | timestamptz | NO | `now()` |
| publish_error | text | YES | -- |

**FK:** account_id -> auth.users(id) CASCADE
**RLS:** 1 policy (ALL by account)

---

## notifications

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| category | text | YES | -- |
| message | text | NO | -- |
| read_at | timestamptz | YES | -- |
| metadata | jsonb | YES | -- |
| created_at | timestamptz | NO | `now()` |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## oauth_states

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| provider | text | NO | -- |
| state | text | NO | -- |
| redirect_to | text | YES | -- |
| code_verifier | text | YES | -- |
| auth_code | text | YES | -- |
| error | text | YES | -- |
| created_at | timestamptz | NO | `now()` |
| used_at | timestamptz | YES | -- |
| account_id | uuid | YES | -- |

**FK:** account_id -> auth.users(id) CASCADE
**RLS:** 1 policy (service_role only)

---

## posting_defaults

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO | -- |
| facebook_location_id | text | YES | -- |
| instagram_location_id | text | YES | -- |
| gbp_location_id | text | YES | -- |
| notifications | jsonb | NO | `jsonb_build_object(...)` |
| gbp_cta_standard | text | NO | `'LEARN_MORE'` |
| gbp_cta_event | text | NO | `'LEARN_MORE'` |
| gbp_cta_offer | text | NO | `'REDEEM'` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| default_posting_time | text | YES | -- |
| venue_location | text | YES | -- |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## publish_jobs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| content_item_id | uuid | NO | -- |
| attempt | integer | NO | `0` |
| status | text | NO | `'queued'` |
| last_error | text | YES | -- |
| provider_response | jsonb | YES | -- |
| next_attempt_at | timestamptz | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| placement | text | NO | `'feed'` |
| variant_id | uuid | NO | -- |

**FK:** content_item_id -> content_items(id) CASCADE, variant_id -> content_variants(id) CASCADE
**RLS:** 1 policy (ALL via parent content_items join)

---

## social_connections

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | `gen_random_uuid()` |
| account_id | uuid | NO | -- |
| provider | text | NO | -- |
| status | text | NO | `'needs_action'` |
| access_token | text | YES | -- |
| refresh_token | text | YES | -- |
| expires_at | timestamptz | YES | -- |
| display_name | text | YES | -- |
| last_synced_at | timestamptz | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |
| metadata | jsonb | YES | -- |

**FK:** account_id -> accounts(id) CASCADE
**RLS:** 1 policy (ALL by account or service_role)

---

## user_auth_snapshot

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| user_id | uuid | NO | -- |
| email | text | NO | -- |
| status | text | NO | `'active'` |
| created_at | timestamptz | NO | -- |
| last_sign_in_at | timestamptz | YES | -- |
| updated_at | timestamptz | NO | `now()` |

**RLS:** 1 policy (SELECT for all authenticated)

---

## worker_heartbeats

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| name | text | NO | -- |
| last_run_at | timestamptz | NO | `now()` |
| last_run_source | text | YES | -- |
| metadata | jsonb | YES | -- |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**RLS:** 1 policy (service_role only)

---

## Views

- **publish_jobs_with_variant** -- joins publish_jobs with content_variants.media_ids

## Enum Types (public schema only)

No custom enums in the public schema. All enums belong to `auth`/`realtime`/`storage` schemas (aal_level, factor_type, etc.).
