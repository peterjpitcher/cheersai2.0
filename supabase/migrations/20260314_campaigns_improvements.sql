-- supabase/migrations/20260314_campaigns_improvements.sql

-- Add angle label to ads (free-text, AI-assigned, e.g. "Jackpot & prize mechanic")
ALTER TABLE ads ADD COLUMN IF NOT EXISTS angle TEXT;

-- Add adset-level shared image fields (denormalised cache — always written together)
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS adset_media_asset_id UUID REFERENCES media_assets(id);
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS adset_image_url TEXT;

-- Add stop time for Day Of ad set (NULL = no stop time; existing rows treated as NULL)
ALTER TABLE ad_sets ADD COLUMN IF NOT EXISTS ads_stop_time TIME;
