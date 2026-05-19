-- =============================================================================
-- Provider Integration Migration
-- =============================================================================
-- Creates tables and functions for the provider integration layer:
--   1. oauth_states — session-bound OAuth state to prevent state fixation (PLAT-09)
--   2. provider_rate_limits — durable rate limit tracking per provider (PLAT-08)
--   3. increment_rate_limit — atomic counter increment RPC function (PLAT-08)
--   4. social_connections additions — metadata, display_name, last_synced_at
--
-- RLS enabled on all new tables with account-scoped policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. oauth_states — session-bound OAuth state (PLAT-09)
-- ---------------------------------------------------------------------------

CREATE TABLE public.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  state text UNIQUE NOT NULL,
  provider public.platform NOT NULL,
  redirect_to text,
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_states_state ON public.oauth_states(state);
CREATE INDEX idx_oauth_states_expires ON public.oauth_states(expires_at);
CREATE INDEX idx_oauth_states_cleanup ON public.oauth_states(expires_at) WHERE used_at IS NULL;

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oauth_states_select" ON public.oauth_states
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY "oauth_states_insert" ON public.oauth_states
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "oauth_states_update" ON public.oauth_states
  FOR UPDATE USING (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. provider_rate_limits — durable rate limit tracking (PLAT-08)
-- ---------------------------------------------------------------------------

CREATE TABLE public.provider_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider public.platform NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  limit_ceiling integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, endpoint, window_start)
);

CREATE INDEX idx_rate_limits_provider ON public.provider_rate_limits(account_id, provider);

CREATE TRIGGER trg_provider_rate_limits_updated_at
  BEFORE UPDATE ON public.provider_rate_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_limits_select" ON public.provider_rate_limits
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "rate_limits_insert" ON public.provider_rate_limits
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "rate_limits_update" ON public.provider_rate_limits
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. increment_rate_limit — atomic counter increment RPC (PLAT-08)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_account_id uuid,
  p_provider public.platform,
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

-- ---------------------------------------------------------------------------
-- 4. social_connections additions (columns v1 code expects but v2 baseline omitted)
-- ---------------------------------------------------------------------------

ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Strip leading "Group " from tournament_fixtures.group_name
--    Prevents the double-prefix bug ("GROUP GROUP B") in formatRoundLabel().
--    Wrapped in DO block: table may not exist on fresh databases.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tournament_fixtures') THEN
    UPDATE tournament_fixtures
    SET group_name = TRIM(REGEXP_REPLACE(group_name, '^\s*group\s+', '', 'i'))
    WHERE group_name ~* '^\s*group\s+';
  END IF;
END;
$$;
