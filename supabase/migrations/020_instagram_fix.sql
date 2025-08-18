-- Fix Instagram integration after Basic Display API deprecation
-- This migration adds metadata support for Instagram Business accounts

-- Add metadata column if it doesn't exist
ALTER TABLE social_connections 
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Mark existing Instagram connections as inactive (they need to reconnect)
UPDATE social_connections 
SET 
  is_active = false,
  updated_at = NOW()
WHERE 
  platform IN ('instagram', 'instagram_business')
  AND is_active = true;

-- Add comment explaining the new connection flow
COMMENT ON COLUMN social_connections.metadata IS 'Stores platform-specific data like Instagram profile picture, follower count, etc.';
COMMENT ON COLUMN social_connections.page_id IS 'Facebook Page ID - required for Instagram Business accounts';
COMMENT ON COLUMN social_connections.access_token IS 'For Instagram: stores Facebook Page access token, not user token';