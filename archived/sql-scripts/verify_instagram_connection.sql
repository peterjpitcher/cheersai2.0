-- Check if Instagram connections are being saved correctly
-- Run this in Supabase SQL Editor to verify

-- 1. Check all social connections (especially Instagram)
SELECT 
  id,
  tenant_id,
  platform,
  account_name,
  page_name,
  page_id,
  is_active,
  created_at,
  metadata
FROM social_connections
WHERE platform IN ('instagram', 'instagram_business')
ORDER BY created_at DESC
LIMIT 10;

-- 2. Check if the hotfix function exists and works
SELECT get_user_tenant_id('00000000-0000-0000-0000-000000000000'::uuid) AS tenant_from_compat_function;
SELECT get_auth_tenant_id() AS tenant_from_new_function;

-- 3. Check recent connections (last hour)
SELECT 
  platform,
  COUNT(*) as count,
  MAX(created_at) as latest
FROM social_connections
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY platform;

-- 4. Check if metadata is being stored
SELECT 
  platform,
  account_name,
  metadata->>'profile_picture_url' as profile_pic,
  metadata->>'followers_count' as followers
FROM social_connections
WHERE platform = 'instagram_business'
  AND metadata IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;