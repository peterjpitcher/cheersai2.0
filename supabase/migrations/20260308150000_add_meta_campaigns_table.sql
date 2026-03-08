-- Create the meta_campaigns table (separate from the existing content campaigns table)
CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  meta_campaign_id     text,
  name                 text        NOT NULL,
  objective            text        NOT NULL,
  problem_brief        text        NOT NULL,
  ai_rationale         text,
  budget_type          text        NOT NULL DEFAULT 'DAILY',
  budget_amount        numeric     NOT NULL,
  start_date           date        NOT NULL,
  end_date             date,
  status               text        NOT NULL DEFAULT 'DRAFT',
  meta_status          text,
  special_ad_category  text        NOT NULL DEFAULT 'NONE',
  last_synced_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'meta_campaigns'
      AND policyname = 'Users can manage their own meta campaigns'
  ) THEN
    CREATE POLICY "Users can manage their own meta campaigns"
      ON public.meta_campaigns
      USING (account_id = public.current_account_id())
      WITH CHECK (account_id = public.current_account_id());
  END IF;
END $$;
