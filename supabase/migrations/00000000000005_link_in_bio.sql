-- =============================================================================
-- Link-in-Bio Domain Migration
-- =============================================================================
-- Creates link-in-bio tables:
--   link_in_bio_profiles, link_in_bio_tiles (DATA-10)
-- Max 12 tiles per profile enforced via CHECK constraint (DATA-10/LIB-03).
-- Schema-only in Phase 1; built in Phase 6.
-- RLS enabled on all tables with account-scoped policies (D-11).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: link_in_bio_profiles (DATA-10)
-- ---------------------------------------------------------------------------

CREATE TABLE public.link_in_bio_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  bio text,
  logo_url text,
  hero_image_url text,
  brand_color_primary text,
  brand_color_secondary text,
  contact_email text,
  contact_phone text,
  contact_website text,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_link_in_bio_profiles_updated_at
  BEFORE UPDATE ON public.link_in_bio_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.link_in_bio_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "link_in_bio_profiles_select" ON public.link_in_bio_profiles
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_profiles_insert" ON public.link_in_bio_profiles
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_profiles_update" ON public.link_in_bio_profiles
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_profiles_delete" ON public.link_in_bio_profiles
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: link_in_bio_tiles (DATA-10: max 12 tiles per LIB-03)
-- ---------------------------------------------------------------------------

CREATE TABLE public.link_in_bio_tiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.link_in_bio_profiles(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text,
  image_url text,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 11),
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_link_in_bio_tiles_account ON public.link_in_bio_tiles(account_id);

CREATE TRIGGER trg_link_in_bio_tiles_updated_at
  BEFORE UPDATE ON public.link_in_bio_tiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.link_in_bio_tiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "link_in_bio_tiles_select" ON public.link_in_bio_tiles
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_tiles_insert" ON public.link_in_bio_tiles
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_tiles_update" ON public.link_in_bio_tiles
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "link_in_bio_tiles_delete" ON public.link_in_bio_tiles
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
