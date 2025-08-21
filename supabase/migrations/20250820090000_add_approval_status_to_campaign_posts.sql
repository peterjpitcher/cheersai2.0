-- Add approval_status column to campaign_posts table for approval workflow
-- This implements the approval workflow requested in Issue #55

-- Add approval_status column with default value 'pending'
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'pending' 
CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Add approved_by and approved_at columns to track who approved and when
ALTER TABLE campaign_posts 
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Create index for approval status queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_approval_status 
ON campaign_posts (approval_status);

-- Create index for approved_by queries
CREATE INDEX IF NOT EXISTS idx_campaign_posts_approved_by 
ON campaign_posts (approved_by);

-- Add comments for documentation
COMMENT ON COLUMN campaign_posts.approval_status IS 'Approval status for publishing: pending, approved, rejected';
COMMENT ON COLUMN campaign_posts.approved_by IS 'User ID who approved or rejected the post';
COMMENT ON COLUMN campaign_posts.approved_at IS 'Timestamp when the post was approved or rejected';

-- Update existing posts to have 'approved' status to maintain backward compatibility
-- This ensures existing posts can still be published without disruption
UPDATE campaign_posts 
SET approval_status = 'approved' 
WHERE approval_status = 'pending';