-- Fix ad_sets FK to reference meta_campaigns instead of the old content campaigns table.
-- The 20260308120000_add_meta_campaigns.sql migration used CREATE TABLE IF NOT EXISTS for
-- campaigns, which was a no-op because a legacy content campaigns table already existed.
-- The ad_sets.campaign_id FK therefore points at the wrong table.

ALTER TABLE public.ad_sets DROP CONSTRAINT IF EXISTS ad_sets_campaign_id_fkey;

ALTER TABLE public.ad_sets
  ADD CONSTRAINT ad_sets_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.meta_campaigns(id) ON DELETE CASCADE;
