-- Fix content scheduling and calendar display issues
-- Migration: 024_fix_content_scheduling.sql

-- Add columns to campaigns table for storing user selections
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS selected_timings TEXT[] DEFAULT ARRAY['week_before', 'day_before', 'day_of']::TEXT[],
ADD COLUMN IF NOT EXISTS custom_dates TIMESTAMPTZ[] DEFAULT ARRAY[]::TIMESTAMPTZ[];

-- Add is_quick_post column to campaign_posts
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false;

-- Add platform column for single-platform posts (moving away from array)
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS platform TEXT;

-- Migrate existing data: Use first platform from platforms array
UPDATE campaign_posts 
SET platform = platforms[1] 
WHERE platform IS NULL 
  AND platforms IS NOT NULL 
  AND array_length(platforms, 1) > 0;

-- Add index for quick post queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_quick 
ON campaign_posts(is_quick_post) 
WHERE is_quick_post = true;

-- Add index for calendar queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_scheduled 
ON campaign_posts(tenant_id, scheduled_for) 
WHERE status IN ('scheduled', 'published');

-- Add index for platform-specific queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_platform 
ON campaign_posts(tenant_id, platform) 
WHERE platform IS NOT NULL;

-- Update any 'scheduled' quick posts that should be 'published'
UPDATE campaign_posts 
SET status = 'published' 
WHERE is_quick_post = true 
  AND status = 'scheduled' 
  AND scheduled_for <= NOW();

-- Add comment documentation
COMMENT ON COLUMN campaigns.selected_timings IS 'User-selected post timings from campaign wizard';
COMMENT ON COLUMN campaigns.custom_dates IS 'Custom dates/times added by user for additional posts';
COMMENT ON COLUMN campaign_posts.is_quick_post IS 'True if created via quick post modal, false for campaign posts';
COMMENT ON COLUMN campaign_posts.platform IS 'Single platform for this post (replacing platforms array for better optimization)';