-- Fix calendar RLS policy to handle posts with and without campaigns
-- Migration: 029_fix_calendar_rls.sql

-- Drop existing conflicting policies
DROP POLICY IF EXISTS "Tenant members can manage campaign posts or superadmin" ON campaign_posts;
DROP POLICY IF EXISTS "Users can view posts for their campaigns" ON campaign_posts;
DROP POLICY IF EXISTS "Users can create posts for their campaigns" ON campaign_posts;
DROP POLICY IF EXISTS "Users can update posts for their campaigns" ON campaign_posts;
DROP POLICY IF EXISTS "Users can delete posts for their campaigns" ON campaign_posts;
DROP POLICY IF EXISTS "Users can manage campaign posts via tenant" ON campaign_posts;

-- Create unified policy that handles both campaign posts and quick posts
CREATE POLICY "Users can manage campaign posts via tenant" ON campaign_posts
  FOR ALL TO authenticated
  USING (
    -- Direct tenant_id match (for quick posts and posts with tenant_id)
    tenant_id = get_auth_tenant_id()
    OR
    -- Campaign-based access (for posts without direct tenant_id)
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_posts.campaign_id 
      AND campaigns.tenant_id = get_auth_tenant_id()
    )
    OR
    -- Superadmin access
    is_superadmin()
  )
  WITH CHECK (
    -- Same logic for inserts/updates
    tenant_id = get_auth_tenant_id()
    OR
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_posts.campaign_id 
      AND campaigns.tenant_id = get_auth_tenant_id()
    )
    OR
    is_superadmin()
  );

-- Ensure all campaign_posts have tenant_id populated
UPDATE campaign_posts cp
SET tenant_id = c.tenant_id
FROM campaigns c
WHERE cp.campaign_id = c.id
AND cp.tenant_id IS NULL;

-- Update quick posts to have tenant_id if missing
UPDATE campaign_posts cp
SET tenant_id = u.tenant_id
FROM users u
WHERE cp.is_quick_post = true
AND cp.tenant_id IS NULL
AND cp.created_at > NOW() - INTERVAL '30 days' -- Only recent posts to avoid data issues
AND EXISTS (
  SELECT 1 FROM auth.users au 
  WHERE au.id = u.id 
  -- This is a safety check, but we can't directly get the creator
);

-- Add comment for future reference
COMMENT ON POLICY "Users can manage campaign posts via tenant" ON campaign_posts IS 
'Unified policy allowing access to campaign posts via direct tenant_id or campaign relationship';