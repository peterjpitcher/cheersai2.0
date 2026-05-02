ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS audience_mode text NOT NULL DEFAULT 'local_only',
  ADD COLUMN IF NOT EXISTS audience_interest_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resolved_interests jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_campaigns_audience_mode_check'
  ) THEN
    ALTER TABLE public.meta_campaigns
      ADD CONSTRAINT meta_campaigns_audience_mode_check
      CHECK (audience_mode IN ('local_only', 'local_interests'));
  END IF;
END $$;
