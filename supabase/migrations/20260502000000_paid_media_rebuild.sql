ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS campaign_kind text NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS destination_url text,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metrics_spend numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_impressions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_reach integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_ctr numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_cpc numeric NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_campaigns_campaign_kind_check'
  ) THEN
    ALTER TABLE public.meta_campaigns
      ADD CONSTRAINT meta_campaigns_campaign_kind_check
      CHECK (campaign_kind IN ('event', 'evergreen'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS meta_campaigns_campaign_kind_idx
  ON public.meta_campaigns (campaign_kind);

CREATE INDEX IF NOT EXISTS meta_campaigns_source_lookup_idx
  ON public.meta_campaigns (source_type, source_id);
