-- Ensure all required columns exist for production
-- Migration: 026_ensure_all_columns.sql

-- Ensure campaign_posts has all required columns
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false;

ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS platform TEXT;

ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS post_timing VARCHAR(50);

-- Ensure campaigns has all required columns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS selected_timings TEXT[] DEFAULT ARRAY['week_before', 'day_before', 'day_of']::TEXT[];

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS custom_dates TIMESTAMPTZ[] DEFAULT ARRAY[]::TIMESTAMPTZ[];

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{}';

ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS auto_generate BOOLEAN DEFAULT false;

-- Update tenant_id for existing campaign_posts based on their campaign
UPDATE campaign_posts cp
SET tenant_id = c.tenant_id
FROM campaigns c
WHERE cp.campaign_id = c.id
AND cp.tenant_id IS NULL;

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_campaign_posts_tenant 
ON campaign_posts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_campaign_posts_quick 
ON campaign_posts(is_quick_post) 
WHERE is_quick_post = true;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_scheduled 
ON campaign_posts(tenant_id, scheduled_for) 
WHERE status IN ('scheduled', 'published');

CREATE INDEX IF NOT EXISTS idx_campaign_posts_platform 
ON campaign_posts(tenant_id, platform) 
WHERE platform IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_calendar 
ON campaign_posts(tenant_id, scheduled_for)
WHERE status IN ('scheduled', 'published', 'draft');

-- Ensure media_assets has watermark columns
ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS has_watermark BOOLEAN DEFAULT false;

ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS watermark_position TEXT;

ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS original_url TEXT;

ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS alt_text TEXT;

ALTER TABLE media_assets 
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Add RLS policies for campaign_posts tenant_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'campaign_posts' 
    AND policyname = 'Users can view their tenant campaign posts'
  ) THEN
    CREATE POLICY "Users can view their tenant campaign posts" 
    ON campaign_posts FOR SELECT 
    USING (
      tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'campaign_posts' 
    AND policyname = 'Users can create campaign posts for their tenant'
  ) THEN
    CREATE POLICY "Users can create campaign posts for their tenant" 
    ON campaign_posts FOR INSERT 
    WITH CHECK (
      tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'campaign_posts' 
    AND policyname = 'Users can update their tenant campaign posts'
  ) THEN
    CREATE POLICY "Users can update their tenant campaign posts" 
    ON campaign_posts FOR UPDATE 
    USING (
      tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'campaign_posts' 
    AND policyname = 'Users can delete their tenant campaign posts'
  ) THEN
    CREATE POLICY "Users can delete their tenant campaign posts" 
    ON campaign_posts FOR DELETE 
    USING (
      tenant_id IN (
        SELECT tenant_id FROM users WHERE id = auth.uid()
      )
    );
  END IF;
END $$;