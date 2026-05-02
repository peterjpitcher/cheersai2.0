ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS geo_radius_miles integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_campaigns_geo_radius_miles_check'
  ) THEN
    ALTER TABLE public.meta_campaigns
      ADD CONSTRAINT meta_campaigns_geo_radius_miles_check
      CHECK (geo_radius_miles IN (1, 3, 5, 10));
  END IF;
END $$;
