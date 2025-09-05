-- ⚠️ RUN THIS MIGRATION IN SUPABASE SQL EDITOR NOW ⚠️
-- Go to: https://supabase.com/dashboard/project/onvnfijtzumtnmgwhiaq/sql/new
-- Copy and paste this entire file, then click "Run"

-- Combined migrations 024 and 025
-- This fixes all the database errors in production

-- Step 1: Add columns to campaigns table
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS selected_timings TEXT[] DEFAULT ARRAY['week_before', 'day_before', 'day_of']::TEXT[],
ADD COLUMN IF NOT EXISTS custom_dates TIMESTAMPTZ[] DEFAULT ARRAY[]::TIMESTAMPTZ[];

-- Step 2: Add columns to campaign_posts table
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS platform TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Step 3: Migrate existing data - Use first platform from platforms array
UPDATE campaign_posts 
SET platform = platforms[1] 
WHERE platform IS NULL 
  AND platforms IS NOT NULL 
  AND array_length(platforms, 1) > 0;

-- Step 4: Update tenant_id for existing campaign_posts based on their campaign
UPDATE campaign_posts cp
SET tenant_id = c.tenant_id
FROM campaigns c
WHERE cp.campaign_id = c.id
AND cp.tenant_id IS NULL;

-- Step 5: Update any null status values
UPDATE campaign_posts 
SET status = 'draft' 
WHERE status IS NULL;

-- Step 6: Update any 'scheduled' quick posts that should be 'published'
UPDATE campaign_posts 
SET status = 'published' 
WHERE is_quick_post = true 
  AND status = 'scheduled' 
  AND scheduled_for <= NOW();

-- Step 7: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaign_posts_quick 
ON campaign_posts(is_quick_post) 
WHERE is_quick_post = true;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_scheduled 
ON campaign_posts(tenant_id, scheduled_for) 
WHERE status IN ('scheduled', 'published');

CREATE INDEX IF NOT EXISTS idx_campaign_posts_platform 
ON campaign_posts(tenant_id, platform) 
WHERE platform IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_tenant 
ON campaign_posts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_campaign_posts_calendar 
ON campaign_posts(tenant_id, scheduled_for)
WHERE status IN ('scheduled', 'published', 'draft');

-- Step 8: Add documentation comments
COMMENT ON COLUMN campaigns.selected_timings IS 'User-selected post timings from campaign wizard';
COMMENT ON COLUMN campaigns.custom_dates IS 'Custom dates/times added by user for additional posts';
COMMENT ON COLUMN campaign_posts.is_quick_post IS 'True if created via quick post modal, false for campaign posts';
COMMENT ON COLUMN campaign_posts.platform IS 'Single platform for this post (replacing platforms array for better optimization)';

-- Verification: Check that columns were added
SELECT 
  'campaigns.selected_timings' as column_check,
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaigns' AND column_name='selected_timings'
  ) as exists
UNION ALL
SELECT 
  'campaigns.custom_dates',
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaigns' AND column_name='custom_dates'
  )
UNION ALL
SELECT 
  'campaign_posts.tenant_id',
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaign_posts' AND column_name='tenant_id'
  )
UNION ALL
SELECT 
  'campaign_posts.is_quick_post',
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaign_posts' AND column_name='is_quick_post'
  )
UNION ALL
SELECT 
  'campaign_posts.platform',
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaign_posts' AND column_name='platform'
  )
UNION ALL
SELECT 
  'campaign_posts.status',
  EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='campaign_posts' AND column_name='status'
  );

-- If all results show 'true', the migration was successful!