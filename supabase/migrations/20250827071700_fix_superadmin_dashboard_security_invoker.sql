-- Explicitly fix SECURITY DEFINER on superadmin_dashboard view
-- The view must use SECURITY INVOKER to pass Supabase security checks

-- First, drop the existing view completely
DROP VIEW IF EXISTS public.superadmin_dashboard CASCADE;

-- Recreate the view with explicit SECURITY INVOKER
-- Note: SECURITY INVOKER is the default, but we're being explicit here
CREATE OR REPLACE VIEW public.superadmin_dashboard 
WITH (security_invoker = true) AS
SELECT 
  t.id as tenant_id,
  t.name as tenant_name,
  t.subscription_tier,
  t.subscription_status,
  t.trial_ends_at,
  t.created_at as tenant_created,
  COUNT(DISTINCT u.id) as user_count,
  COUNT(DISTINCT c.id) as campaign_count,
  COUNT(DISTINCT cp.id) as post_count,
  COUNT(DISTINCT ma.id) as media_count,
  COUNT(DISTINCT sc.id) as connection_count
FROM tenants t
LEFT JOIN users u ON u.tenant_id = t.id
LEFT JOIN campaigns c ON c.tenant_id = t.id
LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id
LEFT JOIN media_assets ma ON ma.tenant_id = t.id
LEFT JOIN social_connections sc ON sc.tenant_id = t.id
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE users.id = auth.uid() 
  AND users.is_superadmin = true
)
GROUP BY t.id
ORDER BY t.created_at DESC;

-- Grant SELECT permission to authenticated users
-- The WHERE clause ensures only superadmins can see data
GRANT SELECT ON public.superadmin_dashboard TO authenticated;

-- Add descriptive comment
COMMENT ON VIEW public.superadmin_dashboard IS 'Dashboard view for superadmins showing tenant overview. Uses SECURITY INVOKER and filters by superadmin status.';