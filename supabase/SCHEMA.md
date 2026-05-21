# CheersAI 2.0 -- Database Schema (Live)

**41 tables** | All RLS enabled | Queried from live Supabase

### accounts
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO |  |
| email | text | NO |  |
| display_name | text | YES |  |
| timezone | text | NO | 'Europe/London'::text |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| auth_user_id | uuid | NO |  |
| business_name | text | YES |  |

> **RLS:** enabled (7 policies) | **FKs:** none | **Audit:** created_at, updated_at

### ad_sets
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| campaign_id | uuid | NO |  |
| meta_adset_id | text | YES |  |
| name | text | NO |  |
| targeting | jsonb | NO | '{}'::jsonb |
| placements | jsonb | NO | '"AUTO"'::jsonb |
| budget_amount | numeric | YES |  |
| optimisation_goal | text | NO |  |
| bid_strategy | text | NO | 'LOWEST_COST_WITHOUT_CAP'::text |
| status | text | NO | 'DRAFT'::text |
| created_at | timestamp with time zone | NO | now() |
| phase_start | date | YES |  |
| phase_end | date | YES |  |
| adset_media_asset_id | uuid | YES |  |
| adset_image_url | text | YES |  |
| ads_stop_time | time without time zone | YES |  |
| meta_status | text | YES |  |
| metrics_spend | numeric | NO | 0 |
| metrics_impressions | integer | NO | 0 |
| metrics_reach | integer | NO | 0 |
| metrics_clicks | integer | NO | 0 |
| metrics_ctr | numeric | NO | 0 |
| metrics_cpc | numeric | NO | 0 |
| last_synced_at | timestamp with time zone | YES |  |
| metrics_conversions | numeric | NO | 0 |
| metrics_cost_per_conversion | numeric | NO | 0 |
| metrics_conversion_rate | numeric | NO | 0 |

> **RLS:** enabled (1 policies) | **FKs:** adset_media_asset_id -> media_assets(id); campaign_id -> meta_campaigns(id) CASCADE | **Audit:** created_at

### ads
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| adset_id | uuid | NO |  |
| meta_ad_id | text | YES |  |
| meta_creative_id | text | YES |  |
| name | text | NO |  |
| headline | text | NO |  |
| primary_text | text | NO |  |
| description | text | NO |  |
| cta | text | NO | 'LEARN_MORE'::text |
| media_asset_id | uuid | YES |  |
| creative_brief | text | YES |  |
| preview_url | text | YES |  |
| status | text | NO | 'DRAFT'::text |
| created_at | timestamp with time zone | NO | now() |
| angle | text | YES |  |
| meta_status | text | YES |  |
| metrics_spend | numeric | NO | 0 |
| metrics_impressions | integer | NO | 0 |
| metrics_reach | integer | NO | 0 |
| metrics_clicks | integer | NO | 0 |
| metrics_ctr | numeric | NO | 0 |
| metrics_cpc | numeric | NO | 0 |
| last_synced_at | timestamp with time zone | YES |  |
| metrics_conversions | numeric | NO | 0 |
| metrics_cost_per_conversion | numeric | NO | 0 |
| metrics_conversion_rate | numeric | NO | 0 |

> **RLS:** enabled (1 policies) | **FKs:** adset_id -> ad_sets(id) CASCADE | **Audit:** created_at

### analytics_snapshots
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| publish_job_id | uuid | YES |  |
| platform | text | NO |  |
| impressions | integer | YES |  |
| reach | integer | YES |  |
| engagement_count | integer | YES |  |
| engagement_rate | numeric | YES |  |
| clicks | integer | YES |  |
| shares | integer | YES |  |
| comments | integer | YES |  |
| snapshot_date | date | NO |  |
| raw_data | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** account_id -> accounts(id) CASCADE; publish_job_id -> publish_jobs(id) SET NULL | **Audit:** created_at

### audit_log
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| user_id | uuid | YES |  |
| operation_type | text | NO |  |
| resource_type | text | NO |  |
| resource_id | uuid | YES |  |
| operation_status | text | NO | 'success'::text |
| details | jsonb | YES |  |
| correlation_id | text | YES |  |
| created_at | timestamp with time zone | NO | now() |

> **RLS:** enabled (2 policies) | **FKs:** account_id -> accounts(id) CASCADE; user_id -> auth.users(id) | **Audit:** created_at

### auth_rate_limits
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| key | text | NO |  |
| count | integer | NO | 0 |
| reset_at | timestamp with time zone | NO |  |
| updated_at | timestamp with time zone | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** none | **Audit:** updated_at

### booking_conversion_events
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| source_site | text | NO | 'the-anchor.pub'::text |
| booking_id | text | NO |  |
| meta_event_id | text | YES |  |
| booking_type | text | NO | 'event'::text |
| event_id | text | YES |  |
| event_slug | text | YES |  |
| event_name | text | YES |  |
| event_category_name | text | YES |  |
| event_category_slug | text | YES |  |
| event_date | date | YES |  |
| tickets | integer | YES |  |
| value | numeric | YES |  |
| currency | text | NO | 'GBP'::text |
| food_intent | text | YES |  |
| source_url | text | YES |  |
| landing_path | text | YES |  |
| utm_source | text | YES |  |
| utm_medium | text | YES |  |
| utm_campaign | text | YES |  |
| utm_content | text | YES |  |
| utm_term | text | YES |  |
| fbclid | text | YES |  |
| occurred_at | timestamp with time zone | NO | now() |
| created_at | timestamp with time zone | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> auth.users(id) CASCADE | **Audit:** created_at

### brand_profile
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO |  |
| tone_formal | numeric | NO | 0.50 |
| tone_playful | numeric | NO | 0.50 |
| key_phrases | ARRAY | YES | ARRAY[]::text[] |
| banned_topics | ARRAY | YES | ARRAY[]::text[] |
| default_hashtags | ARRAY | YES | ARRAY[]::text[] |
| default_emojis | ARRAY | YES | ARRAY[]::text[] |
| instagram_signature | text | YES |  |
| facebook_signature | text | YES |  |
| gbp_cta | text | YES |  |
| updated_at | timestamp with time zone | NO | now() |
| banned_phrases | ARRAY | NO | '{}'::text[] |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** updated_at

### campaigns
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| name | text | NO |  |
| campaign_type | text | NO |  |
| start_at | timestamptz | YES |  |
| end_at | timestamptz | YES |  |
| hero_media_id | uuid | YES |  |
| auto_confirm | boolean | NO | false |
| status | text | NO | 'draft'::text |
| metadata | jsonb | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| link_in_bio_url | text | YES |  |

> **RLS:** enabled (2 policies) | **FKs:** account_id -> accounts(id) CASCADE; hero_media_id -> media_assets(id) | **Audit:** created_at, updated_at

### content_item_versions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| content_item_id | uuid | NO |  |
| account_id | uuid | NO |  |
| version_number | integer | NO |  |
| snapshot | jsonb | NO |  |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** content_item_id -> content_items(id) CASCADE; account_id -> accounts(id) CASCADE | **Audit:** created_at

### content_items
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| campaign_id | uuid | YES |  |
| account_id | uuid | NO |  |
| platform | text | YES |  |
| scheduled_for | timestamptz | YES |  |
| status | text | NO | 'draft'::text |
| prompt_context | jsonb | YES |  |
| auto_generated | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| placement | text | NO | 'feed'::text |
| deleted_at | timestamptz | YES |  |
| hook_strategy | text | YES |  |
| content_pillar | text | YES |  |
| title | text | YES |  |
| body_draft | jsonb | YES |  |
| campaign_name | text | YES |  |
| scheduled_at | timestamptz | YES |  |
| event_date | date | YES |  |
| event_end_date | date | YES |  |
| coupon_code | text | YES |  |
| recurring_day_of_week | integer | YES |  |
| auto_confirm | boolean | NO | false |
| ai_generation_params | jsonb | YES |  |
| content_type | USER-DEFINED | NO | 'instant_post'::content_type |

> **RLS:** enabled (5 policies) | **FKs:** campaign_id -> campaigns(id) SET NULL; account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at, deleted_at

### content_media_attachments
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| content_item_id | uuid | NO |  |
| media_id | uuid | NO |  |
| position | integer | NO | 0 |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** content_item_id -> content_items(id) CASCADE; media_id -> media_library(id) CASCADE | **Audit:** created_at

### content_templates
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| name | text | NO |  |
| prompt | text | NO |  |
| platforms | ARRAY | NO | '{}'::text[] |
| tone_adjust | text | NO | 'default'::text |
| cta_url | text | YES |  |
| notes | text | YES |  |
| use_count | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### content_variants
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| content_item_id | uuid | NO |  |
| body | text | YES |  |
| media_ids | ARRAY | YES | ARRAY[]::uuid[] |
| preview_data | jsonb | YES |  |
| validation | jsonb | YES |  |
| updated_at | timestamptz | NO | now() |
| banner_enabled | boolean | YES |  |
| banner_text_override | text | YES |  |
| banner_position | text | YES |  |
| banner_bg | text | YES |  |
| banner_text_colour | text | YES |  |

> **RLS:** enabled (1 policies) | **FKs:** content_item_id -> content_items(id) CASCADE | **Audit:** updated_at

### gbp_daily_metrics
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| social_connection_id | uuid | YES |  |
| metric_date | date | NO |  |
| search_views | integer | YES |  |
| map_views | integer | YES |  |
| website_clicks | integer | YES |  |
| direction_requests | integer | YES |  |
| phone_calls | integer | YES |  |
| raw_data | jsonb | YES |  |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** account_id -> accounts(id) CASCADE; social_connection_id -> social_connections(id) SET NULL | **Audit:** created_at

### gbp_reviews
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| business_profile_id | uuid | NO |  |
| google_review_id | text | NO |  |
| reviewer_name | text | NO | ''::text |
| star_rating | integer | NO |  |
| comment | text | YES |  |
| create_time | timestamptz | NO |  |
| update_time | timestamptz | NO |  |
| reply_comment | text | YES |  |
| reply_update_time | timestamptz | YES |  |
| ai_draft | text | YES |  |
| status | text | NO | 'pending'::text |
| synced_at | timestamptz | NO | now() |

> **RLS:** enabled (2 policies) | **FKs:** business_profile_id -> accounts(id) CASCADE | **Audit:** none

### link_in_bio_clicks
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| profile_id | uuid | NO |  |
| tile_id | uuid | YES |  |
| click_type | text | NO | 'tile'::text |
| referrer | text | YES |  |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (2 policies) | **FKs:** tile_id -> link_in_bio_tiles(id) SET NULL | **Audit:** created_at

### link_in_bio_page_views
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| profile_id | uuid | NO |  |
| referrer | text | YES |  |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (2 policies) | **FKs:** none | **Audit:** created_at

### link_in_bio_profiles
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO |  |
| slug | text | NO |  |
| display_name | text | YES |  |
| bio | text | YES |  |
| hero_media_id | uuid | YES |  |
| theme | jsonb | NO | '{}'::jsonb |
| phone_number | text | YES |  |
| whatsapp_number | text | YES |  |
| booking_url | text | YES |  |
| menu_url | text | YES |  |
| parking_url | text | YES |  |
| facebook_url | text | YES |  |
| instagram_url | text | YES |  |
| website_url | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| directions_url | text | YES |  |
| id | uuid | YES | gen_random_uuid() |
| logo_url | text | YES |  |
| hero_image_url | text | YES |  |
| brand_color_primary | text | YES |  |
| brand_color_secondary | text | YES |  |
| contact_email | text | YES |  |
| contact_phone | text | YES |  |
| contact_website | text | YES |  |
| is_published | boolean | NO | false |
| template | text | NO | 'classic'::text |
| font_family | text | NO | 'inter'::text |

> **RLS:** enabled (5 policies) | **FKs:** account_id -> accounts(id) CASCADE; hero_media_id -> media_assets(id) SET NULL | **Audit:** created_at, updated_at

### link_in_bio_tiles
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| title | text | NO |  |
| subtitle | text | YES |  |
| cta_label | text | NO |  |
| cta_url | text | NO |  |
| media_asset_id | uuid | YES |  |
| position | integer | NO | 0 |
| enabled | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| profile_id | uuid | YES |  |
| url | text | YES |  |
| image_url | text | YES |  |
| is_visible | boolean | NO | true |
| tile_type | text | NO | 'link'::text |
| embed_data | jsonb | YES |  |

> **RLS:** enabled (5 policies) | **FKs:** account_id -> accounts(id) CASCADE; media_asset_id -> media_assets(id) SET NULL | **Audit:** created_at, updated_at

### management_app_connections
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO |  |
| base_url | text | NO |  |
| api_key | text | NO |  |
| enabled | boolean | NO | true |
| last_tested_at | timestamptz | YES |  |
| last_test_status | text | YES |  |
| last_test_message | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### media_assets
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| storage_path | text | NO |  |
| file_name | text | NO |  |
| media_type | text | NO |  |
| mime_type | text | YES |  |
| size_bytes | bigint | YES |  |
| tags | ARRAY | YES | ARRAY[]::text[] |
| uploaded_at | timestamptz | NO | now() |
| processed_status | text | NO | 'pending'::text |
| processed_at | timestamptz | YES |  |
| derived_variants | jsonb | YES | '{}'::jsonb |
| hidden_at | timestamptz | YES |  |
| aspect_class | text | NO | 'square'::text |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** none

### media_library
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| file_name | text | NO |  |
| file_url | text | NO |  |
| file_type | text | NO |  |
| file_size_bytes | integer | YES |  |
| width | integer | YES |  |
| height | integer | YES |  |
| tags | ARRAY | YES | '{}'::text[] |
| created_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at

### meta_ad_accounts
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| meta_account_id | text | NO | ''::text |
| currency | text | NO | 'GBP'::text |
| timezone | text | NO | 'Europe/London'::text |
| access_token | text | NO | ''::text |
| token_expires_at | timestamptz | YES |  |
| setup_complete | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| meta_pixel_id | text | NO | '757659911002159'::text |
| conversion_event_name | text | NO | 'Purchase'::text |
| conversion_optimisation_enabled | boolean | NO | true |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> auth.users(id) CASCADE | **Audit:** created_at

### meta_campaigns
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| meta_campaign_id | text | YES |  |
| name | text | NO |  |
| objective | text | NO |  |
| problem_brief | text | NO |  |
| ai_rationale | text | YES |  |
| budget_type | text | NO | 'DAILY'::text |
| budget_amount | numeric | NO |  |
| start_date | date | NO |  |
| end_date | date | YES |  |
| status | text | NO | 'DRAFT'::text |
| meta_status | text | YES |  |
| special_ad_category | text | NO | 'NONE'::text |
| last_synced_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| publish_error | text | YES |  |
| campaign_kind | text | NO | 'event'::text |
| source_type | text | YES |  |
| source_id | text | YES |  |
| destination_url | text | YES |  |
| source_snapshot | jsonb | NO | '{}'::jsonb |
| metrics_spend | numeric | NO | 0 |
| metrics_impressions | integer | NO | 0 |
| metrics_reach | integer | NO | 0 |
| metrics_clicks | integer | NO | 0 |
| metrics_ctr | numeric | NO | 0 |
| metrics_cpc | numeric | NO | 0 |
| geo_radius_miles | integer | NO | 3 |
| audience_mode | text | NO | 'local_only'::text |
| audience_interest_keywords | ARRAY | NO | '{}'::text[] |
| resolved_interests | jsonb | NO | '[]'::jsonb |
| metrics_conversions | numeric | NO | 0 |
| metrics_cost_per_conversion | numeric | NO | 0 |
| metrics_conversion_rate | numeric | NO | 0 |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> auth.users(id) CASCADE | **Audit:** created_at

### meta_optimisation_actions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| run_id | uuid | NO |  |
| account_id | uuid | NO |  |
| campaign_id | uuid | NO |  |
| adset_id | uuid | YES |  |
| ad_id | uuid | YES |  |
| meta_object_id | text | YES |  |
| action_type | text | NO |  |
| reason | text | NO |  |
| metrics_snapshot | jsonb | NO | '{}'::jsonb |
| status | text | NO | 'planned'::text |
| error | text | YES |  |
| applied_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| recommendation_payload | jsonb | NO | '{}'::jsonb |
| replacement_ad_id | uuid | YES |  |
| severity | text | NO | 'info'::text |

> **RLS:** enabled (1 policies) | **FKs:** campaign_id -> meta_campaigns(id) CASCADE; adset_id -> ad_sets(id) SET NULL; ad_id -> ads(id) SET NULL; run_id -> meta_optimisation_runs(id) CASCADE; account_id -> auth.users(id) CASCADE; replacement_ad_id -> ads(id) SET NULL | **Audit:** created_at

### meta_optimisation_runs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| mode | text | NO | 'apply'::text |
| status | text | NO | 'running'::text |
| summary | jsonb | NO | '{}'::jsonb |
| error | text | YES |  |
| started_at | timestamptz | NO | now() |
| finished_at | timestamptz | YES |  |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> auth.users(id) CASCADE | **Audit:** none

### notifications
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| category | text | YES |  |
| message | text | NO |  |
| read_at | timestamptz | YES |  |
| metadata | jsonb | YES |  |
| created_at | timestamptz | NO | now() |
| urgency | text | YES | 'standard'::text |
| title | text | YES |  |
| body | text | YES |  |
| resource_type | text | YES |  |
| resource_id | uuid | YES |  |
| dismissed_at | timestamptz | YES |  |

> **RLS:** enabled (5 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at

### oauth_states
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| provider | text | NO |  |
| state | text | NO |  |
| redirect_to | text | YES |  |
| code_verifier | text | YES |  |
| auth_code | text | YES |  |
| error | text | YES |  |
| created_at | timestamptz | NO | now() |
| used_at | timestamptz | YES |  |
| account_id | uuid | YES |  |
| created_by | uuid | YES |  |
| expires_at | timestamptz | YES | (now() + '00:10:00'::interval) |

> **RLS:** enabled (4 policies) | **FKs:** account_id -> auth.users(id) CASCADE | **Audit:** created_at

### posting_defaults
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| account_id | uuid | NO |  |
| facebook_location_id | text | YES |  |
| instagram_location_id | text | YES |  |
| gbp_location_id | text | YES |  |
| notifications | jsonb | NO |  |
| gbp_cta_standard | text | NO | 'LEARN_MORE'::text |
| gbp_cta_event | text | NO | 'LEARN_MORE'::text |
| gbp_cta_offer | text | NO | 'REDEEM'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| default_posting_time | text | YES |  |
| venue_location | text | YES |  |
| venue_latitude | numeric | YES |  |
| venue_longitude | numeric | YES |  |
| banners_enabled | boolean | NO | true |
| banner_position | text | NO | 'right'::text |
| banner_bg | text | NO | '#a57626'::text |
| banner_text_colour | text | NO | '#FFFFFF'::text |

> **RLS:** enabled (1 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### profiles
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| display_name | text | YES |  |
| avatar_url | text | YES |  |
| brand_voice_tone | text | YES |  |
| brand_voice_style | text | YES |  |
| default_cta | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### provider_rate_limits
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| provider | text | NO |  |
| endpoint | text | NO |  |
| window_start | timestamptz | NO |  |
| request_count | integer | NO | 0 |
| limit_ceiling | integer | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (3 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### publish_attempts
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| publish_job_id | uuid | NO |  |
| account_id | uuid | NO |  |
| attempt_number | integer | NO |  |
| status | text | NO |  |
| started_at | timestamptz | NO | now() |
| completed_at | timestamptz | YES |  |
| error_details | jsonb | YES |  |
| platform_response | jsonb | YES |  |

> **RLS:** enabled (4 policies) | **FKs:** publish_job_id -> publish_jobs(id) CASCADE; account_id -> accounts(id) CASCADE | **Audit:** none

### publish_jobs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| content_item_id | uuid | NO |  |
| attempt | integer | NO | 0 |
| status | text | NO | 'queued'::text |
| last_error | text | YES |  |
| provider_response | jsonb | YES |  |
| next_attempt_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| placement | text | NO | 'feed'::text |
| variant_id | uuid | NO |  |
| account_id | uuid | YES |  |
| idempotency_key | text | YES |  |
| scheduled_at | timestamptz | YES |  |
| started_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| error_message | text | YES |  |
| error_code | text | YES |  |
| retry_count | integer | NO | 0 |
| max_retries | integer | NO | 4 |
| platform_post_id | text | YES |  |

> **RLS:** enabled (5 policies) | **FKs:** content_item_id -> content_items(id) CASCADE; variant_id -> content_variants(id) CASCADE; account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### publish_jobs_with_variant
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | YES |  |
| content_item_id | uuid | YES |  |
| attempt | integer | YES |  |
| status | text | YES |  |
| last_error | text | YES |  |
| provider_response | jsonb | YES |  |
| next_attempt_at | timestamptz | YES |  |
| created_at | timestamptz | YES |  |
| updated_at | timestamptz | YES |  |
| placement | text | YES |  |
| variant_id | uuid | YES |  |
| media_ids | ARRAY | YES |  |

> **RLS:** enabled (0 policies) | **FKs:** none | **Audit:** created_at, updated_at

### social_connections
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| provider | text | NO |  |
| status | text | NO | 'needs_action'::text |
| access_token | text | YES |  |
| refresh_token | text | YES |  |
| expires_at | timestamptz | YES |  |
| display_name | text | YES |  |
| last_synced_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| metadata | jsonb | YES |  |
| platform_account_id | text | YES |  |
| platform_account_name | text | YES |  |
| scopes | ARRAY | YES |  |
| token_expires_at | timestamptz | YES |  |

> **RLS:** enabled (5 policies) | **FKs:** account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### token_vault
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| social_connection_id | uuid | NO |  |
| token_type | text | NO |  |
| ciphertext | text | NO |  |
| iv | text | NO |  |
| tag | text | NO |  |
| key_version | integer | NO | 1 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (4 policies) | **FKs:** social_connection_id -> social_connections(id) CASCADE | **Audit:** created_at, updated_at

### tournament_fixtures
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| tournament_id | uuid | NO |  |
| match_number | integer | NO |  |
| round | text | NO |  |
| group_name | text | YES |  |
| team_a | text | NO |  |
| team_b | text | NO |  |
| teams_confirmed | boolean | NO | false |
| kick_off_at | timestamptz | NO |  |
| venue_city | text | YES |  |
| showing | boolean | NO | false |
| showing_note | text | YES |  |
| booking_url | text | YES |  |
| content_generated | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** tournament_id -> tournaments(id) CASCADE | **Audit:** created_at, updated_at

### tournaments
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| account_id | uuid | NO |  |
| name | text | NO |  |
| slug | text | NO |  |
| status | text | NO | 'draft'::text |
| base_image_square_id | uuid | YES |  |
| base_image_story_id | uuid | YES |  |
| house_rules_text | text | YES |  |
| post_template | text | NO |  |
| platforms | ARRAY | NO | '{instagram,facebook}'::text[] |
| post_lead_hours | integer | NO | 24 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| feed_api_key | text | YES |  |

> **RLS:** enabled (1 policies) | **FKs:** base_image_square_id -> media_assets(id) SET NULL; base_image_story_id -> media_assets(id) SET NULL; account_id -> accounts(id) CASCADE | **Audit:** created_at, updated_at

### user_auth_snapshot
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| user_id | uuid | NO |  |
| email | text | NO |  |
| status | text | NO | 'active'::text |
| created_at | timestamptz | NO |  |
| last_sign_in_at | timestamptz | YES |  |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** none | **Audit:** created_at, updated_at

### worker_heartbeats
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| name | text | NO |  |
| last_run_at | timestamptz | NO | now() |
| last_run_source | text | YES |  |
| metadata | jsonb | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

> **RLS:** enabled (1 policies) | **FKs:** none | **Audit:** created_at, updated_at

---

## Public Schema Enums

| Enum | Values |
|------|--------|
| content_status | draft, review, approved, scheduled, queued, publishing, published, failed |
| content_type | instant_post, story, event, promotion, weekly_recurring |
| platform | facebook, instagram, gbp |
| connection_status | active, expiring, expired, disconnected |
| notification_urgency | urgent, standard |