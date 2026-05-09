# CheersAI 2.0 Database Schema

26 tables + 1 view | 369 columns | Supabase project `nbkjciurhvkfpcpatbnt`
Notation: **bold**=NOT NULL, _italic_=has default, `?`=nullable

## accounts
id uuid, email text, display_name text?, timezone text =Europe/London, created_at timestamptz =now(), updated_at timestamptz =now()
> RLS:3p | Audit: created_at+updated_at

## ad_sets
id uuid =uuid(), campaign_id uuid, meta_adset_id text?, name text, targeting jsonb ={}, placements jsonb ="AUTO", budget_amount numeric?, optimisation_goal text, bid_strategy text =LOWEST_COST_WITHOUT_CAP, status text =DRAFT, created_at timestamptz =now(), phase_start date?, phase_end date?, adset_media_asset_id uuid?, adset_image_url text?, ads_stop_time time?, meta_status text?, metrics_spend numeric =0, metrics_impressions int4 =0, metrics_reach int4 =0, metrics_clicks int4 =0, metrics_ctr numeric =0, metrics_cpc numeric =0, last_synced_at timestamptz?, metrics_conversions numeric =0, metrics_cost_per_conversion numeric =0, metrics_conversion_rate numeric =0
> RLS:1p | FK: adset_media_asset_id->media_assets, campaign_id->meta_campaigns | Audit: created_at

## ads
id uuid =uuid(), adset_id uuid, meta_ad_id text?, meta_creative_id text?, name text, headline text, primary_text text, description text, cta text =LEARN_MORE, media_asset_id uuid?, creative_brief text?, preview_url text?, status text =DRAFT, created_at timestamptz =now(), angle text?, meta_status text?, metrics_spend numeric =0, metrics_impressions int4 =0, metrics_reach int4 =0, metrics_clicks int4 =0, metrics_ctr numeric =0, metrics_cpc numeric =0, last_synced_at timestamptz?, metrics_conversions numeric =0, metrics_cost_per_conversion numeric =0, metrics_conversion_rate numeric =0
> RLS:1p | FK: adset_id->ad_sets | Audit: created_at

## auth_rate_limits
key text, count int4 =0, reset_at timestamptz, updated_at timestamptz =now()
> RLS:1p | Audit: updated_at

## booking_conversion_events
id uuid =uuid(), account_id uuid, source_site text =the-anchor.pub, booking_id text, meta_event_id text?, booking_type text =event, event_id text?, event_slug text?, event_name text?, event_category_name text?, event_category_slug text?, event_date date?, tickets int4?, value numeric?, currency text =GBP, food_intent text?, source_url text?, landing_path text?, utm_source text?, utm_medium text?, utm_campaign text?, utm_content text?, utm_term text?, fbclid text?, occurred_at timestamptz =now(), created_at timestamptz =now()
> RLS:1p | FK: account_id->auth.users | Audit: created_at

## brand_profile
account_id uuid, tone_formal numeric =0.50, tone_playful numeric =0.50, key_phrases ARRAY? =ARRAY[][], banned_topics ARRAY? =ARRAY[][], default_hashtags ARRAY? =ARRAY[][], default_emojis ARRAY? =ARRAY[][], instagram_signature text?, facebook_signature text?, gbp_cta text?, updated_at timestamptz =now(), banned_phrases ARRAY ={}[]
> RLS:1p | FK: account_id->accounts | Audit: updated_at

## campaigns
id uuid =uuid(), account_id uuid, name text, campaign_type text, start_at timestamptz?, end_at timestamptz?, hero_media_id uuid?, auto_confirm bool =false, status text =draft, metadata jsonb?, created_at timestamptz =now(), updated_at timestamptz =now(), link_in_bio_url text?
> RLS:2p | FK: account_id->accounts, hero_media_id->media_assets | Audit: created_at+updated_at

## content_items
id uuid =uuid(), campaign_id uuid?, account_id uuid, platform text, scheduled_for timestamptz?, status text =draft, prompt_context jsonb?, auto_generated bool =true, created_at timestamptz =now(), updated_at timestamptz =now(), placement text =feed, deleted_at timestamptz?, hook_strategy text?, content_pillar text?
> RLS:1p | FK: campaign_id->campaigns(SET NULL), account_id->accounts | Audit: created_at+updated_at

## content_templates
id uuid =uuid(), account_id uuid, name text, prompt text, platforms ARRAY ={}[], tone_adjust text =default, cta_url text?, notes text?, use_count int4 =0, created_at timestamptz =now(), updated_at timestamptz =now()
> RLS:1p | FK: account_id->accounts | Audit: created_at+updated_at

## content_variants
id uuid =uuid(), content_item_id uuid, body text?, media_ids ARRAY? =ARRAY[], preview_data jsonb?, validation jsonb?, updated_at timestamptz =now(), banner_enabled bool?, banner_text_override text?, banner_position text?, banner_bg text?, banner_text_colour text?
> RLS:1p | FK: content_item_id->content_items | Audit: updated_at

## gbp_reviews
id uuid =uuid(), business_profile_id uuid, google_review_id text, reviewer_name text, star_rating int4, comment text?, create_time timestamptz, update_time timestamptz, reply_comment text?, reply_update_time timestamptz?, ai_draft text?, status text =pending, synced_at timestamptz =now()
> RLS:2p | FK: business_profile_id->accounts

## link_in_bio_profiles
account_id uuid, slug text, display_name text?, bio text?, hero_media_id uuid?, theme jsonb ={}, phone_number text?, whatsapp_number text?, booking_url text?, menu_url text?, parking_url text?, facebook_url text?, instagram_url text?, website_url text?, created_at timestamptz =now(), updated_at timestamptz =now(), directions_url text?
> RLS:1p | FK: account_id->accounts, hero_media_id->media_assets(SET NULL) | Audit: created_at+updated_at

## link_in_bio_tiles
id uuid =uuid(), account_id uuid, title text, subtitle text?, cta_label text, cta_url text, media_asset_id uuid?, position int4 =0, enabled bool =true, created_at timestamptz =now(), updated_at timestamptz =now()
> RLS:1p | FK: account_id->accounts, media_asset_id->media_assets(SET NULL) | Audit: created_at+updated_at

## management_app_connections
account_id uuid, base_url text, api_key text, enabled bool =true, last_tested_at timestamptz?, last_test_status text?, last_test_message text?, created_at timestamptz =now(), updated_at timestamptz =now()
> RLS:1p | FK: account_id->accounts | Audit: created_at+updated_at

## media_assets
id uuid =uuid(), account_id uuid, storage_path text, file_name text, media_type text, mime_type text?, size_bytes int8?, tags ARRAY? =ARRAY[][], uploaded_at timestamptz =now(), processed_status text =pending, processed_at timestamptz?, derived_variants jsonb? ={}, hidden_at timestamptz?, aspect_class text =square
> RLS:1p | FK: account_id->accounts

## meta_ad_accounts
id uuid =uuid(), account_id uuid, meta_account_id text, currency text =GBP, timezone text =Europe/London, access_token text, token_expires_at timestamptz?, setup_complete bool =false, created_at timestamptz =now(), meta_pixel_id text =757659911002159, conversion_event_name text =Purchase, conversion_optimisation_enabled bool =true
> RLS:1p | FK: account_id->auth.users | Audit: created_at

## meta_campaigns
id uuid =uuid(), account_id uuid, meta_campaign_id text?, name text, objective text, problem_brief text, ai_rationale text?, budget_type text =DAILY, budget_amount numeric, start_date date, end_date date?, status text =DRAFT, meta_status text?, special_ad_category text =NONE, last_synced_at timestamptz?, created_at timestamptz =now(), publish_error text?, campaign_kind text =event, source_type text?, source_id text?, destination_url text?, source_snapshot jsonb ={}, metrics_spend numeric =0, metrics_impressions int4 =0, metrics_reach int4 =0, metrics_clicks int4 =0, metrics_ctr numeric =0, metrics_cpc numeric =0, geo_radius_miles int4 =3, audience_mode text =local_only, audience_interest_keywords ARRAY ={}[], resolved_interests jsonb =[], metrics_conversions numeric =0, metrics_cost_per_conversion numeric =0, metrics_conversion_rate numeric =0
> RLS:1p | FK: account_id->auth.users | Audit: created_at

## meta_optimisation_actions
id uuid =uuid(), run_id uuid, account_id uuid, campaign_id uuid, adset_id uuid?, ad_id uuid?, meta_object_id text?, action_type text, reason text, metrics_snapshot jsonb ={}, status text =planned, error text?, applied_at timestamptz?, created_at timestamptz =now(), recommendation_payload jsonb ={}, replacement_ad_id uuid?, severity text =info
> RLS:1p | FK: campaign_id->meta_campaigns, adset_id->ad_sets(SET NULL), ad_id->ads(SET NULL), run_id->meta_optimisation_runs, account_id->auth.users, replacement_ad_id->ads(SET NULL) | Audit: created_at

## meta_optimisation_runs
id uuid =uuid(), account_id uuid, mode text =apply, status text =running, summary jsonb ={}, error text?, started_at timestamptz =now(), finished_at timestamptz?
> RLS:1p | FK: account_id->auth.users

## notifications
id uuid =uuid(), account_id uuid, category text?, message text, read_at timestamptz?, metadata jsonb?, created_at timestamptz =now()
> RLS:1p | FK: account_id->accounts | Audit: created_at

## oauth_states
id uuid =uuid(), provider text, state text, redirect_to text?, code_verifier text?, auth_code text?, error text?, created_at timestamptz =now(), used_at timestamptz?, account_id uuid?
> RLS:1p | FK: account_id->auth.users | Audit: created_at

## posting_defaults
account_id uuid, facebook_location_id text?, instagram_location_id text?, gbp_location_id text?, notifications jsonb =jsonb_build_object(emailFailures, true, emailTokenExpiring, true), gbp_cta_standard text =LEARN_MORE, gbp_cta_event text =LEARN_MORE, gbp_cta_offer text =REDEEM, created_at timestamptz =now(), updated_at timestamptz =now(), default_posting_time text?, venue_location text?, venue_latitude numeric?, venue_longitude numeric?, banners_enabled bool =true, banner_position text =right, banner_bg text =#a57626, banner_text_colour text =#FFFFFF
> RLS:1p | FK: account_id->accounts | Audit: created_at+updated_at

## publish_jobs
id uuid =uuid(), content_item_id uuid, attempt int4 =0, status text =queued, last_error text?, provider_response jsonb?, next_attempt_at timestamptz?, created_at timestamptz =now(), updated_at timestamptz =now(), placement text =feed, variant_id uuid
> RLS:1p | FK: content_item_id->content_items, variant_id->content_variants | Audit: created_at+updated_at

## publish_jobs_with_variant (VIEW)
id uuid?, content_item_id uuid?, attempt int4?, status text?, last_error text?, provider_response jsonb?, next_attempt_at timestamptz?, created_at timestamptz?, updated_at timestamptz?, placement text?, variant_id uuid?, media_ids ARRAY?
> RLS:0p | Audit: created_at+updated_at

## social_connections
id uuid =uuid(), account_id uuid, provider text, status text =needs_action, access_token text?, refresh_token text?, expires_at timestamptz?, display_name text?, last_synced_at timestamptz?, created_at timestamptz =now(), updated_at timestamptz =now(), metadata jsonb?
> RLS:1p | FK: account_id->accounts | Audit: created_at+updated_at

## user_auth_snapshot
user_id uuid, email text, status text =active, created_at timestamptz, last_sign_in_at timestamptz?, updated_at timestamptz =now()
> RLS:1p | Audit: created_at+updated_at

## worker_heartbeats
name text, last_run_at timestamptz =now(), last_run_source text?, metadata jsonb?, created_at timestamptz =now(), updated_at timestamptz =now()
> RLS:1p | Audit: created_at+updated_at

## Enum Types
No custom enums in public schema. All enums are system-level (auth/realtime).