CREATE TABLE IF NOT EXISTS public.booking_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_site text NOT NULL DEFAULT 'the-anchor.pub',
  booking_id text NOT NULL,
  meta_event_id text,
  booking_type text NOT NULL DEFAULT 'event',
  event_id text,
  event_slug text,
  event_name text,
  event_category_name text,
  event_category_slug text,
  event_date date,
  tickets integer,
  value numeric,
  currency text NOT NULL DEFAULT 'GBP',
  food_intent text,
  source_url text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_conversion_events_booking_type_check
    CHECK (booking_type IN ('event', 'table')),
  CONSTRAINT booking_conversion_events_tickets_check
    CHECK (tickets IS NULL OR tickets > 0),
  CONSTRAINT booking_conversion_events_account_booking_key
    UNIQUE (account_id, booking_id)
);

ALTER TABLE public.booking_conversion_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'booking_conversion_events'
      AND policyname = 'Users can view their own booking conversions'
  ) THEN
    CREATE POLICY "Users can view their own booking conversions"
      ON public.booking_conversion_events
      FOR SELECT
      USING (account_id = public.current_account_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS booking_conversion_events_account_occurred_idx
  ON public.booking_conversion_events (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS booking_conversion_events_account_event_idx
  ON public.booking_conversion_events (account_id, event_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS booking_conversion_events_account_category_idx
  ON public.booking_conversion_events (account_id, event_category_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS booking_conversion_events_utm_campaign_idx
  ON public.booking_conversion_events (account_id, utm_campaign, occurred_at DESC);
