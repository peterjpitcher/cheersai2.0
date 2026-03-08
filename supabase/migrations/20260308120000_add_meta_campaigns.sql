-- Migration: add_meta_campaigns
-- Adds tables for Meta Paid Media Campaigns feature:
--   meta_ad_accounts, campaigns, ad_sets, ads

-- ─── meta_ad_accounts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  meta_account_id  text        NOT NULL DEFAULT '',
  currency         text        NOT NULL DEFAULT 'GBP',
  timezone         text        NOT NULL DEFAULT 'Europe/London',
  access_token     text        NOT NULL DEFAULT '',
  token_expires_at timestamptz,
  setup_complete   boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'meta_ad_accounts'
      AND policyname = 'Users can manage their own ad account'
  ) THEN
    CREATE POLICY "Users can manage their own ad account"
      ON public.meta_ad_accounts
      USING (account_id = public.current_account_id());
  END IF;
END $$;

-- ─── campaigns ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campaigns (
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

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'campaigns'
      AND policyname = 'Users can manage their own campaigns'
  ) THEN
    CREATE POLICY "Users can manage their own campaigns"
      ON public.campaigns
      USING (account_id = public.current_account_id());
  END IF;
END $$;

-- ─── ad_sets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ad_sets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid        NOT NULL REFERENCES public.campaigns ON DELETE CASCADE,
  meta_adset_id     text,
  name              text        NOT NULL,
  targeting         jsonb       NOT NULL DEFAULT '{}',
  placements        jsonb       NOT NULL DEFAULT '"AUTO"',
  budget_amount     numeric,
  optimisation_goal text        NOT NULL,
  bid_strategy      text        NOT NULL DEFAULT 'LOWEST_COST_WITHOUT_CAP',
  status            text        NOT NULL DEFAULT 'DRAFT',
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ad_sets'
      AND policyname = 'Users can manage their own ad sets'
  ) THEN
    CREATE POLICY "Users can manage their own ad sets"
      ON public.ad_sets
      USING (
        EXISTS (
          SELECT 1
          FROM public.campaigns c
          WHERE c.id = ad_sets.campaign_id
            AND c.account_id = public.current_account_id()
        )
      );
  END IF;
END $$;

-- ─── ads ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ads (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  adset_id         uuid        NOT NULL REFERENCES public.ad_sets ON DELETE CASCADE,
  meta_ad_id       text,
  meta_creative_id text,
  name             text        NOT NULL,
  headline         text        NOT NULL,
  primary_text     text        NOT NULL,
  description      text        NOT NULL,
  cta              text        NOT NULL DEFAULT 'LEARN_MORE',
  media_asset_id   uuid,
  creative_brief   text,
  preview_url      text,
  status           text        NOT NULL DEFAULT 'DRAFT',
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'ads'
      AND policyname = 'Users can manage their own ads'
  ) THEN
    CREATE POLICY "Users can manage their own ads"
      ON public.ads
      USING (
        EXISTS (
          SELECT 1
          FROM public.ad_sets ads2
          JOIN public.campaigns c ON c.id = ads2.campaign_id
          WHERE ads2.id = ads.adset_id
            AND c.account_id = public.current_account_id()
        )
      );
  END IF;
END $$;
