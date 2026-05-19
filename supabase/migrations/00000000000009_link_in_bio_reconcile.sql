-- =============================================================================
-- Link-in-Bio Schema Reconciliation Migration
-- =============================================================================
-- Reconciles the base link_in_bio_profiles and link_in_bio_tiles schema
-- (migration 00000000000005) with columns the application code already expects,
-- plus new columns for D-01 (tile types), D-03 (brand customisation), and
-- D-08 (layout templates).
--
-- Also creates click tracking (link_in_bio_clicks) and page view tracking
-- (link_in_bio_page_views) tables for server-side analytics (D-09, LIB-05).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- link_in_bio_profiles: columns code expects but base migration lacks
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- link_in_bio_profiles: new columns for D-03 (brand customisation) & D-08 (templates)
-- ---------------------------------------------------------------------------

ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'classic';
ALTER TABLE public.link_in_bio_profiles ADD COLUMN IF NOT EXISTS font_family text NOT NULL DEFAULT 'inter';

-- ---------------------------------------------------------------------------
-- link_in_bio_tiles: columns code expects but base migration lacks
-- ---------------------------------------------------------------------------

ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS cta_label text NOT NULL DEFAULT 'Visit';
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS cta_url text;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS media_asset_id uuid;
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- link_in_bio_tiles: new columns for D-01 (tile types / embeds)
-- tile_type enum values: 'link', 'media', 'embed_map', 'embed_menu',
--   'embed_social', 'embed_events'
-- ---------------------------------------------------------------------------

ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS tile_type text NOT NULL DEFAULT 'link';
ALTER TABLE public.link_in_bio_tiles ADD COLUMN IF NOT EXISTS embed_data jsonb;

-- ---------------------------------------------------------------------------
-- Table: link_in_bio_clicks (D-09, LIB-05 -- server-side click tracking)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.link_in_bio_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.link_in_bio_profiles(id) ON DELETE CASCADE,
  tile_id uuid REFERENCES public.link_in_bio_tiles(id) ON DELETE SET NULL,
  click_type text NOT NULL DEFAULT 'tile',
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_in_bio_clicks_profile ON public.link_in_bio_clicks(profile_id);
CREATE INDEX IF NOT EXISTS idx_link_in_bio_clicks_created ON public.link_in_bio_clicks(created_at);

ALTER TABLE public.link_in_bio_clicks ENABLE ROW LEVEL SECURITY;

-- Service-role INSERT: public page visitors are anonymous, no auth.uid()
CREATE POLICY "link_in_bio_clicks_service_insert" ON public.link_in_bio_clicks
  FOR INSERT WITH CHECK (true);

-- SELECT restricted to account owner via profile join
CREATE POLICY "link_in_bio_clicks_owner_select" ON public.link_in_bio_clicks
  FOR SELECT USING (
    profile_id IN (
      SELECT id FROM public.link_in_bio_profiles
      WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Table: link_in_bio_page_views (server-side page view tracking)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.link_in_bio_page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.link_in_bio_profiles(id) ON DELETE CASCADE,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_in_bio_page_views_profile ON public.link_in_bio_page_views(profile_id);

ALTER TABLE public.link_in_bio_page_views ENABLE ROW LEVEL SECURITY;

-- Service-role INSERT: public page visitors are anonymous
CREATE POLICY "link_in_bio_page_views_service_insert" ON public.link_in_bio_page_views
  FOR INSERT WITH CHECK (true);

-- SELECT restricted to account owner via profile join
CREATE POLICY "link_in_bio_page_views_owner_select" ON public.link_in_bio_page_views
  FOR SELECT USING (
    profile_id IN (
      SELECT id FROM public.link_in_bio_profiles
      WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
    )
  );
