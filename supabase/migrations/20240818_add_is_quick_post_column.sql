-- Add is_quick_post column to campaign_posts table
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS is_quick_post BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN campaign_posts.is_quick_post IS 'Indicates if this post was created via the quick post feature';

-- Create index for performance when filtering quick posts
CREATE INDEX IF NOT EXISTS idx_campaign_posts_is_quick_post 
ON campaign_posts(is_quick_post) 
WHERE is_quick_post = true;