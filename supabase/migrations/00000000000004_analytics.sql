-- =============================================================================
-- Analytics Domain Migration
-- =============================================================================
-- Creates analytics tables:
--   analytics_snapshots (DATA-08), gbp_daily_metrics (DATA-09)
-- Schema-only in Phase 1; populated by cron jobs in Phase 6.
-- RLS enabled on all tables with account-scoped policies (D-11).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: analytics_snapshots (DATA-08: per-post engagement metrics)
-- ---------------------------------------------------------------------------

CREATE TABLE public.analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  publish_job_id uuid REFERENCES public.publish_jobs(id) ON DELETE SET NULL,
  platform public.platform NOT NULL,
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

CREATE INDEX idx_analytics_snapshots_account ON public.analytics_snapshots(account_id);

ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_snapshots_select" ON public.analytics_snapshots
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "analytics_snapshots_insert" ON public.analytics_snapshots
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "analytics_snapshots_update" ON public.analytics_snapshots
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "analytics_snapshots_delete" ON public.analytics_snapshots
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: gbp_daily_metrics (DATA-09: Google Business Profile location metrics)
-- ---------------------------------------------------------------------------

CREATE TABLE public.gbp_daily_metrics (
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

CREATE INDEX idx_gbp_daily_metrics_account ON public.gbp_daily_metrics(account_id);

ALTER TABLE public.gbp_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gbp_daily_metrics_select" ON public.gbp_daily_metrics
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "gbp_daily_metrics_insert" ON public.gbp_daily_metrics
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "gbp_daily_metrics_update" ON public.gbp_daily_metrics
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "gbp_daily_metrics_delete" ON public.gbp_daily_metrics
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
