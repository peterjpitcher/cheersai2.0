ALTER TABLE public.posting_defaults
  ADD COLUMN IF NOT EXISTS venue_latitude numeric(9,6)
    CHECK (venue_latitude IS NULL OR (venue_latitude >= -90 AND venue_latitude <= 90)),
  ADD COLUMN IF NOT EXISTS venue_longitude numeric(9,6)
    CHECK (venue_longitude IS NULL OR (venue_longitude >= -180 AND venue_longitude <= 180));

COMMENT ON COLUMN public.posting_defaults.venue_latitude IS
  'Latitude used as the centre point for Meta Ads radius targeting.';

COMMENT ON COLUMN public.posting_defaults.venue_longitude IS
  'Longitude used as the centre point for Meta Ads radius targeting.';
