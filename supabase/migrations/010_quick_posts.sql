-- Migration to support quick posts without campaigns
-- Allow campaign_posts to exist without a campaign (for quick posts)

-- Make campaign_id nullable in campaign_posts
ALTER TABLE campaign_posts 
ALTER COLUMN campaign_id DROP NOT NULL;

-- Add columns for quick post support
ALTER TABLE campaign_posts
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS platform VARCHAR(50),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Create index for tenant_id
CREATE INDEX IF NOT EXISTS idx_campaign_posts_tenant_id ON campaign_posts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_status ON campaign_posts(status);
CREATE INDEX IF NOT EXISTS idx_campaign_posts_is_quick_post ON campaign_posts(is_quick_post);

-- Update RLS policies to handle quick posts
DROP POLICY IF EXISTS "campaign_posts_tenant_isolation" ON campaign_posts;

CREATE POLICY "campaign_posts_tenant_isolation"
  ON campaign_posts FOR ALL
  USING (
    -- Either through campaign's tenant_id or direct tenant_id for quick posts
    COALESCE(
      (SELECT tenant_id FROM campaigns WHERE campaigns.id = campaign_posts.campaign_id),
      campaign_posts.tenant_id
    ) IN (
      SELECT tenant_id FROM users WHERE auth.uid() = users.id
    )
  );

-- Add comment explaining the schema change
COMMENT ON COLUMN campaign_posts.campaign_id IS 'References campaign if part of campaign, NULL for quick posts';
COMMENT ON COLUMN campaign_posts.is_quick_post IS 'True for one-off quick posts, false for campaign posts';
COMMENT ON COLUMN campaign_posts.tenant_id IS 'Direct tenant reference for quick posts (when campaign_id is NULL)';
COMMENT ON COLUMN campaign_posts.platform IS 'Target platform for quick posts';
COMMENT ON COLUMN campaign_posts.status IS 'Post status: draft, scheduled, published, failed';
COMMENT ON COLUMN campaign_posts.media_url IS 'Optional media attachment for quick posts';