ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS meta_status text,
  ADD COLUMN IF NOT EXISTS metrics_spend numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_impressions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_reach integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_ctr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cpc numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS meta_status text,
  ADD COLUMN IF NOT EXISTS metrics_spend numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_impressions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_reach integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_ctr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cpc numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
