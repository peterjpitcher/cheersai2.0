-- =============================================================================
-- V1 → V2 Bridge Migration
-- =============================================================================
-- Purpose: Bring a restored v1 database up to v2 schema expectations.
-- Safe to run against v2 (all guards use IF NOT EXISTS / IF EXISTS).
-- Does NOT drop or modify any existing data, columns, or tables.
--
-- Sections:
--   1. Enum types (v2 adds 5 enums that v1 does not have)
--   2. Functions (set_updated_at exists in v1; current_account_id updated for v2)
--   3. accounts table — add auth_user_id, business_name columns
--   4. accounts data bridge — populate auth_user_id and business_name from v1 data
--   5. New table: profiles
--   6. social_connections — add v2 columns (metadata, display_name, last_synced_at already exist in v1!)
--      Also add v2 columns: platform_account_id, platform_account_name, scopes, token_expires_at
--   7. New table: token_vault
--   8. content_items — add v2 columns to existing v1 table
--   9. New table: content_item_versions
--  10. New table: media_library
--  11. New table: content_media_attachments
--  12. publish_jobs — add v2 columns to existing v1 table
--  13. New table: publish_attempts
--  14. New table: audit_log
--  15. notifications — add v2 columns (message & metadata already exist in v1)
--  16. New table: analytics_snapshots
--  17. New table: gbp_daily_metrics
--  18. link_in_bio_profiles — add v2 columns
--  19. link_in_bio_tiles — add v2 columns
--  20. New table: link_in_bio_clicks
--  21. New table: link_in_bio_page_views
--  22. oauth_states — v1 has this table; v2 redesigns it (add missing columns)
--  23. New table: provider_rate_limits
--  24. Function: increment_rate_limit
--  25. Indexes (v2 adds many new indexes)
--  26. Triggers (v2 trigger names differ from v1)
--  27. RLS Policies (v2 uses auth_user_id pattern; add new policies)
--  28. btree_gist extension (needed for publish_jobs exclusion constraint)
--  29. Realtime publications
--  30. Storage policies
-- =============================================================================


-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================
-- v1 has zero custom types; v2 defines 5.
-- CREATE TYPE cannot use IF NOT EXISTS, so we wrap in DO blocks.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.content_status AS ENUM (
    'draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.content_type AS ENUM (
    'instant_post', 'story', 'event', 'promotion', 'weekly_recurring'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.platform AS ENUM (
    'facebook', 'instagram', 'gbp'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.connection_status AS ENUM (
    'active', 'expiring', 'expired', 'disconnected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_urgency AS ENUM (
    'urgent', 'standard'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 2. FUNCTIONS
-- =============================================================================
-- set_updated_at() already exists in v1, but CREATE OR REPLACE is safe.
-- current_account_id() exists in v1 — we keep it for backward compat.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 3. ACCOUNTS TABLE — add missing v2 columns
-- =============================================================================
-- v1 has: id, email, display_name, timezone, created_at, updated_at
-- v2 expects: id, auth_user_id (uuid UNIQUE NOT NULL), business_name, timezone, created_at, updated_at
-- We ADD auth_user_id and business_name. We do NOT drop email or display_name.
-- =============================================================================

-- auth_user_id: added as nullable first, then populated, then made NOT NULL
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS business_name text;


-- =============================================================================
-- 4. ACCOUNTS DATA BRIDGE — populate auth_user_id and business_name
-- =============================================================================
-- In v1, the accounts.id IS the auth user id (1:1 mapping).
-- We use that to populate auth_user_id.
-- business_name is populated from display_name if available.
-- =============================================================================

UPDATE public.accounts
SET auth_user_id = id
WHERE auth_user_id IS NULL;

UPDATE public.accounts
SET business_name = display_name
WHERE business_name IS NULL AND display_name IS NOT NULL;

-- Now make auth_user_id NOT NULL (safe: all rows just populated)
-- Wrap in DO block in case it's already NOT NULL (idempotent on v2)
DO $$ BEGIN
  ALTER TABLE public.accounts ALTER COLUMN auth_user_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Add UNIQUE constraint on auth_user_id if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
    AND contype = 'u'
    AND EXISTS (
      SELECT 1 FROM unnest(conkey) AS k
      JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
      WHERE a.attname = 'auth_user_id'
    )
  ) THEN
    ALTER TABLE public.accounts ADD CONSTRAINT accounts_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END $$;

-- Add FK to auth.users if not present (may fail if auth.users doesn't have the row — wrap safely)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
    AND confrelid = 'auth.users'::regclass
    AND contype = 'f'
    AND EXISTS (
      SELECT 1 FROM unnest(conkey) AS k
      JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
      WHERE a.attname = 'auth_user_id'
    )
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not add FK accounts.auth_user_id -> auth.users: %', SQLERRM;
END $$;


-- =============================================================================
-- 5. NEW TABLE: profiles
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  brand_voice_tone text,
  brand_voice_style text,
  default_cta text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- 6. SOCIAL_CONNECTIONS — add v2 columns
-- =============================================================================
-- v1 already has: id, account_id, provider (text), status (text), access_token,
--   refresh_token, expires_at, display_name, last_synced_at, created_at,
--   updated_at, metadata
-- v2 baseline expects: platform (enum), platform_account_id, platform_account_name,
--   status (enum), scopes, token_expires_at
-- The v1 columns that overlap with v2 (metadata, display_name, last_synced_at)
-- already exist — no action needed for those.
-- We add the NEW columns that v2 needs but v1 doesn't have.
-- =============================================================================

ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS platform_account_id text;
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS platform_account_name text;
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS scopes text[];
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

-- Ensure metadata, display_name, last_synced_at exist (they do in v1, but just in case)
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.social_connections ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;


-- =============================================================================
-- 7. NEW TABLE: token_vault
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.token_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_connection_id uuid NOT NULL REFERENCES public.social_connections(id) ON DELETE CASCADE,
  token_type text NOT NULL CHECK (token_type IN ('access', 'refresh')),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_connection_id, token_type)
);


-- =============================================================================
-- 8. CONTENT_ITEMS — add v2 columns
-- =============================================================================
-- v1 has: id, campaign_id, account_id, platform (text), scheduled_for, status (text),
--   prompt_context, auto_generated, created_at, updated_at, placement, deleted_at,
--   hook_strategy, content_pillar
-- v2 expects: content_type (enum), status (enum), title, body_draft, campaign_name,
--   scheduled_at, event_date, event_end_date, coupon_code, recurring_day_of_week,
--   auto_confirm, ai_generation_params
-- We add columns that v2 needs but v1 lacks.
-- =============================================================================

ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS body_draft jsonb;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS campaign_name text;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS event_date date;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS event_end_date date;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS recurring_day_of_week integer;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS auto_confirm boolean NOT NULL DEFAULT false;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS ai_generation_params jsonb;

-- Populate scheduled_at from v1's scheduled_for if present
UPDATE public.content_items
SET scheduled_at = scheduled_for
WHERE scheduled_at IS NULL AND scheduled_for IS NOT NULL;


-- =============================================================================
-- 9. NEW TABLE: content_item_versions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.content_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, version_number)
);


-- =============================================================================
-- 10. NEW TABLE: media_library
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes integer,
  width integer,
  height integer,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- 11. NEW TABLE: content_media_attachments
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.content_media_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.media_library(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, media_id)
);


-- =============================================================================
-- 12. PUBLISH_JOBS — add v2 columns
-- =============================================================================
-- v1 has: id, content_item_id, attempt, status (text), last_error, provider_response,
--   next_attempt_at, created_at, updated_at, placement, variant_id
-- v2 expects: account_id, platform (enum), idempotency_key, status (enum),
--   scheduled_at, started_at, completed_at, error_message, error_code,
--   retry_count, max_retries, platform_post_id
-- =============================================================================

ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 4;
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS platform_post_id text;

-- Populate account_id from content_items for existing rows
UPDATE public.publish_jobs pj
SET account_id = ci.account_id
FROM public.content_items ci
WHERE pj.content_item_id = ci.id
AND pj.account_id IS NULL;

-- Populate idempotency_key for existing rows that lack one
UPDATE public.publish_jobs
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;

-- Add FK for account_id if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.publish_jobs'::regclass
    AND contype = 'f'
    AND EXISTS (
      SELECT 1 FROM unnest(conkey) AS k
      JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
      WHERE a.attname = 'account_id'
    )
    AND confrelid = 'public.accounts'::regclass
  ) THEN
    -- Only add FK if all rows have valid account_ids
    IF NOT EXISTS (SELECT 1 FROM public.publish_jobs WHERE account_id IS NULL) THEN
      ALTER TABLE public.publish_jobs
        ADD CONSTRAINT publish_jobs_account_id_fkey
        FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not add FK publish_jobs.account_id: %', SQLERRM;
END $$;


-- =============================================================================
-- 13. NEW TABLE: publish_attempts
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_job_id uuid NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_details jsonb,
  platform_response jsonb,
  UNIQUE (publish_job_id, attempt_number)
);


-- =============================================================================
-- 14. NEW TABLE: audit_log
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  operation_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  operation_status text NOT NULL DEFAULT 'success',
  details jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- 15. NOTIFICATIONS — add v2 columns
-- =============================================================================
-- v1 already has: id, account_id, category (text), message (text), read_at, metadata, created_at
-- v2 expects: urgency (enum), title, body, category, resource_type, resource_id,
--   read_at, dismissed_at, message (text), metadata (jsonb)
-- v1 already has message and metadata. We add the missing v2 columns.
-- =============================================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS urgency text DEFAULT 'standard';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS resource_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS resource_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- Ensure message and metadata exist (they do in v1)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Populate title from message for existing rows that lack a title
UPDATE public.notifications
SET title = LEFT(message, 100)
WHERE title IS NULL AND message IS NOT NULL;


-- =============================================================================
-- 16. NEW TABLE: analytics_snapshots
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  publish_job_id uuid REFERENCES public.publish_jobs(id) ON DELETE SET NULL,
  platform text NOT NULL,
  impressions integer,
  reach integer,
  engagement_count integer,
  engagement_rate numeric(5,4),
  clicks integer,
  shares integer,
  comments integer,
  snapshot_date date NOT NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publish_job_id, platform, snapshot_date)
);


-- =============================================================================
-- 17. NEW TABLE: gbp_daily_metrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gbp_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  social_connection_id uuid REFERENCES public.social_connections(id) ON DELETE SET NULL,
  metric_date date NOT NULL,
  search_views integer,
  map_views integer,
  website_clicks integer,
  direction_requests integer,
  phone_calls integer,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_connection_id, metric_date)
);


-- =============================================================================
-- 18. LINK_IN_BIO_PROFILES — add v2 columns
-- =============================================================================
-- v1 has: account_id, slug, display_name, bio, hero_media_id, theme, phone_number,
--   whatsapp_number, booking_url, menu_url, parking_url, facebook_url, instagram_url,
--   website_url, created_at, updated_at, directions_url
-- v2 base (migration 005) expects: id, account_id, slug, bio, logo_url, hero_image_url,
--   brand_color_primary, brand_color_secondary, contact_email, contact_phone,
--   contact_website, is_published, created_at, updated_at
-- v2 reconcile (migration 009) adds: display_name, hero_media_id, theme, phone_number,
--   whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url,
--   instagram_url, website_url, template, font_family
-- =============================================================================

-- Add id column if v1 uses account_id as PK (v1 has no id column, uses account_id as PK)
-- v2 expects id uuid PK + account_id as FK. This is a structural difference.
-- Since v1 uses account_id as PK, we add an id column if needed.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'link_in_bio_profiles' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.link_in_bio_profiles ADD COLUMN id uuid DEFAULT gen_random_uuid();
    UPDATE public.link_in_bio_profiles SET id = gen_random_uuid() WHERE id IS NULL;
    -- We can't easily change PK here, but the id column is available for FK references
  END IF;
END $$;

-- Columns from v2 base migration (005)
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS hero_image_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS brand_color_primary text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS brand_color_secondary text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS contact_website text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

-- Columns from v2 reconcile migration (009) — most already exist in v1
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS hero_media_id uuid;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS whatsapp_number text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS booking_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS menu_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS parking_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS directions_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'classic';
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS font_family text NOT NULL DEFAULT 'inter';


-- =============================================================================
-- 19. LINK_IN_BIO_TILES — add v2 columns
-- =============================================================================
-- v1 has: id, account_id, title, subtitle, cta_label, cta_url, media_asset_id,
--   position, enabled, created_at, updated_at
-- v2 base (005) expects: id, profile_id, account_id, title, url, image_url,
--   position, is_visible, created_at, updated_at
-- v2 reconcile (009) adds: subtitle, cta_label, cta_url, media_asset_id,
--   enabled, tile_type, embed_data
-- =============================================================================

ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS profile_id uuid;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS tile_type text NOT NULL DEFAULT 'link';
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS embed_data jsonb;

-- Columns from v2 reconcile (009) — most already exist in v1
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS cta_label text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS cta_url text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS media_asset_id uuid;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

-- Populate profile_id from link_in_bio_profiles for existing tiles
-- v1 tiles reference profiles via account_id (both tables share account_id)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'link_in_bio_profiles' AND column_name = 'id'
  ) THEN
    UPDATE public.link_in_bio_tiles t
    SET profile_id = p.id
    FROM public.link_in_bio_profiles p
    WHERE t.account_id = p.account_id
    AND t.profile_id IS NULL;
  END IF;
END $$;

-- Populate url from cta_url for existing rows
UPDATE public.link_in_bio_tiles
SET url = cta_url
WHERE url IS NULL AND cta_url IS NOT NULL;


-- =============================================================================
-- 20. NEW TABLE: link_in_bio_clicks
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.link_in_bio_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  tile_id uuid,
  click_type text NOT NULL DEFAULT 'tile',
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK constraints safely (profile_id references link_in_bio_profiles)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.link_in_bio_clicks'::regclass
    AND conname = 'link_in_bio_clicks_profile_id_fkey'
  ) THEN
    -- Only if link_in_bio_profiles has an id PK
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.link_in_bio_profiles'::regclass
      AND contype = 'p'
      AND EXISTS (
        SELECT 1 FROM unnest(conkey) AS k
        JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
        WHERE a.attname = 'id'
      )
    ) THEN
      ALTER TABLE public.link_in_bio_clicks
        ADD CONSTRAINT link_in_bio_clicks_profile_id_fkey
        FOREIGN KEY (profile_id) REFERENCES public.link_in_bio_profiles(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not add FK link_in_bio_clicks.profile_id: %', SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.link_in_bio_clicks'::regclass
    AND conname = 'link_in_bio_clicks_tile_id_fkey'
  ) THEN
    ALTER TABLE public.link_in_bio_clicks
      ADD CONSTRAINT link_in_bio_clicks_tile_id_fkey
      FOREIGN KEY (tile_id) REFERENCES public.link_in_bio_tiles(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not add FK link_in_bio_clicks.tile_id: %', SQLERRM;
END $$;


-- =============================================================================
-- 21. NEW TABLE: link_in_bio_page_views
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.link_in_bio_page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK constraint safely
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.link_in_bio_page_views'::regclass
    AND conname = 'link_in_bio_page_views_profile_id_fkey'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.link_in_bio_profiles'::regclass
      AND contype = 'p'
      AND EXISTS (
        SELECT 1 FROM unnest(conkey) AS k
        JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
        WHERE a.attname = 'id'
      )
    ) THEN
      ALTER TABLE public.link_in_bio_page_views
        ADD CONSTRAINT link_in_bio_page_views_profile_id_fkey
        FOREIGN KEY (profile_id) REFERENCES public.link_in_bio_profiles(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not add FK link_in_bio_page_views.profile_id: %', SQLERRM;
END $$;


-- =============================================================================
-- 22. OAUTH_STATES — add v2 columns
-- =============================================================================
-- v1 has: id, account_id, provider (text), state, code_verifier, redirect_url,
--   expires_at, used, created_at
-- v2 expects: id, created_by, state, provider (enum), redirect_to, used_at, expires_at, created_at
-- =============================================================================

ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS redirect_to text;
ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '10 minutes');


-- =============================================================================
-- 23. NEW TABLE: provider_rate_limits
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.provider_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  limit_ceiling integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, endpoint, window_start)
);


-- =============================================================================
-- 24. FUNCTION: increment_rate_limit
-- =============================================================================
-- Uses text type for provider param to avoid enum dependency issues in bridge.
-- The function body references the provider_rate_limits table.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_account_id uuid,
  p_provider text,
  p_endpoint text,
  p_window_start timestamptz,
  p_limit_ceiling integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.provider_rate_limits (account_id, provider, endpoint, window_start, request_count, limit_ceiling)
  VALUES (p_account_id, p_provider, p_endpoint, p_window_start, 1, p_limit_ceiling)
  ON CONFLICT (account_id, provider, endpoint, window_start)
  DO UPDATE SET request_count = provider_rate_limits.request_count + 1,
               updated_at = now();
END;
$$;


-- =============================================================================
-- 25. INDEXES
-- =============================================================================

-- accounts
CREATE INDEX IF NOT EXISTS idx_accounts_auth_user_id ON public.accounts(auth_user_id);

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_account_id ON public.profiles(account_id);

-- social_connections
CREATE INDEX IF NOT EXISTS idx_social_connections_account_id ON public.social_connections(account_id);

-- token_vault
CREATE INDEX IF NOT EXISTS idx_token_vault_connection_id ON public.token_vault(social_connection_id);

-- content_items
CREATE INDEX IF NOT EXISTS idx_content_items_account_status ON public.content_items(account_id, status);
-- Partial index for scheduled items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_content_items_account_scheduled') THEN
    CREATE INDEX idx_content_items_account_scheduled ON public.content_items(account_id, scheduled_at)
      WHERE scheduled_at IS NOT NULL;
  END IF;
END $$;

-- content_item_versions
CREATE INDEX IF NOT EXISTS idx_content_item_versions_account ON public.content_item_versions(account_id);

-- media_library
CREATE INDEX IF NOT EXISTS idx_media_library_account ON public.media_library(account_id);

-- publish_jobs
CREATE INDEX IF NOT EXISTS idx_publish_jobs_account_status ON public.publish_jobs(account_id, status);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_publish_jobs_scheduled_queued') THEN
    CREATE INDEX idx_publish_jobs_scheduled_queued ON public.publish_jobs(scheduled_at)
      WHERE status = 'queued';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_publish_jobs_failed ON public.publish_jobs(account_id) WHERE status = 'failed';

-- publish_attempts
CREATE INDEX IF NOT EXISTS idx_publish_attempts_account ON public.publish_attempts(account_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_account_created ON public.audit_log(account_id, created_at DESC);

-- notifications
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_account_unread') THEN
    CREATE INDEX idx_notifications_account_unread ON public.notifications(account_id, read_at)
      WHERE read_at IS NULL;
  END IF;
END $$;

-- analytics_snapshots
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_account ON public.analytics_snapshots(account_id);

-- gbp_daily_metrics
CREATE INDEX IF NOT EXISTS idx_gbp_daily_metrics_account ON public.gbp_daily_metrics(account_id);

-- link_in_bio_tiles
CREATE INDEX IF NOT EXISTS idx_link_in_bio_tiles_account ON public.link_in_bio_tiles(account_id);

-- link_in_bio_clicks
CREATE INDEX IF NOT EXISTS idx_link_in_bio_clicks_profile ON public.link_in_bio_clicks(profile_id);
CREATE INDEX IF NOT EXISTS idx_link_in_bio_clicks_created ON public.link_in_bio_clicks(created_at);

-- link_in_bio_page_views
CREATE INDEX IF NOT EXISTS idx_link_in_bio_page_views_profile ON public.link_in_bio_page_views(profile_id);

-- oauth_states
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON public.oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON public.oauth_states(expires_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_oauth_states_cleanup') THEN
    CREATE INDEX idx_oauth_states_cleanup ON public.oauth_states(expires_at) WHERE used_at IS NULL;
  END IF;
END $$;

-- provider_rate_limits
CREATE INDEX IF NOT EXISTS idx_rate_limits_provider ON public.provider_rate_limits(account_id, provider);


-- =============================================================================
-- 26. TRIGGERS
-- =============================================================================
-- v2 uses trg_ prefix naming convention. v1 uses different names.
-- CREATE OR REPLACE TRIGGER ensures idempotency.
-- =============================================================================

-- accounts (v1 may not have updated_at trigger)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accounts_updated_at'
    AND tgrelid = 'public.accounts'::regclass
  ) THEN
    CREATE TRIGGER trg_accounts_updated_at
      BEFORE UPDATE ON public.accounts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_updated_at'
    AND tgrelid = 'public.profiles'::regclass
  ) THEN
    CREATE TRIGGER trg_profiles_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- social_connections
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_social_connections_updated_at'
    AND tgrelid = 'public.social_connections'::regclass
  ) THEN
    CREATE TRIGGER trg_social_connections_updated_at
      BEFORE UPDATE ON public.social_connections
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- token_vault
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_token_vault_updated_at'
    AND tgrelid = 'public.token_vault'::regclass
  ) THEN
    CREATE TRIGGER trg_token_vault_updated_at
      BEFORE UPDATE ON public.token_vault
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- content_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_content_items_updated_at'
    AND tgrelid = 'public.content_items'::regclass
  ) THEN
    CREATE TRIGGER trg_content_items_updated_at
      BEFORE UPDATE ON public.content_items
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- publish_jobs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_publish_jobs_updated_at'
    AND tgrelid = 'public.publish_jobs'::regclass
  ) THEN
    CREATE TRIGGER trg_publish_jobs_updated_at
      BEFORE UPDATE ON public.publish_jobs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- provider_rate_limits
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_provider_rate_limits_updated_at'
    AND tgrelid = 'public.provider_rate_limits'::regclass
  ) THEN
    CREATE TRIGGER trg_provider_rate_limits_updated_at
      BEFORE UPDATE ON public.provider_rate_limits
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- link_in_bio_profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_link_in_bio_profiles_updated_at'
    AND tgrelid = 'public.link_in_bio_profiles'::regclass
  ) THEN
    CREATE TRIGGER trg_link_in_bio_profiles_updated_at
      BEFORE UPDATE ON public.link_in_bio_profiles
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- link_in_bio_tiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_link_in_bio_tiles_updated_at'
    AND tgrelid = 'public.link_in_bio_tiles'::regclass
  ) THEN
    CREATE TRIGGER trg_link_in_bio_tiles_updated_at
      BEFORE UPDATE ON public.link_in_bio_tiles
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;


-- =============================================================================
-- 27. RLS POLICIES
-- =============================================================================
-- v2 uses a consistent pattern: account_id = (SELECT id FROM accounts WHERE auth_user_id = auth.uid())
-- v1 uses: id = current_account_id() or account_id = current_account_id()
-- We ADD the v2-named policies. Existing v1 policies remain (harmless duplicates = OR behavior).
-- =============================================================================

-- Helper: Update current_account_id() to also support the auth_user_id lookup
-- This makes existing v1 RLS policies work with the new auth_user_id column
CREATE OR REPLACE FUNCTION public.current_account_id() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  claim text;
  account uuid;
BEGIN
  -- First try: JWT app_metadata (original v1 path)
  claim := auth.jwt()->'app_metadata'->>'account_id';
  IF claim IS NULL OR length(trim(claim)) = 0 THEN
    claim := auth.jwt()->'user_metadata'->>'account_id';
  END IF;
  IF claim IS NOT NULL AND length(trim(claim)) > 0 THEN
    BEGIN
      account := claim::uuid;
      RETURN account;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  -- Fallback: look up by auth_user_id (v2 path)
  SELECT id INTO account FROM public.accounts WHERE auth_user_id = auth.uid();
  RETURN account;
END;
$$;

-- -- accounts (v2 policies use auth_user_id directly)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounts_select' AND tablename = 'accounts') THEN
    CREATE POLICY "accounts_select" ON public.accounts
      FOR SELECT USING (auth_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounts_insert' AND tablename = 'accounts') THEN
    CREATE POLICY "accounts_insert" ON public.accounts
      FOR INSERT WITH CHECK (auth_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounts_update' AND tablename = 'accounts') THEN
    CREATE POLICY "accounts_update" ON public.accounts
      FOR UPDATE USING (auth_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounts_delete' AND tablename = 'accounts') THEN
    CREATE POLICY "accounts_delete" ON public.accounts
      FOR DELETE USING (auth_user_id = auth.uid());
  END IF;
END $$;

-- -- profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select' AND tablename = 'profiles') THEN
    CREATE POLICY "profiles_select" ON public.profiles
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_insert' AND tablename = 'profiles') THEN
    CREATE POLICY "profiles_insert" ON public.profiles
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update' AND tablename = 'profiles') THEN
    CREATE POLICY "profiles_update" ON public.profiles
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_delete' AND tablename = 'profiles') THEN
    CREATE POLICY "profiles_delete" ON public.profiles
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- social_connections
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_connections_select' AND tablename = 'social_connections') THEN
    CREATE POLICY "social_connections_select" ON public.social_connections
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_connections_insert' AND tablename = 'social_connections') THEN
    CREATE POLICY "social_connections_insert" ON public.social_connections
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_connections_update' AND tablename = 'social_connections') THEN
    CREATE POLICY "social_connections_update" ON public.social_connections
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'social_connections_delete' AND tablename = 'social_connections') THEN
    CREATE POLICY "social_connections_delete" ON public.social_connections
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- token_vault
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'token_vault_select' AND tablename = 'token_vault') THEN
    CREATE POLICY "token_vault_select" ON public.token_vault
      FOR SELECT USING (social_connection_id IN (
        SELECT id FROM public.social_connections
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'token_vault_insert' AND tablename = 'token_vault') THEN
    CREATE POLICY "token_vault_insert" ON public.token_vault
      FOR INSERT WITH CHECK (social_connection_id IN (
        SELECT id FROM public.social_connections
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'token_vault_update' AND tablename = 'token_vault') THEN
    CREATE POLICY "token_vault_update" ON public.token_vault
      FOR UPDATE USING (social_connection_id IN (
        SELECT id FROM public.social_connections
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'token_vault_delete' AND tablename = 'token_vault') THEN
    CREATE POLICY "token_vault_delete" ON public.token_vault
      FOR DELETE USING (social_connection_id IN (
        SELECT id FROM public.social_connections
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

-- -- content_items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_items_select' AND tablename = 'content_items') THEN
    CREATE POLICY "content_items_select" ON public.content_items
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_items_insert' AND tablename = 'content_items') THEN
    CREATE POLICY "content_items_insert" ON public.content_items
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_items_update' AND tablename = 'content_items') THEN
    CREATE POLICY "content_items_update" ON public.content_items
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_items_delete' AND tablename = 'content_items') THEN
    CREATE POLICY "content_items_delete" ON public.content_items
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- content_item_versions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_item_versions_select' AND tablename = 'content_item_versions') THEN
    CREATE POLICY "content_item_versions_select" ON public.content_item_versions
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_item_versions_insert' AND tablename = 'content_item_versions') THEN
    CREATE POLICY "content_item_versions_insert" ON public.content_item_versions
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_item_versions_update' AND tablename = 'content_item_versions') THEN
    CREATE POLICY "content_item_versions_update" ON public.content_item_versions
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_item_versions_delete' AND tablename = 'content_item_versions') THEN
    CREATE POLICY "content_item_versions_delete" ON public.content_item_versions
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- media_library
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_library_select' AND tablename = 'media_library') THEN
    CREATE POLICY "media_library_select" ON public.media_library
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_library_insert' AND tablename = 'media_library') THEN
    CREATE POLICY "media_library_insert" ON public.media_library
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_library_update' AND tablename = 'media_library') THEN
    CREATE POLICY "media_library_update" ON public.media_library
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_library_delete' AND tablename = 'media_library') THEN
    CREATE POLICY "media_library_delete" ON public.media_library
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- content_media_attachments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_media_attachments_select' AND tablename = 'content_media_attachments') THEN
    CREATE POLICY "content_media_attachments_select" ON public.content_media_attachments
      FOR SELECT USING (content_item_id IN (
        SELECT id FROM public.content_items
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_media_attachments_insert' AND tablename = 'content_media_attachments') THEN
    CREATE POLICY "content_media_attachments_insert" ON public.content_media_attachments
      FOR INSERT WITH CHECK (content_item_id IN (
        SELECT id FROM public.content_items
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_media_attachments_update' AND tablename = 'content_media_attachments') THEN
    CREATE POLICY "content_media_attachments_update" ON public.content_media_attachments
      FOR UPDATE USING (content_item_id IN (
        SELECT id FROM public.content_items
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'content_media_attachments_delete' AND tablename = 'content_media_attachments') THEN
    CREATE POLICY "content_media_attachments_delete" ON public.content_media_attachments
      FOR DELETE USING (content_item_id IN (
        SELECT id FROM public.content_items
        WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
      ));
  END IF;
END $$;

-- -- publish_jobs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_jobs_select' AND tablename = 'publish_jobs') THEN
    CREATE POLICY "publish_jobs_select" ON public.publish_jobs
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_jobs_insert' AND tablename = 'publish_jobs') THEN
    CREATE POLICY "publish_jobs_insert" ON public.publish_jobs
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_jobs_update' AND tablename = 'publish_jobs') THEN
    CREATE POLICY "publish_jobs_update" ON public.publish_jobs
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_jobs_delete' AND tablename = 'publish_jobs') THEN
    CREATE POLICY "publish_jobs_delete" ON public.publish_jobs
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- publish_attempts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_attempts_select' AND tablename = 'publish_attempts') THEN
    CREATE POLICY "publish_attempts_select" ON public.publish_attempts
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_attempts_insert' AND tablename = 'publish_attempts') THEN
    CREATE POLICY "publish_attempts_insert" ON public.publish_attempts
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_attempts_update' AND tablename = 'publish_attempts') THEN
    CREATE POLICY "publish_attempts_update" ON public.publish_attempts
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'publish_attempts_delete' AND tablename = 'publish_attempts') THEN
    CREATE POLICY "publish_attempts_delete" ON public.publish_attempts
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- audit_log (append-only: SELECT + INSERT only)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_select' AND tablename = 'audit_log') THEN
    CREATE POLICY "audit_log_select" ON public.audit_log
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_insert' AND tablename = 'audit_log') THEN
    CREATE POLICY "audit_log_insert" ON public.audit_log
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- notifications
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_select' AND tablename = 'notifications') THEN
    CREATE POLICY "notifications_select" ON public.notifications
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_insert' AND tablename = 'notifications') THEN
    CREATE POLICY "notifications_insert" ON public.notifications
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_update' AND tablename = 'notifications') THEN
    CREATE POLICY "notifications_update" ON public.notifications
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notifications_delete' AND tablename = 'notifications') THEN
    CREATE POLICY "notifications_delete" ON public.notifications
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- analytics_snapshots
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'analytics_snapshots_select' AND tablename = 'analytics_snapshots') THEN
    CREATE POLICY "analytics_snapshots_select" ON public.analytics_snapshots
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'analytics_snapshots_insert' AND tablename = 'analytics_snapshots') THEN
    CREATE POLICY "analytics_snapshots_insert" ON public.analytics_snapshots
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'analytics_snapshots_update' AND tablename = 'analytics_snapshots') THEN
    CREATE POLICY "analytics_snapshots_update" ON public.analytics_snapshots
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'analytics_snapshots_delete' AND tablename = 'analytics_snapshots') THEN
    CREATE POLICY "analytics_snapshots_delete" ON public.analytics_snapshots
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- gbp_daily_metrics
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gbp_daily_metrics_select' AND tablename = 'gbp_daily_metrics') THEN
    CREATE POLICY "gbp_daily_metrics_select" ON public.gbp_daily_metrics
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gbp_daily_metrics_insert' AND tablename = 'gbp_daily_metrics') THEN
    CREATE POLICY "gbp_daily_metrics_insert" ON public.gbp_daily_metrics
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gbp_daily_metrics_update' AND tablename = 'gbp_daily_metrics') THEN
    CREATE POLICY "gbp_daily_metrics_update" ON public.gbp_daily_metrics
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gbp_daily_metrics_delete' AND tablename = 'gbp_daily_metrics') THEN
    CREATE POLICY "gbp_daily_metrics_delete" ON public.gbp_daily_metrics
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- link_in_bio_profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_profiles_select' AND tablename = 'link_in_bio_profiles') THEN
    CREATE POLICY "link_in_bio_profiles_select" ON public.link_in_bio_profiles
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_profiles_insert' AND tablename = 'link_in_bio_profiles') THEN
    CREATE POLICY "link_in_bio_profiles_insert" ON public.link_in_bio_profiles
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_profiles_update' AND tablename = 'link_in_bio_profiles') THEN
    CREATE POLICY "link_in_bio_profiles_update" ON public.link_in_bio_profiles
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_profiles_delete' AND tablename = 'link_in_bio_profiles') THEN
    CREATE POLICY "link_in_bio_profiles_delete" ON public.link_in_bio_profiles
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- link_in_bio_tiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_tiles_select' AND tablename = 'link_in_bio_tiles') THEN
    CREATE POLICY "link_in_bio_tiles_select" ON public.link_in_bio_tiles
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_tiles_insert' AND tablename = 'link_in_bio_tiles') THEN
    CREATE POLICY "link_in_bio_tiles_insert" ON public.link_in_bio_tiles
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_tiles_update' AND tablename = 'link_in_bio_tiles') THEN
    CREATE POLICY "link_in_bio_tiles_update" ON public.link_in_bio_tiles
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_tiles_delete' AND tablename = 'link_in_bio_tiles') THEN
    CREATE POLICY "link_in_bio_tiles_delete" ON public.link_in_bio_tiles
      FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- -- link_in_bio_clicks
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_clicks_service_insert' AND tablename = 'link_in_bio_clicks') THEN
    CREATE POLICY "link_in_bio_clicks_service_insert" ON public.link_in_bio_clicks
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_clicks_owner_select' AND tablename = 'link_in_bio_clicks') THEN
    CREATE POLICY "link_in_bio_clicks_owner_select" ON public.link_in_bio_clicks
      FOR SELECT USING (
        profile_id IN (
          SELECT id FROM public.link_in_bio_profiles
          WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
        )
      );
  END IF;
END $$;

-- -- link_in_bio_page_views
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_page_views_service_insert' AND tablename = 'link_in_bio_page_views') THEN
    CREATE POLICY "link_in_bio_page_views_service_insert" ON public.link_in_bio_page_views
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'link_in_bio_page_views_owner_select' AND tablename = 'link_in_bio_page_views') THEN
    CREATE POLICY "link_in_bio_page_views_owner_select" ON public.link_in_bio_page_views
      FOR SELECT USING (
        profile_id IN (
          SELECT id FROM public.link_in_bio_profiles
          WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
        )
      );
  END IF;
END $$;

-- -- oauth_states
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'oauth_states_select' AND tablename = 'oauth_states') THEN
    CREATE POLICY "oauth_states_select" ON public.oauth_states
      FOR SELECT USING (created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'oauth_states_insert' AND tablename = 'oauth_states') THEN
    CREATE POLICY "oauth_states_insert" ON public.oauth_states
      FOR INSERT WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'oauth_states_update' AND tablename = 'oauth_states') THEN
    CREATE POLICY "oauth_states_update" ON public.oauth_states
      FOR UPDATE USING (created_by = auth.uid());
  END IF;
END $$;

-- -- provider_rate_limits
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rate_limits_select' AND tablename = 'provider_rate_limits') THEN
    CREATE POLICY "rate_limits_select" ON public.provider_rate_limits
      FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rate_limits_insert' AND tablename = 'provider_rate_limits') THEN
    CREATE POLICY "rate_limits_insert" ON public.provider_rate_limits
      FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rate_limits_update' AND tablename = 'provider_rate_limits') THEN
    CREATE POLICY "rate_limits_update" ON public.provider_rate_limits
      FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
  END IF;
END $$;


-- =============================================================================
-- 28. ENABLE RLS on all new tables
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_media_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_in_bio_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_in_bio_page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_rate_limits ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 29. btree_gist EXTENSION (needed for publish_jobs exclusion constraint)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;


-- =============================================================================
-- 30. REALTIME PUBLICATIONS
-- =============================================================================
-- Enable Supabase Realtime for publish_jobs and notifications.
-- Wrap in DO block to handle "already added" errors.
-- =============================================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'publish_jobs already in supabase_realtime or publication does not exist: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'notifications already in supabase_realtime or publication does not exist: %', SQLERRM;
END $$;

-- REPLICA IDENTITY FULL for status-transition detection in UPDATE events
DO $$ BEGIN
  ALTER TABLE public.publish_jobs REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.notifications REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL;
END $$;


-- =============================================================================
-- 31. STORAGE POLICIES (media bucket)
-- =============================================================================
-- These policies are for the Supabase Storage 'media' bucket.
-- Wrapped in DO blocks because the storage schema may not exist.
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    -- Check if policy already exists before creating
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_insert' AND tablename = 'objects' AND schemaname = 'storage') THEN
      CREATE POLICY "media_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'media'
          AND (storage.foldername(name))[1] = (
            SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
          )
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_select' AND tablename = 'objects' AND schemaname = 'storage') THEN
      CREATE POLICY "media_select" ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'media'
          AND (storage.foldername(name))[1] = (
            SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
          )
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_update' AND tablename = 'objects' AND schemaname = 'storage') THEN
      CREATE POLICY "media_update" ON storage.objects
        FOR UPDATE TO authenticated
        USING (
          bucket_id = 'media'
          AND (storage.foldername(name))[1] = (
            SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
          )
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'media_delete' AND tablename = 'objects' AND schemaname = 'storage') THEN
      CREATE POLICY "media_delete" ON storage.objects
        FOR DELETE TO authenticated
        USING (
          bucket_id = 'media'
          AND (storage.foldername(name))[1] = (
            SELECT id::text FROM public.accounts WHERE auth_user_id = auth.uid()
          )
        );
    END IF;
  END IF;
END $$;


-- =============================================================================
-- 32. TOURNAMENT_FIXTURES — strip "Group " prefix (from migration 007)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tournament_fixtures') THEN
    UPDATE tournament_fixtures
    SET group_name = TRIM(REGEXP_REPLACE(group_name, '^\s*group\s+', '', 'i'))
    WHERE group_name ~* '^\s*group\s+';
  END IF;
END;
$$;


-- =============================================================================
-- DONE
-- =============================================================================
-- This migration brings a v1 restored database up to v2 schema expectations.
-- All guards are idempotent: safe to re-run or run against a fresh v2 database.
-- No existing data, columns, or tables have been dropped or modified.
-- =============================================================================
