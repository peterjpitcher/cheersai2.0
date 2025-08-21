-- Add metadata column to campaign_posts for storing guardrails and other settings
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add index for metadata queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_metadata 
ON campaign_posts USING gin (metadata);

-- Add comment for documentation
COMMENT ON COLUMN campaign_posts.metadata IS 'Stores additional post settings like guardrails, custom rules, and validation data';