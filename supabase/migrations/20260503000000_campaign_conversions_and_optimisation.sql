ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS metrics_conversions numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cost_per_conversion numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_conversion_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS metrics_conversions numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cost_per_conversion numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_conversion_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS metrics_conversions numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cost_per_conversion numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_conversion_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE public.meta_ad_accounts
  ADD COLUMN IF NOT EXISTS meta_pixel_id text NOT NULL DEFAULT '757659911002159',
  ADD COLUMN IF NOT EXISTS conversion_event_name text NOT NULL DEFAULT 'Purchase',
  ADD COLUMN IF NOT EXISTS conversion_optimisation_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.meta_optimisation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  mode        text NOT NULL DEFAULT 'apply',
  status      text NOT NULL DEFAULT 'running',
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT meta_optimisation_runs_mode_check
    CHECK (mode IN ('apply', 'dry_run')),
  CONSTRAINT meta_optimisation_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);

ALTER TABLE public.meta_optimisation_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_optimisation_runs'
      AND policyname = 'Users can view their own optimisation runs'
  ) THEN
    CREATE POLICY "Users can view their own optimisation runs"
      ON public.meta_optimisation_runs
      USING (account_id = public.current_account_id())
      WITH CHECK (account_id = public.current_account_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.meta_optimisation_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.meta_optimisation_runs(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  campaign_id      uuid NOT NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  adset_id         uuid REFERENCES public.ad_sets(id) ON DELETE SET NULL,
  ad_id            uuid REFERENCES public.ads(id) ON DELETE SET NULL,
  meta_object_id   text,
  action_type      text NOT NULL,
  reason           text NOT NULL,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'planned',
  error            text,
  applied_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_optimisation_actions_action_type_check
    CHECK (action_type IN ('pause_ad')),
  CONSTRAINT meta_optimisation_actions_status_check
    CHECK (status IN ('planned', 'applied', 'skipped', 'failed'))
);

ALTER TABLE public.meta_optimisation_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_optimisation_actions'
      AND policyname = 'Users can view their own optimisation actions'
  ) THEN
    CREATE POLICY "Users can view their own optimisation actions"
      ON public.meta_optimisation_actions
      USING (account_id = public.current_account_id())
      WITH CHECK (account_id = public.current_account_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS meta_optimisation_runs_account_started_idx
  ON public.meta_optimisation_runs (account_id, started_at DESC);

CREATE INDEX IF NOT EXISTS meta_optimisation_actions_account_created_idx
  ON public.meta_optimisation_actions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meta_optimisation_actions_campaign_idx
  ON public.meta_optimisation_actions (campaign_id, created_at DESC);
