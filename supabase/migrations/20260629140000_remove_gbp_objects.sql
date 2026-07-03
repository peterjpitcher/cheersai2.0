-- Remove Google Business Profile (GBP) database objects.
--
-- GBP support (posting, reviews, metrics, OAuth) has been removed from the
-- application. These tables are empty in production, and the columns/connection
-- are no longer referenced by any code. No functions, triggers, or views
-- reference these objects (verified against the live catalog).
--
-- Idempotent (IF EXISTS) so it is safe on both production (objects present) and
-- fresh builds from the migration chain (some columns live only in the v1
-- baseline). Drop order matters: gbp_daily_metrics holds an FK to
-- social_connections, so the table is dropped before the connection row.

-- 1. GBP-only tables (RLS policies drop with them). Both are empty in prod.
DROP TABLE IF EXISTS public.gbp_reviews;
DROP TABLE IF EXISTS public.gbp_daily_metrics;

-- 2. GBP-specific columns on retained tables.
ALTER TABLE public.brand_profile
  DROP COLUMN IF EXISTS gbp_cta;

ALTER TABLE public.posting_defaults
  DROP COLUMN IF EXISTS gbp_location_id,
  DROP COLUMN IF EXISTS gbp_cta_standard,
  DROP COLUMN IF EXISTS gbp_cta_event,
  DROP COLUMN IF EXISTS gbp_cta_offer;

-- 3. Remove the GBP OAuth connection (cascades to token_vault) and any
--    transient OAuth state rows.
--
--    social_connections identifies the connection type via a different column
--    depending on build lineage: the v1->v2 production database carries the
--    legacy `provider` (text) column, while the v2 baseline migration chain
--    creates `platform` (enum) and never adds `provider`. Guard on whichever
--    column actually exists so this migration applies cleanly on both lineages.
--    On a fresh build the table is empty, so the matching DELETE simply no-ops.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'social_connections'
      AND column_name = 'provider'
  ) THEN
    DELETE FROM public.social_connections WHERE provider = 'gbp';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'social_connections'
      AND column_name = 'platform'
  ) THEN
    DELETE FROM public.social_connections WHERE platform::text = 'gbp';
  END IF;
END $$;

-- oauth_states.provider exists on both lineages (v1 text column; v2 baseline
-- enum via 00000000000007_provider_integration), so this DELETE is safe as-is.
DELETE FROM public.oauth_states WHERE provider = 'gbp';

-- NOTE: the 'gbp' value is intentionally left in the public.platform ENUM.
-- No column uses that enum type (all platform/provider columns are text), so
-- the value is inert; removing it would require a full ENUM rebuild for no
-- functional gain. Historical content_items rows with platform='gbp' or 'gbp'
-- in body_draft.platforms are left as-is (harmless — the app filters to
-- Facebook/Instagram).
