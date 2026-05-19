-- =============================================================================
-- Baseline Migration: Core Tables
-- =============================================================================
-- Creates foundational tables that all domain tables reference:
--   accounts, profiles, social_connections, token_vault
-- Also defines shared enum types and the reusable set_updated_at() trigger.
-- RLS enabled on every table with account-scoped policies (D-11).
-- Token vault stores encrypted ciphertext only -- no plain-text tokens (D-03).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum Types (shared across domains)
-- ---------------------------------------------------------------------------

CREATE TYPE public.content_status AS ENUM (
  'draft', 'review', 'approved', 'scheduled', 'queued', 'publishing', 'published', 'failed'
);

CREATE TYPE public.content_type AS ENUM (
  'instant_post', 'story', 'event', 'promotion', 'weekly_recurring'
);

CREATE TYPE public.platform AS ENUM (
  'facebook', 'instagram', 'gbp'
);

CREATE TYPE public.connection_status AS ENUM (
  'active', 'expiring', 'expired', 'disconnected'
);

-- ---------------------------------------------------------------------------
-- Reusable trigger function: auto-update updated_at on row modification
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Table: accounts
-- ---------------------------------------------------------------------------

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text,
  timezone text NOT NULL DEFAULT 'Europe/London',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_auth_user_id ON public.accounts(auth_user_id);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: accounts uses auth_user_id directly (no account_id self-reference)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select" ON public.accounts
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "accounts_insert" ON public.accounts
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "accounts_update" ON public.accounts
  FOR UPDATE USING (auth_user_id = auth.uid());

CREATE POLICY "accounts_delete" ON public.accounts
  FOR DELETE USING (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: profiles
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
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

CREATE INDEX idx_profiles_account_id ON public.profiles(account_id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: social_connections
-- ---------------------------------------------------------------------------

CREATE TABLE public.social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  platform public.platform NOT NULL,
  platform_account_id text NOT NULL,
  platform_account_name text,
  status public.connection_status NOT NULL DEFAULT 'active',
  scopes text[],
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, platform, platform_account_id)
);

CREATE INDEX idx_social_connections_account_id ON public.social_connections(account_id);

CREATE TRIGGER trg_social_connections_updated_at
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_connections_select" ON public.social_connections
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "social_connections_insert" ON public.social_connections
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "social_connections_update" ON public.social_connections
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "social_connections_delete" ON public.social_connections
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: token_vault (encrypted tokens only -- no plain-text storage, D-03)
-- ---------------------------------------------------------------------------

CREATE TABLE public.token_vault (
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

CREATE INDEX idx_token_vault_connection_id ON public.token_vault(social_connection_id);

CREATE TRIGGER trg_token_vault_updated_at
  BEFORE UPDATE ON public.token_vault
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: token_vault has no account_id; joins through social_connections
ALTER TABLE public.token_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_vault_select" ON public.token_vault
  FOR SELECT USING (social_connection_id IN (
    SELECT id FROM public.social_connections
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "token_vault_insert" ON public.token_vault
  FOR INSERT WITH CHECK (social_connection_id IN (
    SELECT id FROM public.social_connections
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "token_vault_update" ON public.token_vault
  FOR UPDATE USING (social_connection_id IN (
    SELECT id FROM public.social_connections
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "token_vault_delete" ON public.token_vault
  FOR DELETE USING (social_connection_id IN (
    SELECT id FROM public.social_connections
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));
